const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const { startTestApp } = require("./test-app");

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
    const saved = JSON.parse(
      await fs.readFile(
        path.join(app.fixture, "data/build-config.json"),
        "utf8",
      ),
    );
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
      await page.getByRole("link", { name: "Моды", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Моды твоего мира" }),
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
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await screenshot("players-desktop.png");
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
        ["/mods", "Моды твоего мира", "mods-mobile.png"],
        ["/players", "Люди, которые создают мир", "players-mobile.png"],
        ["/profile", "Твой профиль", "profile-mobile.png"],
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
      await page.getByRole("link", { name: "Моды", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Моды твоего мира" }),
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
