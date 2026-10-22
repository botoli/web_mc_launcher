const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const { startTestApp } = require("./test-app");
const { makeZip, readZip } = require("./zip-fixture");

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
    assert.equal(config.configsHash, "empty");
    assert.equal(config.configsURL, null);
    assert.equal(config.configsDirectory, "configs");
    assert.equal(
      (await fetch(`${app.baseURL}/api/download-configs`)).status,
      404,
    );
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
  await post("/api/register", {
    login: "botoli1",
    password: "test-password",
    nickname: "botoli1",
  });
  const roleManager = await (
    await post("/api/auth", { login: "botoli1", password: "test-password" })
  ).json();
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
    "auth forms render on the server and work when browser scripts are unavailable",
    async (nativeTest) => {
      const app = await startTestApp();
      nativeTest.after(() => app.stop());
      for (const javaScriptEnabled of [false, true]) {
        const nativeContext = await browser.newContext({ javaScriptEnabled });
        try {
          // Both disabled JS and failed chunk downloads must leave a usable form.
          if (javaScriptEnabled)
            await nativeContext.route("**/_next/**/*.js", (route) =>
              route.abort(),
            );
          const nativePage = await nativeContext.newPage();
          const login = javaScriptEnabled ? "blocked_scripts" : "native_player";
          const password = "native-form-test-password";
          const response = await nativePage.goto(`${app.baseURL}/register`);
          assert.match(await response.text(), /<form\b/);
          await expect(nativePage.locator("form")).toHaveAttribute(
            "method",
            "post",
          );
          await expect(nativePage.locator("form")).toHaveAttribute(
            "action",
            "/api/web-auth/register",
          );
          await nativePage.getByLabel("Логин", { exact: true }).fill(login);
          await nativePage.getByLabel("Пароль", { exact: true }).fill(password);
          await nativePage
            .getByRole("button", { name: "Создать аккаунт", exact: true })
            .click();
          await expect(nativePage).toHaveURL(
            `${app.baseURL}/login?registered=1`,
          );
          await expect(nativePage.locator(".notice.success")).toContainText(
            "Аккаунт создан",
          );

          const loginResponse = await nativePage.goto(
            `${app.baseURL}/login?redirect=%2Fprofile%3Fnative%3D1`,
          );
          assert.match(await loginResponse.text(), /<form\b/);
          await expect(nativePage.locator("form")).toHaveAttribute(
            "method",
            "post",
          );
          await expect(nativePage.locator("form")).toHaveAttribute(
            "action",
            "/api/web-auth/login",
          );
          await nativePage.getByLabel("Логин", { exact: true }).fill(login);
          await nativePage
            .getByLabel("Пароль", { exact: true })
            .fill("wrong-password");
          await nativePage
            .getByRole("button", { name: "Войти", exact: true })
            .click();
          await expect(nativePage.locator(".notice.error")).toContainText(
            "Неверный пароль",
          );
          assert.equal(
            new URL(nativePage.url()).searchParams.get("redirect"),
            "/profile?native=1",
          );
          assert.ok(!nativePage.url().includes("wrong-password"));
          await nativePage.getByLabel("Логин", { exact: true }).fill(login);
          await nativePage.getByLabel("Пароль", { exact: true }).fill(password);
          await nativePage
            .getByRole("button", { name: "Войти", exact: true })
            .click();
          await expect(nativePage).toHaveURL(`${app.baseURL}/profile?native=1`);
          await expect(
            nativePage.getByRole("heading", {
              name: "Твой профиль",
              exact: true,
            }),
          ).toBeVisible();
          assert.ok(
            (await nativeContext.cookies()).some(
              (cookie) =>
                cookie.name === "mc_launcher_token" && cookie.httpOnly,
            ),
          );
        } finally {
          await nativeContext.close();
        }
      }

      const nativePost = (redirect, origin) =>
        fetch(`${app.baseURL}/api/web-auth/login`, {
          method: "POST",
          redirect: "manual",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(origin ? { Origin: origin } : {}),
          },
          body: new URLSearchParams({
            login: "native_player",
            password: "native-form-test-password",
            redirect,
          }),
        });
      for (const redirect of [
        "https://example.invalid",
        "//example.invalid",
        "/\\example.invalid",
        "http://[invalid",
      ]) {
        const response = await nativePost(redirect);
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "/profile");
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.ok(
          !(await response.text()).includes("native-form-test-password"),
        );
      }
      const crossSite = await nativePost("/profile", "https://example.invalid");
      assert.equal(crossSite.status, 403);
      assert.equal(crossSite.headers.get("set-cookie"), null);
      const legacy = await fetch(`${app.baseURL}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          login: "native_player",
          password: "native-form-test-password",
        }),
      });
      assert.equal(legacy.status, 200);
      assert.equal((await legacy.json()).success, true);
    },
  );

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
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${roleManager.token}`,
        },
        body: JSON.stringify({ role: "admin" }),
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

  await t.test("build save, persistence and reset", async () => {
    await page.getByRole("link", { name: "Сборка", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Твоя следующая сборка" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Сохранить сборку" }),
    ).toBeDisabled();
    const original = (await app.snapshot()).settings.build;
    await page
      .getByLabel("Адрес игрового сервера", { exact: true })
      .fill("play.example.test:25565");
    await page.getByRole("button", { name: "Сохранить сборку" }).click();
    await expect(page.locator(".notice.success")).toContainText(
      "Сборка сохранена",
    );
    const saved = (await app.snapshot()).settings.build;
    assert.equal(saved.minMemory, original.minMemory);
    assert.equal(saved.maxMemory, original.maxMemory);
    assert.equal(saved.servers[0].address, "play.example.test:25565");
    assert.equal(saved.launcherServer, `http://localhost:${app.backendPort}`);
    await page
      .getByLabel("Адрес игрового сервера", { exact: true })
      .fill("other.example.test:25565");
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(
      page.getByLabel("Адрес игрового сервера", { exact: true }),
    ).toHaveValue("play.example.test:25565");
    await screenshot("dashboard-desktop.png");
  });

  await t.test(
    "launcher upload publishes latest version and keeps old downloads",
    async () => {
      const previous = await (
        await fetch(`${app.baseURL}/api/client-info`)
      ).json();
      assert.equal(previous.version, "1.0.0");
      const oldDownload = await fetch(`${app.baseURL}/api/download-launcher`);
      assert.equal(await oldDownload.text(), "Test launcher fixture");
      const launcherZip = (contents) =>
        makeZip([
          ["Nevermore", contents],
          ["README.txt", "Installation instructions"],
        ]);
      const form = (version, contents) => {
        const body = new FormData();
        body.set("version", version);
        body.set("launcher", new Blob([contents]), "launcher.zip");
        return body;
      };
      const player = await (
        await post("/api/auth", { login: "alex", password: "test-password" })
      ).json();
      assert.equal(
        (
          await fetch(`${app.baseURL}/api/upload-launcher`, {
            method: "POST",
            headers: { Authorization: `Bearer ${player.token}` },
            body: form("2.0.0", await launcherZip("MZplayer")),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${app.baseURL}/api/upload-launcher`, {
            method: "POST",
            headers: { Authorization: `Bearer ${roleManager.token}` },
            body: form("../bad", await launcherZip("MZinvalid")),
          })
        ).status,
        400,
      );

      const firstZip = await launcherZip("MZfirst version");
      await page.getByLabel("ZIP лаунчера Windows").setInputFiles({
        name: "launcher.zip",
        mimeType: "application/zip",
        buffer: firstZip,
      });
      await page.getByLabel("Версия лаунчера").fill("2.0.0");
      await page.getByRole("button", { name: "Опубликовать версию" }).click();
      await expect(page.locator(".client-panel .notice.success")).toContainText(
        "опубликована",
      );
      const first = await (
        await fetch(`${app.baseURL}/api/launcher-update?platform=windows-x64`)
      ).json();
      assert.equal(first.version, "2.0.0");
      assert.equal(first.size, firstZip.length);
      assert.equal(new URL(first.url).pathname, "/download/launcher/2.0.0.zip");
      assert.deepEqual(
        Buffer.from(await (await fetch(first.url)).arrayBuffer()),
        firstZip,
      );
      assert.match(
        await (await fetch(`${app.baseURL}/login`)).text(),
        /Скачать лаунчер/,
      );

      const secondZip = await launcherZip("MZsecond version");
      const next = await fetch(`${app.baseURL}/api/upload-launcher`, {
        method: "POST",
        headers: { Authorization: `Bearer ${roleManager.token}` },
        body: form("2.0.1", secondZip),
      });
      assert.equal(next.status, 200);
      assert.equal(
        (
          await (
            await fetch(
              `${app.baseURL}/api/launcher-update?platform=windows-x64`,
            )
          ).json()
        ).version,
        "2.0.1",
      );
      assert.deepEqual(
        Buffer.from(await (await fetch(first.url)).arrayBuffer()),
        firstZip,
      );
      assert.deepEqual(
        Buffer.from(
          await fs.readFile(
            path.join(app.fixture, "data/launcher/releases/2.0.0.zip"),
          ),
        ),
        firstZip,
      );
      await page.getByRole("link", { name: "Мой профиль" }).click();
      await expect(
        page.getByRole("link", { name: "Скачать последнюю версию" }),
      ).toBeVisible();
    },
  );

  await t.test(
    "mod upload, search, download and confirmed deletion",
    async () => {
      await page
        .getByRole("link", { name: "Моды и конфиги", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Моды и конфиги" }),
      ).toBeVisible();
      await page.locator("#mod-file").setInputFiles({
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

  await t.test(
    "config ZIP upload, launcher archive layout, replacement and access control",
    async () => {
      const before = await (
        await fetch(`${app.baseURL}/api/client-config`)
      ).json();
      const zip = await makeZip([
        ["configs/example.toml", "value=1"],
        ["configs/nested/options.json", "{}"],
      ]);
      const form = () => {
        const body = new FormData();
        body.append("configs", new Blob([zip]), "settings.zip");
        return body;
      };
      assert.equal(
        (
          await fetch(`${app.baseURL}/api/upload-configs`, {
            method: "POST",
            body: form(),
          })
        ).status,
        401,
      );
      const player = await (
        await post("/api/auth", { login: "steve", password: "test-password" })
      ).json();
      assert.equal(
        (
          await fetch(`${app.baseURL}/api/upload-configs`, {
            method: "POST",
            headers: { Authorization: `Bearer ${player.token}` },
            body: form(),
          })
        ).status,
        403,
      );
      await page
        .locator("#configs-file")
        .setInputFiles({
          name: "settings.zip",
          mimeType: "application/zip",
          buffer: zip,
        });
      await page
        .getByRole("button", { name: "Загрузить конфиги", exact: true })
        .click();
      await expect(
        page.locator(".configs-section .notice.success"),
      ).toContainText("Конфиги загружены");
      await expect(page.locator(".configs-section")).toContainText(
        "settings.zip",
      );
      await expect(page.locator(".configs-section")).toContainText("Файлов: 2");
      const config = await (
        await fetch(`${app.baseURL}/api/client-config`)
      ).json();
      assert.notEqual(config.modsHash, before.modsHash);
      assert.match(config.configsHash, /^[a-f0-9]{64}$/);
      assert.equal(
        config.configsURL,
        `http://localhost:${app.backendPort}/api/download-configs`,
      );
      const download = async (route) =>
        readZip(
          Buffer.from(
            await (await fetch(`${app.baseURL}${route}`)).arrayBuffer(),
          ),
        );
      const configs = await download("/api/download-configs");
      assert.deepEqual(configs, {
        "configs/example.toml": "value=1",
        "configs/nested/options.json": "{}",
      });
      const bundle = await download("/api/download-mods");
      assert.equal(bundle["configs/example.toml"], "value=1");
      assert.equal(bundle["configs/nested/options.json"], "{}");
      assert.equal(
        Object.keys(bundle).filter((name) => name.startsWith("mods/")).length,
        3,
      );
      assert.ok(
        Object.keys(bundle).every(
          (name) => name.startsWith("mods/") || name.startsWith("configs/"),
        ),
      );
      await page.reload();
      await expect(page.locator(".configs-section")).toContainText(
        "settings.zip",
      );
      const replacement = await makeZip([["example.toml", "value=2"]]);
      await page
        .locator("#configs-file")
        .setInputFiles({
          name: "replacement.zip",
          mimeType: "application/zip",
          buffer: replacement,
        });
      await expect(
        page.locator(".configs-section .selected-file"),
      ).toContainText("Заменит текущий набор");
      await page
        .getByRole("button", { name: "Загрузить конфиги", exact: true })
        .click();
      await expect(
        page.locator(".configs-section .notice.success"),
      ).toContainText("Конфиги загружены");
      const changed = await (
        await fetch(`${app.baseURL}/api/client-config`)
      ).json();
      assert.notEqual(changed.configsHash, config.configsHash);
      assert.notEqual(changed.modsHash, config.modsHash);
      assert.deepEqual(await download("/api/download-configs"), {
        "configs/example.toml": "value=2",
      });
      await page
        .locator("#configs-file")
        .setInputFiles({
          name: "broken.zip",
          mimeType: "application/zip",
          buffer: Buffer.from("broken"),
        });
      await page
        .getByRole("button", { name: "Загрузить конфиги", exact: true })
        .click();
      await expect(
        page.locator(".configs-section .notice.error"),
      ).toContainText("ZIP");
      assert.equal(
        (await (await fetch(`${app.baseURL}/api/client-config`)).json())
          .configsHash,
        changed.configsHash,
      );
      await page.getByRole("button", { name: "Отменить выбор архива" }).click();
      const journal = await app.snapshot();
      assert.deepEqual(
        journal.events
          .filter((event) => event.action.startsWith("configs_"))
          .map((event) => event.action),
        ["configs_added", "configs_replaced"],
      );
      await page.reload();
      await expect(page.locator(".configs-section")).toContainText(
        "replacement.zip",
      );
      await screenshot("mods-configs-desktop.png");
    },
  );

  await t.test("player search, filtering and status persistence", async () => {
    await page.getByRole("link", { name: "Игроки", exact: true }).click();
    await page.getByRole("textbox", { name: "Поиск игроков" }).fill("builder");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Статус builder", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Перевести в ожидание", exact: true })
      .click();
    await expect(page.locator(".notice.success")).toContainText(
      "Статус игрока builder обновлён",
    );
    await page
      .getByRole("button", { name: "Действия builder", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Заблокировать", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Статус builder", exact: true }),
    ).toContainText("Заблокирован");
    await page
      .getByRole("button", { name: "Действия builder", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Разблокировать", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Статус builder", exact: true }),
    ).toContainText("Ожидает");
    await page.getByLabel("Фильтр по статусу").selectOption("confirmed");
    await expect(
      page.getByRole("heading", {
        name: "По вашему запросу ничего не найдено",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(4);
    await screenshot("players-desktop.png");
  });

  await t.test(
    "player and log tables render before browser scripts execute",
    async () => {
      for (const scriptsEnabled of [false, true]) {
        const slowContext = await browser.newContext({
          javaScriptEnabled: scriptsEnabled,
        });
        try {
          await slowContext.addCookies(await context.cookies());
          const slowPage = await slowContext.newPage();
          if (scriptsEnabled)
            await slowPage.route("**/*", (route) =>
              route.request().resourceType() === "script"
                ? route.abort()
                : route.continue(),
            );
          const requests = [];
          slowPage.on("request", (request) => {
            if (request.url().includes("/api/admin/"))
              requests.push(request.url());
          });
          await slowPage.goto(`${app.baseURL}/players`);
          await expect(slowPage.locator(".players-table tbody tr")).toHaveCount(
            4,
          );
          await expect(slowPage.locator(".player-skeleton-row")).toHaveCount(0);
          await slowPage.goto(
            `${app.baseURL}/logs?players=alex&source=website`,
          );
          await expect(slowPage.locator(".event-row").first()).toBeVisible();
          await expect(slowPage.locator(".event-skeleton")).toHaveCount(0);
          assert.equal(
            (await slowPage.locator(".event-row").count()) > 0,
            true,
          );
          assert.equal(
            requests.length,
            0,
            "initial rows must come with HTML, without client API requests",
          );
        } finally {
          await slowContext.close();
        }
      }
    },
  );

  await t.test(
    "player table pagination, identifiers, menus, loading and errors",
    async () => {
      const clock = Date.now();
      let mockPlayers = Array.from({ length: 57 }, (_, index) => ({
        login: `test_${String(index).padStart(3, "0")}`,
        nickname: `Player ${index}`,
        email: `person${index}@example.test`,
        registrationStatus: index % 3 === 0 ? "pending" : "confirmed",
        role: index % 5 === 0 ? "admin" : "player",
        registeredAt: clock - index * 86400000,
        lastLogin: index % 2 ? clock - index * 3600000 : null,
        telegramUsername: `telegram_${index}`,
        discordUsername: `discord_${index}`,
        telegramId: String(100000 + index),
        discordId: String(200000 + index),
        canManageRoles: false,
        frozenUntil: null,
        moderationReason: "",
      }));
      let fail = false;
      let delay = 0;
      const handler = async (route) => {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        await route.fulfill({
          status: fail ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(
            fail ? { error: "Тестовая ошибка загрузки" } : mockPlayers,
          ),
        });
      };
      await page.route("**/api/admin/players", handler);
      try {
        await page.goto(`${app.baseURL}/players`);
        // Initial rows are server-rendered; the refresh button exercises client requests.
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        await expect(page.locator("tbody tr")).toHaveCount(25);
        await expect(page.getByRole("checkbox")).toHaveCount(0);
        await expect(page.getByRole("columnheader")).toHaveCount(6);
        const rowHeight = await page
          .locator("tbody tr")
          .first()
          .evaluate((row) => row.getBoundingClientRect().height);
        assert.ok(
          rowHeight >= 60 && rowHeight <= 68,
          `Row height: ${rowHeight}`,
        );
        const scroll = await page
          .locator(".players-table-scroll")
          .evaluate((el) => ({
            height: el.clientHeight,
            scroll: el.scrollHeight,
          }));
        assert.equal(scroll.height, scroll.scroll);
        await page.getByRole("button", { name: "Следующая страница" }).click();
        await expect(page.locator(".players-pagination nav")).toContainText(
          "2 / 3",
        );
        await expect(page.locator("tbody tr").first()).toContainText(
          "test_025",
        );
        await page.getByLabel("Игроков на странице").selectOption("50");
        await expect(page.locator("tbody tr")).toHaveCount(50);
        await page.getByLabel("Игроков на странице").selectOption("100");
        await expect(page.locator("tbody tr")).toHaveCount(57);
        for (const query of [
          "TEST_007",
          "Player 7",
          "person7@",
          "telegram_7",
          "discord_7",
          "100007",
          "200007",
        ]) {
          await page.getByLabel("Поиск игроков", { exact: true }).fill(query);
          await expect(page.locator("tbody tr")).toHaveCount(1);
          await expect(page.locator("tbody tr")).toContainText("test_007");
        }
        await page
          .getByRole("button", { name: "Очистить поиск игроков" })
          .click();
        await page.getByLabel("Фильтр по роли").selectOption("admin");
        await expect(page.locator("tbody tr")).toHaveCount(12);
        await page.getByLabel("Фильтр по статусу").selectOption("pending");
        await expect(page.locator("tbody tr")).toHaveCount(4);
        await page.getByLabel("Фильтр по активности").selectOption("never");
        await expect(page.locator("tbody tr")).toHaveCount(2);
        await page.getByLabel("Поиск игроков", { exact: true }).fill("absent");
        await expect(
          page.getByText("По вашему запросу ничего не найдено", {
            exact: true,
          }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Сбросить фильтры" }).click();
        await page.getByLabel("Игроков на странице").selectOption("25");
        await page
          .getByRole("button", { name: "Последний вход", exact: true })
          .click();
        await expect(
          page.getByRole("columnheader", { name: "Последний вход" }),
        ).toHaveAttribute("aria-sort", "ascending");
        await expect(page.locator("tbody tr").first()).toContainText(
          "test_055",
        );
        await page
          .getByRole("button", { name: "Последний вход", exact: true })
          .click();
        await expect(page.locator("tbody tr").first()).toContainText(
          "test_001",
        );
        const actions = page.getByRole("button", {
          name: "Действия test_001",
          exact: true,
        });
        await actions.focus();
        await page.keyboard.press("ArrowDown");
        await expect(
          page.getByRole("menuitem", { name: "Открыть профиль", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("End");
        await expect(
          page.getByRole("menuitem", { name: "Заблокировать", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await expect(actions).toBeFocused();
        await actions.click();
        await page
          .getByRole("menuitem", { name: "Изменить статус", exact: true })
          .click();
        await expect(
          page.getByRole("menu", { name: "Статус test_001", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: "Статус test_001", exact: true }),
        ).toBeFocused();
        await actions.click();
        await page
          .getByRole("heading", {
            name: "Люди, которые создают мир",
            exact: true,
          })
          .click();
        await expect(page.getByRole("menu")).toHaveCount(0);
        await screenshot("players-dense-desktop.png");
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole("button", { name: "Обновить", exact: true }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.locator(".players-table-scroll").evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        await actions.click();
        await expect(
          page.getByRole("menuitem", { name: "Открыть профиль", exact: true }),
        ).toBeInViewport();
        await page.keyboard.press("Escape");
        await screenshot("players-dense-mobile.png");
        await page.setViewportSize({ width: 1440, height: 1100 });
        delay = 600;
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        await expect(page.locator(".player-skeleton-row")).toHaveCount(25);
        await expect(page.locator(".player-skeleton-row")).toHaveCount(0);
        delay = 0;
        fail = true;
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Не удалось загрузить игроков",
            exact: true,
          }),
        ).toBeVisible();
        fail = false;
        await page
          .getByRole("button", { name: "Повторить", exact: true })
          .click();
        await expect(page.locator("tbody tr")).toHaveCount(25);
        fail = true;
        await page.reload();
        await page
          .getByRole("button", { name: "Обновить", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Не удалось загрузить игроков",
            exact: true,
          }),
        ).toBeVisible();
        fail = false;
        mockPlayers = [];
        await page
          .getByRole("button", { name: "Повторить", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Игроков пока нет", exact: true }),
        ).toBeVisible();
      } finally {
        await page.unroute("**/api/admin/players", handler);
        await page.setViewportSize({ width: 1440, height: 1100 });
      }
    },
  );

  await t.test(
    "launcher auth permits pending and rejects banned users and tokens",
    async () => {
      const credentials = { login: "steve", password: "test-password" };
      await context.request.put(
        `${app.baseURL}/api/admin/players/steve/status`,
        { data: { status: "pending" } },
      );
      const login = await (
        await post("/api/launcher-auth", credentials)
      ).json();
      assert.equal(login.success, true);
      await context.request.put(
        `${app.baseURL}/api/admin/players/steve/status`,
        { data: { status: "banned" } },
      );
      assert.equal((await post("/api/launcher-auth", credentials)).status, 403);
      assert.equal(
        (await post("/api/launcher-auth", { token: login.token })).status,
        403,
      );
      assert.equal(
        (await (await post("/api/verify", { token: login.token })).json())
          .valid,
        false,
      );
      await context.request.put(
        `${app.baseURL}/api/admin/players/steve/status`,
        { data: { status: "confirmed" } },
      );
    },
  );

  await t.test(
    "player actions, confirmation, tabbed history and global log filters",
    async () => {
      await page.goto(`${app.baseURL}/players`);
      await page.getByLabel("Поиск игроков", { exact: true }).fill("alex");
      await page
        .getByRole("button", { name: "Действия alex", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Открыть профиль", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Данные об игроке" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("heading", { name: "Доступ к лаунчеру" }),
      ).toBeVisible();
      await page
        .getByLabel("Причина ограничения", { exact: true })
        .fill("Проверка интерфейса");
      await page.getByLabel("Заморозка на часов", { exact: true }).fill("2");
      await page
        .getByRole("button", { name: "Заморозить", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page
        .getByRole("button", { name: "Заморозить", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await expect(page.locator(".player-flags")).toContainText("Заморожен до");
      await page
        .getByRole("button", { name: "Снять заморозку", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Подтвердить", exact: true })
        .click();
      await expect(page.locator(".player-flags")).not.toContainText(
        "Заморожен до",
      );
      await page
        .getByRole("tab", { name: "Все действия", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Журнал действий" }),
      ).toContainText("Заморозка");
      await page
        .getByRole("tab", { name: "Лог авторизаций", exact: true })
        .click();
      await expect(
        page.getByText("Событий пока нет", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("tab", { name: "Подключения на сервер", exact: true })
        .click();
      await expect(
        page.getByText("Событий пока нет", { exact: true }),
      ).toBeVisible();
      await screenshot("player-actions-desktop.png");
      await page.getByRole("link", { name: "Логи", exact: true }).click();
      await page.getByRole("button", { name: "Действие", exact: true }).click();
      await page
        .getByLabel("Поиск действия...", { exact: true })
        .fill("Снятие заморозки");
      await page
        .getByRole("option", { name: "Снятие заморозки", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Игроки", exact: true }).click();
      await page
        .getByLabel("Поиск по игроку или ID...", { exact: true })
        .fill("alex");
      await page
        .getByRole("option", { name: "alex alex", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("region", { name: "Журнал действий" }),
      ).toContainText("Снятие заморозки");
      await screenshot("logs-desktop.png");
      await context.request.post(`${app.baseURL}/api/internal/discord-events`, {
        headers: {
          "X-Events-Secret": "integration-events-secret-32-characters",
        },
        data: {
          login: "alex",
          discordId: "123456789",
          username: "alex.discord",
          bot: "TestDiscordBot",
          action: "discord_linked",
          ip: "",
        },
      });
      await page.getByRole("button", { name: "Сбросить", exact: true }).click();
      await page
        .getByRole("button", { name: "Обновить логи", exact: true })
        .click();
      await page.getByRole("button", { name: "Игроки", exact: true }).click();
      await page
        .getByLabel("Поиск по игроку или ID...", { exact: true })
        .fill("alex.discord");
      await expect(
        page.getByRole("option", { name: "alex alex", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("option", { name: "alex alex", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("columnheader", { name: "Контакт", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Источник", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Объект", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Журнал действий" }),
      ).toContainText("alex.discord");
      await page
        .getByRole("button", { name: /^Подробности события/ })
        .first()
        .click();
      await expect(page.locator(".event-details-row")).toContainText(
        "123456789",
      );
      await screenshot("logs-identity-desktop.png");
    },
  );

  await t.test(
    "compact log filters, history, sorting, pagination and request states",
    async () => {
      for (let index = 0; index < 35; index++)
        await context.request.post(
          `${app.baseURL}/api/internal/discord-events`,
          {
            headers: {
              "X-Events-Secret": "integration-events-secret-32-characters",
            },
            data: {
              login: "alex",
              discordId: "123456789",
              username: "alex.discord",
              bot: "TestDiscordBot",
              action: "login",
              ip: "",
            },
          },
        );
      await page.goto(`${app.baseURL}/logs`);
      const region = page.getByRole("region", { name: "Журнал действий" });
      await expect(region).toHaveAttribute("aria-busy", "false");
      const heights = await page
        .locator(".event-row")
        .evaluateAll((rows) =>
          rows.map((row) => row.getBoundingClientRect().height),
        );
      assert.ok(
        heights.length > 0 &&
          heights.every((height) => height >= 48 && height <= 56),
        JSON.stringify(heights),
      );
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Игроки", exact: true }).focus();
      await page.keyboard.press("ArrowDown");
      await page
        .getByLabel("Поиск по игроку или ID...", { exact: true })
        .fill("alex");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("option", { name: "alex alex", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page
        .getByLabel("Поиск по игроку или ID...", { exact: true })
        .fill("steve");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toContainText("Выбрано: 2");
      await expect(page).toHaveURL(/players=alex&players=steve/);
      await page.reload();
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toContainText("Выбрано: 2");
      await page.getByRole("button", { name: "Игроки", exact: true }).click();
      await page
        .getByRole("option", { name: "steve steve", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toContainText("alex");
      await page.goBack();
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toContainText("Выбрано: 2");
      await page.goForward();
      await expect(
        page.getByRole("button", { name: "Игроки", exact: true }),
      ).toContainText("alex");
      await page
        .getByRole("button", { name: "Дата и время", exact: true })
        .click();
      await expect(
        page.getByRole("columnheader", { name: "Дата и время" }),
      ).toHaveAttribute("aria-sort", "ascending");
      await page.getByRole("button", { name: "Сбросить", exact: true }).click();
      await page
        .getByLabel("Событий на странице", { exact: true })
        .selectOption("50");
      await expect(page.locator(".event-row")).toHaveCount(50);
      await page.getByRole("button", { name: "Далее", exact: true }).click();
      await expect(page.locator(".log-page-navigation")).toContainText(
        "Страница 2",
      );
      await page
        .getByRole("button", { name: "Быстрый период", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "Вчера", exact: true }).click();
      await expect(
        page.getByText("По выбранным фильтрам событий не найдено", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Сбросить фильтры", exact: true })
        .click();
      await expect(page.locator(".event-row")).toHaveCount(25);
      // The page owns vertical scrolling; its translated table header stays visible.
      await page.locator(".page-content").evaluate((node) => {
        node.scrollTop = 380;
      });
      await expect
        .poll(() =>
          page
            .locator(".logs-table thead")
            .evaluate((node) =>
              Math.abs(
                node.getBoundingClientRect().top -
                  node.closest(".page-content").getBoundingClientRect().top,
              ),
            ),
        )
        .toBeLessThanOrEqual(2);
      await page.locator(".page-content").evaluate((node) => {
        node.scrollTop = 0;
      });
      await screenshot("logs-compact-desktop.png");
      await page.route("**/api/admin/logs?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Тестовая ошибка" }),
        }),
      );
      await page
        .getByRole("button", { name: "Обновить логи", exact: true })
        .click();
      await expect(
        page.getByText("Не удалось загрузить логи", { exact: true }),
      ).toBeVisible();
      await page.unroute("**/api/admin/logs?*");
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/api/admin/logs?*", async (route) => {
        await held;
        await route.continue();
      });
      await page
        .getByRole("button", { name: "Повторить", exact: true })
        .click();
      await expect(page.locator(".event-skeleton").first()).toBeVisible();
      release();
      await expect(page.locator(".event-row")).toHaveCount(25);
      await page.unroute("**/api/admin/logs?*");
    },
  );

  await t.test(
    "only botoli1 can manage roles in the players table",
    async () => {
      await page.goto(`${app.baseURL}/players`);
      await expect(page.getByLabel("Роль alex", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("link", { name: "Поддержка", exact: true }),
      ).toHaveCount(0);
      const ownerContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const playerContext = await browser.newContext();
      try {
        const ownerPage = await ownerContext.newPage();
        await ownerPage.goto(`${app.baseURL}/login`);
        await ownerPage.getByLabel("Логин", { exact: true }).fill("botoli1");
        await ownerPage
          .getByLabel("Пароль", { exact: true })
          .fill("test-password");
        await ownerPage
          .getByRole("button", { name: "Войти", exact: true })
          .click();
        await expect(ownerPage).toHaveURL(/\/profile$/);
        await ownerPage.goto(`${app.baseURL}/players`);
        await expect(
          ownerPage.getByLabel("Роль botoli1", { exact: true }),
        ).toBeDisabled();
        await ownerPage
          .getByLabel("Роль alex", { exact: true })
          .selectOption("admin");
        await expect(ownerPage.locator(".notice.success")).toContainText(
          "Роль игрока alex изменена",
        );
        const playerPage = await playerContext.newPage();
        await playerPage.goto(`${app.baseURL}/login`);
        await playerPage.getByLabel("Логин", { exact: true }).fill("alex");
        await playerPage
          .getByLabel("Пароль", { exact: true })
          .fill("test-password");
        await playerPage
          .getByRole("button", { name: "Войти", exact: true })
          .click();
        await expect(playerPage).toHaveURL(/\/profile$/);
        await playerPage.goto(`${app.baseURL}/logs`);
        await expect(
          playerPage.getByRole("heading", {
            name: "Логи игроков",
            exact: true,
          }),
        ).toBeVisible();
        await ownerPage
          .getByLabel("Роль alex", { exact: true })
          .selectOption("player");
        await expect(ownerPage.locator(".notice.success")).toContainText(
          "«Игрок»",
        );
        await playerPage.reload();
        await expect(playerPage).toHaveURL(/\/profile$/);
        await expect(
          playerPage.getByRole("link", { name: "Логи", exact: true }),
        ).toHaveCount(0);
        await ownerPage.screenshot({
          path: path.join(artifacts, "roles-desktop.png"),
          fullPage: true,
        });
      } finally {
        await ownerContext.close();
        await playerContext.close();
      }
    },
  );

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
        if (width === 1366 && route === "/")
          await screenshot("dashboard-compact.png");
      }
    }
  });

  await t.test(
    "mobile layouts and navigation without horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [route, title, screenshotName] of [
        ["/", "Твоя следующая сборка", "dashboard-mobile.png"],
        ["/mods", "Моды и конфиги", "mods-mobile.png"],
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
      await page
        .getByRole("link", { name: "Моды и конфиги", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Моды и конфиги" }),
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
      page.getByRole("heading", { name: "Вход в панель", exact: true }),
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
