const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const httpProxy = require('http-proxy');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { errorPages, renderErrorPage } = require('../apps/shared/error-pages');
const { previewError, sendErrorPage, handlePageError } = require('../apps/api/src/http/error-pages');

async function serve(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('previews return actual error statuses, work without an upstream and cannot inject arbitrary content', async t => {
    const app = express();
    app.get('/errors/:code', previewError);
    const base = await serve(t, app);
    for (const code of Object.keys(errorPages)) {
        const response = await fetch(`${base}/errors/${code}`);
        assert.equal(response.status, Number(code));
        assert.match(response.headers.get('content-type'), /text\/html/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const html = await response.text();
        assert.ok(html.includes(errorPages[code].title));
        assert.ok(html.includes('href="/"'));
        assert.equal(html.includes('window.location.reload()'), code !== '404');
        assert.equal(fs.readFileSync(path.join(__dirname, `../deploy/error-pages/${code}.html`), 'utf8'), html);
    }
    assert.equal((await fetch(`${base}/errors/123`)).status, 404);
    assert.ok(!renderErrorPage('<script>alert(1)</script>').includes('<script>'));
});

test('unexpected backend failures render a page for browsers and preserve JSON for API clients', async t => {
    const app = express();
    app.use((_req, _res, next) => next(new Error('private internal details')));
    app.use(handlePageError);
    const base = await serve(t, app);
    const browser = await fetch(`${base}/profile`, { headers: { Accept: 'text/html' } });
    assert.equal(browser.status, 500);
    assert.ok((await browser.text()).includes(errorPages[500].title));
    for (const [url, accept] of [['/api/profile', 'text/html'], ['/api', '*/*'], ['/profile', 'application/json']]) {
        const response = await fetch(base + url, { headers: { Accept: accept } });
        assert.equal(response.status, 500);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.ok(!(await response.text()).includes('private internal details'));
    }
});

test('an unavailable frontend produces a standalone 503 page', async t => {
    // Reserve a port then close it so the proxy gets ECONNREFUSED.
    const upstream = express().listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const port = upstream.address().port;
    await new Promise(resolve => upstream.close(resolve));
    const proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${port}` });
    proxy.on('error', (_error, _req, res) => sendErrorPage(res, 503));
    t.after(() => proxy.close());
    const app = express();
    app.use((req, res) => proxy.web(req, res));
    const base = await serve(t, app);
    const response = await fetch(base, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '5');
    assert.ok((await response.text()).includes(errorPages[503].title));
});
