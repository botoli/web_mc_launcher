const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 15000 });
const { startTestApp } = require("./test-app");
const { makeZip } = require("./zip-fixture");
const playerConfig = require("../apps/web/player-site.config.json");
const botURL = `https://t.me/${playerConfig.telegramBotUsername.trim().replace(/^@/, "")}`;

test(
  "public player pages, two persistent themes and latest anonymous download",
  { timeout: 180000 },
  async (t) => {
    const app = await startTestApp();
    t.after(() => app.stop());
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await context.addInitScript(() => {
      localStorage.setItem("nevermoreland-seasonal-design", "off");
      if (!localStorage.getItem("nevermoreland-player-theme"))
        localStorage.setItem("nevermoreland-player-theme", "regular");
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const privateDomains = /launcher\.nevermoreland\.ru|87\.58\.220\.248/;

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(viewport);
      const response = await page.goto(`${app.baseURL}/play`);
      assert.equal(response.status(), 200);
      assert.doesNotMatch(await response.text(), privateDomains);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Твоя история",
      );
      await expect(page.locator("main a")).toHaveCount(2);
      await expect(
        page.getByRole("link", { name: "Скачать для Windows", exact: true }),
      ).toHaveAttribute("href", "/play/download");
      await expect(page.locator("form, input")).toHaveCount(0);
      if (viewport.width === 1440)
        await expect(page.locator(".player-site")).toHaveAttribute(
          "data-theme",
          "original",
        );
      await expect(
        page
          .getByRole("group", { name: "Оформление сайта" })
          .getByRole("button"),
      ).toHaveCount(2);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page
          .locator(".player-site")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      for (const button of await page.locator("main a").all())
        await expect(button).toBeInViewport();

      await page
        .getByRole("button", { name: "Оригинальная тема", exact: true })
        .click();
      await page.reload();
      await expect(page.locator(".player-site")).toHaveAttribute(
        "data-theme",
        "original",
      );
      await expect(
        page.getByRole("button", { name: "Оригинальная тема", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.locator('.player-backdrop-layer[data-active="true"] img'),
      ).toHaveAttribute("src", /player-original-desktop-/);
      await page
        .getByRole("link", { name: "Как начать играть", exact: true })
        .click();
      await expect(page).toHaveURL(`${app.baseURL}/play/how-to-play`);
      await expect(page.locator(".player-site")).toHaveAttribute(
        "data-theme",
        "original",
      );
      await page.getByRole("button", { name: "Хеллоуин", exact: true }).click();
      await page.reload();
      await expect(page.locator(".player-site")).toHaveAttribute(
        "data-theme",
        "halloween",
      );
      await expect(
        page.locator('.player-backdrop-layer[data-active="true"] img'),
      ).toHaveAttribute("src", /player-halloween-desktop-/);
      await expect(page.locator(".player-step")).toHaveCount(3);
      await page
        .getByText("Нужно ли создавать аккаунт на сайте?", { exact: true })
        .click();
      await expect(page.locator(".player-faq details").first()).toHaveAttribute(
        "open",
        "",
      );
      assert.equal(
        await page
          .locator(".player-site")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await expect(page.locator(".player-bot-handle")).toHaveAttribute(
        "href",
        botURL,
      );
      await expect(page.locator(".player-bot-development")).toContainText(
        "В разработке",
      );
      await expect(
        page.locator(
          ".player-bot-development a, .player-bot-development button",
        ),
      ).toHaveCount(0);
      await page
        .getByRole("link", {
          name: "Подробно о входе и регистрации",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(`${app.baseURL}/play/telegram`);
      await expect(page.locator(".player-site")).toHaveAttribute(
        "data-theme",
        "halloween",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.locator(".player-scenarios article")).toHaveCount(3);
      await expect(page.locator(".player-guide-nav-bot a")).toHaveAttribute(
        "href",
        botURL,
      );
      await page
        .getByRole("navigation", { name: "Разделы инструкции" })
        .getByRole("link", { name: /Если что-то не так/ })
        .click();
      await expect(page.locator("#issues-title")).toBeInViewport();
      const codeHelp = page.getByText("Код не принимается или истёк", {
        exact: true,
      });
      await codeHelp.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.locator(".player-auth-faq details").first(),
      ).toHaveAttribute("open", "");
      assert.equal(
        await page
          .locator(".player-site")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page
        .getByRole("link", { name: "Как начать играть", exact: true })
        .click();
      await page.getByRole("link", { name: "На главную", exact: true }).click();
      await expect(page.locator(".player-site")).toHaveJSProperty(
        "scrollTop",
        0,
      );
      await page.getByRole("button", { name: "Хеллоуин", exact: true }).click();
      await expect(
        page.locator('.player-backdrop-layer[data-active="true"] img'),
      ).toHaveAttribute("src", /player-halloween-desktop-/);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await fs.mkdir(path.resolve(__dirname, "../artifacts/player-site"), {
      recursive: true,
    });
    await page.screenshot({
      path: path.resolve(
        __dirname,
        "../artifacts/player-site/home-desktop.png",
      ),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.resolve(__dirname, "../artifacts/player-site/home-mobile.png"),
      animations: "disabled",
    });
    await page
      .getByRole("link", { name: "Как начать играть", exact: true })
      .click();
    await page.screenshot({
      path: path.resolve(
        __dirname,
        "../artifacts/player-site/guide-mobile.png",
      ),
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    await context.close();

    await t.test(
      "slow and superseded images keep the previous scene visible during a crossfade",
      async () => {
        const animationContext = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        const preview = await animationContext.newPage();
        try {
          await preview.goto(`${app.baseURL}/play`);
          await expect(
            preview.locator('.player-backdrop-layer[data-active="true"]'),
          ).toHaveCSS("opacity", "1");
          let releaseImage, markRequested;
          const gate = new Promise((resolve) => {
            releaseImage = resolve;
          });
          const requested = new Promise((resolve) => {
            markRequested = resolve;
          });
          await preview.route(
            "**/player-halloween-desktop-*.webp",
            async (route) => {
              markRequested();
              await gate;
              await route.continue();
            },
          );
          await preview
            .getByRole("button", { name: "Хеллоуин", exact: true })
            .click();
          await requested;
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          await expect(
            preview.locator('.player-backdrop-layer[data-active="true"]'),
          ).toHaveCSS("opacity", "1");
          await preview
            .getByRole("button", { name: "Оригинальная тема", exact: true })
            .click();
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          releaseImage();
          await preview
            .locator('.player-backdrop-layer[data-theme="halloween"] img')
            .evaluate(async (image) => {
              await image.decode();
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
            });
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          await preview
            .getByRole("button", { name: "Хеллоуин", exact: true })
            .click();
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "halloween",
          );
          const blend = await preview
            .locator('.player-backdrop-layer[data-active="true"]')
            .evaluate((element) => {
              const animation = element.getAnimations()[0];
              if (!animation) return null;
              animation.pause();
              animation.currentTime =
                Number(animation.effect.getTiming().duration) / 2;
              const opacity = Number(getComputedStyle(element).opacity);
              const previous = Number(
                getComputedStyle(
                  element.parentElement.querySelector(
                    '[data-theme="original"]',
                  ),
                ).opacity,
              );
              animation.finish();
              return { opacity, previous };
            });
          assert.ok(
            blend && blend.opacity > 0 && blend.opacity < 1,
            "The incoming image should blend gradually",
          );
          assert.equal(
            blend.previous,
            1,
            "The outgoing image should cover the canvas until the blend finishes",
          );
          await preview.emulateMedia({ reducedMotion: "reduce" });
          await preview
            .getByRole("button", { name: "Оригинальная тема", exact: true })
            .click();
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          await expect(
            preview.locator('.player-backdrop-layer[data-active="true"]'),
          ).toHaveCSS("transition-duration", "0s");
        } finally {
          await animationContext.close();
        }
      },
    );

    await t.test(
      "page transitions show loading and the theme indicator slides on desktop and mobile",
      async () => {
        const motionContext = await browser.newContext();
        await motionContext.addInitScript(() =>
          localStorage.setItem("nevermoreland-player-theme", "original"),
        );
        const preview = await motionContext.newPage();
        try {
          for (const width of [1440, 390]) {
            await preview.setViewportSize({ width, height: 900 });
            await preview.goto(`${app.baseURL}/play`);
            await expect(preview.locator(".player-site")).toHaveAttribute(
              "data-theme",
              "original",
            );
            const switcher = preview.locator(".player-themes");
            const initial = await switcher.evaluate(
              (el) =>
                new DOMMatrix(getComputedStyle(el, "::before").transform).m41,
            );
            assert.ok(
              initial > 0,
              "The initial indicator should sit over the right theme",
            );
            await preview
              .getByRole("button", { name: "Хеллоуин", exact: true })
              .click();
            await expect
              .poll(() =>
                switcher.evaluate(
                  (el) =>
                    new DOMMatrix(getComputedStyle(el, "::before").transform)
                      .m41,
                ),
              )
              .toBe(0);
            assert.equal(
              await switcher.evaluate((el) => el.scrollWidth <= el.clientWidth),
              true,
            );

            // Capture the loading state synchronously, including for prefetched pages.
            const loadingShown = await preview
              .getByRole("link", { name: "Как начать играть", exact: true })
              .evaluate(async (link) => {
                link.click();
                await new Promise((resolve) => requestAnimationFrame(resolve));
                return document.querySelector(".player-navigation-screen")
                  .dataset.visible;
              });
            assert.equal(loadingShown, "true");
            await expect(preview).toHaveURL(`${app.baseURL}/play/how-to-play`);
            await expect(
              preview.locator(".player-navigation-screen"),
            ).toBeHidden();
            await preview
              .getByRole("link", {
                name: "Подробно о входе и регистрации",
                exact: true,
              })
              .click();
            await expect(preview).toHaveURL(`${app.baseURL}/play/telegram`);
            await expect(
              preview.locator(".player-navigation-screen"),
            ).toBeHidden();
            await preview
              .getByRole("navigation", { name: "Разделы инструкции" })
              .getByRole("link", { name: /Если что-то не так/ })
              .click();
            await expect(
              preview.locator(".player-navigation-screen"),
            ).toHaveAttribute("data-visible", "false");
            await expect(preview.locator("#issues-title")).toBeInViewport();
          }
          await preview.emulateMedia({ reducedMotion: "reduce" });
          assert.equal(
            await preview
              .locator(".player-themes")
              .evaluate(
                (el) => getComputedStyle(el, "::before").transitionDuration,
              ),
            "0s",
          );
        } finally {
          await motionContext.close();
        }
      },
    );

    await t.test(
      "mobile only downloads selected portrait WebP and can retry a failed theme",
      async () => {
        const mobileContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
        });
        const preview = await mobileContext.newPage();
        const requests = [];
        preview.on("request", (request) => {
          if (/\/backgrounds\/player-/.test(request.url()))
            requests.push(request.url());
        });
        try {
          await preview.goto(`${app.baseURL}/play`);
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          assert.equal(
            requests.length,
            1,
            "Unused themes should not download at startup",
          );
          await preview.route("**/player-halloween-mobile-*.webp", (route) =>
            route.abort(),
          );
          await preview
            .getByRole("button", { name: "Хеллоуин", exact: true })
            .click();
          await expect(preview.getByRole("status")).toContainText(
            "Не удалось загрузить оформление",
          );
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          await preview.unroute("**/player-halloween-mobile-*.webp");
          await preview
            .getByRole("button", { name: "Хеллоуин", exact: true })
            .click();
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "halloween",
          );
          await preview
            .getByRole("button", { name: "Оригинальная тема", exact: true })
            .click();
          await expect(preview.locator(".player-site")).toHaveAttribute(
            "data-theme",
            "original",
          );
          assert.ok(
            requests.every((url) => url.includes("-mobile-")),
            "Phones should not download desktop images",
          );
          const cachedAsset = await fetch(requests.at(-1));
          assert.equal(
            cachedAsset.headers.get("cache-control"),
            "public, max-age=31536000, immutable",
          );
        } finally {
          await mobileContext.close();
        }
      },
    );

    await fs.unlink(
      path.join(app.fixture, "data/clients/launcher-portable.zip"),
    );
    const missing = await fetch(`${app.baseURL}/play/download`, {
      redirect: "manual",
    });
    assert.equal(missing.status, 303);
    assert.equal(missing.headers.get("location"), "/play?download=unavailable");
    const fallback = await fetch(
      `${app.baseURL}${missing.headers.get("location")}`,
    );
    assert.match(await fallback.text(), /Лаунчер пока недоступен/);

    const post = (route, body) =>
      fetch(`${app.baseURL}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    await post("/api/register", {
      login: "botoli1",
      password: "player-site-test-password",
    });
    const admin = await (
      await post("/api/auth", {
        login: "botoli1",
        password: "player-site-test-password",
      })
    ).json();
    for (const version of ["0.1.1", "0.1.2"]) {
      const zip = await makeZip([
        ["Nevermore", `MZ${version}`],
        ["README.txt", "Instructions"],
      ]);
      const form = new FormData();
      form.set("version", version);
      form.set("launcher", new Blob([zip]), "launcher.zip");
      const published = await fetch(`${app.baseURL}/api/upload-launcher`, {
        method: "POST",
        headers: { Authorization: `Bearer ${admin.token}` },
        body: form,
      });
      assert.equal(published.status, 200);
      const download = await fetch(`${app.baseURL}/play/download`, {
        redirect: "manual",
      });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("location"), null);
      assert.equal(download.headers.get("set-cookie"), null);
      assert.equal(download.headers.get("content-type"), "application/zip");
      assert.match(
        download.headers.get("content-disposition"),
        new RegExp(
          `Nevermoreland-Launcher-${version.replaceAll(".", "\\.")}.zip`,
        ),
      );
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), zip);
      assert.doesNotMatch(
        JSON.stringify([...download.headers]),
        privateDomains,
      );
    }
  },
);
