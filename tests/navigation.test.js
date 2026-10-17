const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { startTestApp } = require('./test-app');

async function assertStationaryEntrance(locator) {
    const positions = await locator.evaluate(element => {
        const animations = element.getAnimations();
        animations.forEach(animation => animation.pause());
        const positions = [0, 0.5, 1].map(progress => {
            for (const animation of animations) {
                animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
            }
            const { x, y, width } = element.getBoundingClientRect();
            return { x, y, width };
        });
        animations.forEach(animation => animation.finish());
        return positions;
    });
    for (const position of positions.slice(1)) {
        for (const key of ['x', 'y', 'width']) {
            assert.ok(Math.abs(position[key] - positions[0][key]) < 0.1,
                `Entrance moved ${key}: ${JSON.stringify(positions)}`);
        }
    }
}

test('dashboard navigation and player tabs keep content geometry stable', { timeout: 90000 }, async t => {
    const app = await startTestApp();
    t.after(() => app.stop());
    const register = await fetch(`${app.baseURL}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'botoli1', password: 'navigation-test-password' }),
    });
    assert.equal(register.ok, true);
    const auth = await (await fetch(`${app.baseURL}/api/auth`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'botoli1', password: 'navigation-test-password' }),
    })).json();
    assert.ok(auth.token);
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const context = await browser.newContext();
    await context.addCookies([{ name: 'mc_launcher_token', value: auth.token, url: app.baseURL }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(app.baseURL);
        for (const label of ['Моды и конфиги', 'Игроки', 'Логи', 'Мой профиль', 'Сборка']) {
            if (viewport.width < 700) await page.getByRole('button', { name: 'Открыть меню' }).click();
            await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
            await page.waitForLoadState('load');
            await page.evaluate(() => document.fonts.ready);
            await assertStationaryEntrance(page.locator('.page-enter'));
            const widths = await page.locator('.page-content').evaluate(element => {
                const original = element.style.overflowY;
                element.style.overflowY = 'hidden';
                const short = element.clientWidth;
                element.style.overflowY = 'scroll';
                const long = element.clientWidth;
                element.style.overflowY = original;
                return { short, long };
            });
            assert.equal(widths.short, widths.long, 'Scrollbar changed content width');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        await page.goto(`${app.baseURL}/players/botoli1`);
        for (const label of ['Все действия', 'Лог авторизаций', 'Подключения на сервер', 'Данные об игроке']) {
            await page.getByRole('tab', { name: label, exact: true }).click();
            await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
            await assertStationaryEntrance(page.getByRole('tabpanel'));
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(page.locator('.page-enter')).toHaveCSS('animation-name', 'none');
        await expect(page.getByRole('tabpanel')).toHaveCSS('animation-name', 'none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    assert.deepEqual(errors, []);
});
