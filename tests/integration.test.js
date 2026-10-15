const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const { startTestApp } = require("./test-app");
const { makeZip, readZip } = require('./zip-fixture');

test("Next.js UI and preserved Express API", { timeout: 180000 }, async (t) => {
  const app = await startTestApp();
  t.after(() => app.stop());
  const post = (url, body) =>
    fetch(`${app.baseURL}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  await t.test("public launcher contracts and protected pages", async () => {
    const config = await (
      await fetch(`${app.baseURL}/api/client-config`)
    ).json();
    assert.equal(
      config.modsURL,
      `http://localhost:${app.backendPort}/api/download-mods`,
    );
    assert.equal(config.launcherServer, `http://localhost:${app.backendPort}`);
    assert.equal(config.version, "1.21.1");
    assert.equal(config.javaVersion, 21);
    assert.equal(config.configsHash, 'empty');
    assert.equal(config.configsURL, null);
    assert.equal(config.configsDirectory, 'configs');
    assert.equal((await fetch(`${app.baseURL}/api/download-configs`)).status, 404);
    assert.equal((await fetch(`${app.baseURL}/api/dashboard`)).status, 401);
    const profile = await fetch(`${app.baseURL}/profile`, {
      redirect: "manual",
    });
    assert.equal(profile.status, 302);
    assert.equal(profile.headers.get("location"), "/login?redirect=%2Fprofile");
    const mods = await (await fetch(`${app.baseURL}/api/mods-list`)).json();
    assert.equal(mods.mods.length, 3);
    const archive = await fetch(`${app.baseURL}/api/download-mods`);
    assert.equal(archive.status, 200);
    assert.match(archive.headers.get("content-disposition"), /mods.zip/);
    assert.equal((await archive.arrayBuffer()).byteLength > 0, true);
    assert.equal((await fetch(`${app.baseURL}/api/unknown`)).status, 404);
  });

  for (const login of ["alex", "steve"]) {
    const response = await post("/api/register", {
      login,
      password: "test-password",
      nickname: login,
      email: `${login}@example.test`,
    });
    assert.equal((await response.json()).success, true);
  }
  // botoli1 is the sole role manager. Prepare the existing administrator test account through the real API.
  await post('/api/register', { login: 'botoli1', password: 'test-password', nickname: 'botoli1' });
  const roleManager = await (await post('/api/auth', { login: 'botoli1', password: 'test-password' })).json();
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const artifacts = path.resolve(__dirname, "../artifacts");
  await fs.mkdir(artifacts, { recursive: true });
  const screenshot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(artifacts, name), fullPage: true });
  };

  await t.test(
    "registration, login errors and cookie authentication",
    async () => {
      await page.goto(`${app.baseURL}/register`);
      await screenshot("register-desktop.png");
      await page.getByLabel("Логин", { exact: true }).fill("builder");
      await page.getByLabel("Игровой никнейм", { exact: true }).fill("Builder");
      await page
        .getByLabel("Email", { exact: true })
        .fill("builder@example.test");
      await page.getByLabel("Пароль", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Показать пароль" }).click();
      await expect(page.getByLabel("Пароль", { exact: true })).toHaveAttribute(
        "type",
        "text",
      );
      await page
        .getByRole("button", { name: "Создать аккаунт", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Всё готово к игре" }),
      ).toBeVisible();
      await fetch(`${app.baseURL}/api/admin/players/builder/role`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${roleManager.token}` }, body: JSON.stringify({ role: 'admin' }),
      });
      await page.getByRole("link", { name: "Перейти ко входу" }).click();
      await page.getByLabel("Логин", { exact: true }).fill("builder");
      await page.getByLabel("Пароль", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(page.locator(".notice.error")).toContainText(
        "Неверный пароль",
      );
      await page.getByLabel("Пароль", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Твой профиль", exact: true }),
      ).toBeVisible();
      assert.equal(
        (await context.cookies()).some(
          (cookie) => cookie.name === "mc_launcher_token" && cookie.httpOnly,
        ),
        true,
      );
    },
  );

  if (!page.url().endsWith("/profile")) return;

  await t.test("profile edit and navigation refresh", async () => {
    await page
      .getByLabel("Игровой никнейм", { exact: true })
      .fill("BlockBuilder");
    await page.getByRole("button", { name: "Сохранить никнейм" }).click();
    await expect(page.locator(".notice.success")).toContainText(
      "Никнейм сохранён",
    );
    await expect(page.locator(".topbar")).toContainText("BlockBuilder");
    await screenshot("profile-desktop.png");
  });

  await t.test("build validation, save, persistence and reset", async () => {
    await page.getByRole("link", { name: "Сборка", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Твоя следующая сборка" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Сохранить сборку" }),
    ).toBeDisabled();
    await page
      .getByLabel("Минимальная память, МБ", { exact: true })
      .fill("8192");
    await page.getByRole("button", { name: "Сохранить сборку" }).click();
    await expect(page.locator(".notice.error")).toContainText(
      "Минимальная память",
    );
    await page
      .getByLabel("Минимальная память, МБ", { exact: true })
      .fill("2048");
    await page
      .getByLabel("Максимальная память, МБ", { exact: true })
      .fill("6144");
    await page.getByLabel("Версия Java", { exact: true }).fill("21");
    await page.getByRole("button", { name: "Сохранить сборку" }).click();
    await expect(page.locator(".notice.success")).toContainText(
      "Сборка сохранена",
    );
    const saved = (await app.snapshot()).settings.build;
    assert.equal(saved.maxMemory, 6144);
    assert.equal(saved.launcherServer, `http://localhost:${app.backendPort}`);
    await page
      .getByLabel("Максимальная память, МБ", { exact: true })
      .fill("4096");
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(
      page.getByLabel("Максимальная память, МБ", { exact: true }),
    ).toHaveValue("6144");
    await screenshot("dashboard-desktop.png");
  });

  await t.test(
    "mod upload, search, download and confirmed deletion",
    async () => {
      await page.getByRole("link", { name: "Моди и конфиги", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Моди и конфиги" }),
      ).toBeVisible();
      await page
        .locator("#mod-file")
        .setInputFiles({
          name: "new-mod.jar",
          mimeType: "application/java-archive",
          buffer: Buffer.from("Integration test mod"),
        });
      await page.getByRole("button", { name: "Загрузить мод" }).click();
      await expect(page.locator(".notice.success")).toContainText(
        "Мод загружен",
      );
      await page.getByLabel("Поиск модов").fill("new-mod");
      await expect(page.locator(".mod-list li")).toHaveCount(1);
      assert.equal(
        await fs.readFile(
          path.join(app.fixture, "data/mods/new-mod.jar"),
          "utf8",
        ),
        "Integration test mod",
      );
      const downloaded = await fetch(`${app.baseURL}/mods/new-mod.jar`);
      assert.equal(await downloaded.text(), "Integration test mod");
      await page
        .getByRole("button", { name: "Удалить new-mod.jar", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Оставить мод" }).click();
      assert.equal(
        (await fetch(`${app.baseURL}/mods/new-mod.jar`)).status,
        200,
      );
      await page
        .getByRole("button", { name: "Удалить new-mod.jar", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Удалить мод", exact: true })
        .click();
      await expect(page.locator(".notice.success")).toContainText("Мод удалён");
      await expect(
        page.getByRole("heading", { name: "Моды не найдены" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Очистить поиск" }).click();
      await screenshot("mods-desktop.png");
    },
  );

  await t.test('config ZIP upload, launcher archive layout, replacement and access control', async () => {
    const before = await (await fetch(`${app.baseURL}/api/client-config`)).json();
    const zip = await makeZip([['configs/example.toml', 'value=1'], ['configs/nested/options.json', '{}']]);
    const form = () => { const body = new FormData(); body.append('configs', new Blob([zip]), 'settings.zip'); return body; };
    assert.equal((await fetch(`${app.baseURL}/api/upload-configs`, { method: 'POST', body: form() })).status, 401);
    const player = await (await post('/api/auth', { login: 'steve', password: 'test-password' })).json();
    assert.equal((await fetch(`${app.baseURL}/api/upload-configs`, { method: 'POST', headers: { Authorization: `Bearer ${player.token}` }, body: form() })).status, 403);
    await page.locator('#configs-file').setInputFiles({ name: 'settings.zip', mimeType: 'application/zip', buffer: zip });
    await page.getByRole('button', { name: 'Загрузить конфиги', exact: true }).click();
    await expect(page.locator('.configs-section .notice.success')).toContainText('Конфиги загружены');
    await expect(page.locator('.configs-section')).toContainText('settings.zip');
    await expect(page.locator('.configs-section')).toContainText('Файлов: 2');
    const config = await (await fetch(`${app.baseURL}/api/client-config`)).json();
    assert.notEqual(config.modsHash, before.modsHash);
    assert.match(config.configsHash, /^[a-f0-9]{64}$/);
    assert.equal(config.configsURL, `http://localhost:${app.backendPort}/api/download-configs`);
    const download = async route => readZip(Buffer.from(await (await fetch(`${app.baseURL}${route}`)).arrayBuffer()));
    const configs = await download('/api/download-configs');
    assert.deepEqual(configs, { 'configs/example.toml': 'value=1', 'configs/nested/options.json': '{}' });
    const bundle = await download('/api/download-mods');
    assert.equal(bundle['configs/example.toml'], 'value=1');
    assert.equal(bundle['configs/nested/options.json'], '{}');
    assert.equal(Object.keys(bundle).filter(name => name.startsWith('mods/')).length, 3);
    assert.ok(Object.keys(bundle).every(name => name.startsWith('mods/') || name.startsWith('configs/')));
    await page.reload();
    await expect(page.locator('.configs-section')).toContainText('settings.zip');
    const replacement = await makeZip([['example.toml', 'value=2']]);
    await page.locator('#configs-file').setInputFiles({ name: 'replacement.zip', mimeType: 'application/zip', buffer: replacement });
    await expect(page.locator('.configs-section .selected-file')).toContainText('Заменит текущий набор');
    await page.getByRole('button', { name: 'Загрузить конфиги', exact: true }).click();
    await expect(page.locator('.configs-section .notice.success')).toContainText('Конфиги загружены');
    const changed = await (await fetch(`${app.baseURL}/api/client-config`)).json();
    assert.notEqual(changed.configsHash, config.configsHash);
    assert.notEqual(changed.modsHash, config.modsHash);
    assert.deepEqual(await download('/api/download-configs'), { 'configs/example.toml': 'value=2' });
    await page.locator('#configs-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken') });
    await page.getByRole('button', { name: 'Загрузить конфиги', exact: true }).click();
    await expect(page.locator('.configs-section .notice.error')).toContainText('ZIP');
    assert.equal((await (await fetch(`${app.baseURL}/api/client-config`)).json()).configsHash, changed.configsHash);
    await page.getByRole('button', { name: 'Отменить выбор архива' }).click();
    const journal = await app.snapshot();
    assert.deepEqual(journal.events.filter(event => event.action.startsWith('configs_')).map(event => event.action), ['configs_added', 'configs_replaced']);
    await page.reload();
    await expect(page.locator('.configs-section')).toContainText('replacement.zip');
    await screenshot('mods-configs-desktop.png');
  });

  await t.test("player search, filtering and status persistence", async () => {
    await page.getByRole("link", { name: "Игроки", exact: true }).click();
    await page.getByRole("textbox", { name: "Поиск игроков" }).fill("builder");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .getByLabel("Статус builder", { exact: true })
      .selectOption("pending");
    await expect(page.locator(".notice.success")).toContainText(
      "Статус игрока builder обновлён",
    );
    await page.getByLabel("Фильтр по статусу").selectOption("confirmed");
    await expect(
      page.getByRole("heading", { name: "Игроки не найдены" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await screenshot("players-desktop.png");
  });

  await t.test("launcher auth permits pending and rejects banned users and tokens", async () => {
    const credentials = { login: 'steve', password: 'test-password' };
    await context.request.put(`${app.baseURL}/api/admin/players/steve/status`, { data: { status: 'pending' } });
    const login = await (await post('/api/launcher-auth', credentials)).json();
    assert.equal(login.success, true);
    await context.request.put(`${app.baseURL}/api/admin/players/steve/status`, { data: { status: 'banned' } });
    assert.equal((await post('/api/launcher-auth', credentials)).status, 403);
    assert.equal((await post('/api/launcher-auth', { token: login.token })).status, 403);
    assert.equal((await (await post('/api/verify', { token: login.token })).json()).valid, false);
    await context.request.put(`${app.baseURL}/api/admin/players/steve/status`, { data: { status: 'confirmed' } });
  });

  await t.test("player actions, confirmation, tabbed history and global log filters", async () => {
    await page.goto(`${app.baseURL}/players`);
    await page.getByLabel('Поиск игроков', { exact: true }).fill('alex');
    await page.getByRole('link', { name: 'Действия', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Данные об игроке' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Доступ к лаунчеру' })).toBeVisible();
    await page.getByLabel('Причина ограничения', { exact: true }).fill('Проверка интерфейса');
    await page.getByLabel('Заморозка на часов', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Заморозить', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Заморозить', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(page.locator('.player-flags')).toContainText('Заморожен до');
    await page.getByRole('button', { name: 'Снять заморозку', exact: true }).click();
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await expect(page.locator('.player-flags')).not.toContainText('Заморожен до');
    await page.getByRole('tab', { name: 'Все действия', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Журнал действий' })).toContainText('Заморозка');
    await page.getByRole('tab', { name: 'Лог авторизаций', exact: true }).click();
    await expect(page.getByText('События не найдены', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Подключения на сервер', exact: true }).click();
    await expect(page.getByText('События не найдены', { exact: true })).toBeVisible();
    await screenshot('player-actions-desktop.png');
    await page.getByRole('link', { name: 'Логи', exact: true }).click();
    await page.getByLabel('Тип событий', { exact: true }).selectOption('moderation');
    await page.getByLabel('Поиск в логах', { exact: true }).fill('alex');
    await expect(page.getByRole('region', { name: 'Журнал действий' })).toContainText('Снятие заморозки');
    await screenshot('logs-desktop.png');
    await context.request.post(`${app.baseURL}/api/internal/discord-events`, {
      headers: { 'X-Events-Secret': 'integration-events-secret-32-characters' },
      data: { login: 'alex', discordId: '123456789', username: 'alex.discord', bot: 'TestDiscordBot', action: 'discord_linked', ip: '' },
    });
    await page.getByLabel('Тип событий', { exact: true }).selectOption('');
    await page.getByLabel('Поиск в логах', { exact: true }).fill('alex.discord');
    await expect(page.getByRole('columnheader', { name: 'Telegram / Discord', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Откуда', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Куда / объект', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Журнал действий' })).toContainText('alex.discord');
    await page.getByRole('button', { name: /^Подробности события/ }).first().click();
    await expect(page.locator('.event-details-row')).toContainText('123456789');
    await screenshot('logs-identity-desktop.png');
  });

  await t.test("only botoli1 can manage roles in the players table", async () => {
    await page.goto(`${app.baseURL}/players`);
    await expect(page.getByLabel('Роль alex', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Поддержка', exact: true })).toHaveCount(0);
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const playerContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      await ownerPage.goto(`${app.baseURL}/login`);
      await ownerPage.getByLabel('Логин', { exact: true }).fill('botoli1');
      await ownerPage.getByLabel('Пароль', { exact: true }).fill('test-password');
      await ownerPage.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(ownerPage).toHaveURL(/\/profile$/);
      await ownerPage.goto(`${app.baseURL}/players`);
      await expect(ownerPage.getByLabel('Роль botoli1', { exact: true })).toBeDisabled();
      await ownerPage.getByLabel('Роль alex', { exact: true }).selectOption('admin');
      await expect(ownerPage.locator('.notice.success')).toContainText('Роль игрока alex изменена');
      const playerPage = await playerContext.newPage();
      await playerPage.goto(`${app.baseURL}/login`);
      await playerPage.getByLabel('Логин', { exact: true }).fill('alex');
      await playerPage.getByLabel('Пароль', { exact: true }).fill('test-password');
      await playerPage.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(playerPage).toHaveURL(/\/profile$/);
      await playerPage.goto(`${app.baseURL}/logs`);
      await expect(playerPage.getByRole('heading', { name: 'Логи игроков', exact: true })).toBeVisible();
      await ownerPage.getByLabel('Роль alex', { exact: true }).selectOption('player');
      await expect(ownerPage.locator('.notice.success')).toContainText('«Игрок»');
      await playerPage.reload();
      await expect(playerPage).toHaveURL(/\/profile$/);
      await expect(playerPage.getByRole('link', { name: 'Логи', exact: true })).toHaveCount(0);
      await ownerPage.screenshot({ path: path.join(artifacts, 'roles-desktop.png'), fullPage: true });
    } finally { await ownerContext.close(); await playerContext.close(); }
  });

  await t.test("desktop pages fit the viewport", async () => {
    for (const { width, height, routes } of [
      {
        width: 1440,
        height: 900,
        routes: ["/", "/mods", "/players", "/profile"],
      },
      {
        width: 1366,
        height: 768,
        routes: ["/", "/mods", "/players", "/profile"],
      },
    ]) {
      await page.setViewportSize({ width, height });
      for (const route of routes) {
        await page.goto(`${app.baseURL}${route}`);
        const size = await page.evaluate(() => ({
          document: document.documentElement.scrollHeight - window.innerHeight,
          content:
            document.querySelector(".page-content").scrollHeight -
            document.querySelector(".page-content").clientHeight,
          horizontal: document.documentElement.scrollWidth - window.innerWidth,
        }));
        assert.ok(
          size.document <= 1 && size.content <= 1 && size.horizontal <= 1,
          `${width}×${height} ${route}: ${JSON.stringify(size)}`,
        );
        if (width === 1366 && route === "/") await screenshot("dashboard-compact.png");
      }
    }
  });

  await t.test(
    "mobile layouts and navigation without horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [route, title, screenshotName] of [
        ["/", "Твоя следующая сборка", "dashboard-mobile.png"],
        ["/mods", "Моди и конфиги", "mods-mobile.png"],
        ["/players", "Люди, которые создают мир", "players-mobile.png"],
        ["/profile", "Твой профиль", "profile-mobile.png"],
        ["/logs", "Логи игроков", "logs-mobile.png"],
        ["/players/alex", "alex", "player-actions-mobile.png"],
      ]) {
        await page.goto(`${app.baseURL}${route}`);
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          `Horizontal overflow on ${route}`,
        );
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollHeight <= window.innerHeight + 1,
          ),
          true,
          `Document overflow on ${route}`,
        );
        await screenshot(screenshotName);
      }
      await page.getByRole("button", { name: "Открыть меню" }).click();
      await page.getByRole("link", { name: "Моди и конфиги", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Моди и конфиги" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Открыть меню" }),
      ).toHaveAttribute("aria-expanded", "false");
    },
  );

  await t.test("logout clears cookie and protects the next visit", async () => {
    await page.getByRole("button", { name: "Открыть меню" }).click();
    await page.getByRole("button", { name: "Выйти из аккаунта" }).click();
    await expect(
      page.getByRole("heading", { name: "С возвращением" }),
    ).toBeVisible();
    assert.equal(
      (await context.cookies()).some(
        (cookie) => cookie.name === "mc_launcher_token",
      ),
      false,
    );
    await screenshot("login-mobile.png");
    await page.goto(`${app.baseURL}/players`);
    await expect(page).toHaveURL(/\/login\?redirect=%2Fplayers/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot("login-desktop.png");
    assert.deepEqual(pageErrors, []);
  });

  await t.test(
    "login and registration stay within the browser canvas",
    async () => {
      for (const { width, height } of [
        { width: 1366, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize({ width, height });
        for (const route of ["/login", "/register"]) {
          await page.goto(`${app.baseURL}${route}`);
          const size = await page.evaluate(() => ({
            document:
              document.documentElement.scrollHeight - window.innerHeight,
            horizontal:
              document.documentElement.scrollWidth - window.innerWidth,
            content:
              document.querySelector(".auth-main").scrollHeight -
              document.querySelector(".auth-main").clientHeight,
          }));
          assert.ok(
            size.document <= 1 && size.horizontal <= 1,
            `${width}×${height} ${route}: ${JSON.stringify(size)}`,
          );
          if (width >= 1000)
            assert.ok(
              size.content <= 1,
              `${width}×${height} ${route}: ${JSON.stringify(size)}`,
            );
        }
      }
    },
  );
});
