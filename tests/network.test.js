const { test } = require('node:test');
const assert = require('node:assert/strict');
const { networkConfig } = require('../apps/api/src/config/network');

test('public HTTPS remains enabled with a loopback HTTP listener behind Nginx', () => {
    const config = networkConfig({ PUBLIC_URL: 'https://launcher.example', HTTPS_ENABLED: 'false' });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.publicURL, 'https://launcher.example');
    assert.equal(config.useHTTPS, true);
    assert.equal(config.httpsEnabled, false);
});

test('legacy URLs and optional internal TLS retain compatibility', () => {
    assert.equal(networkConfig({ DOMAIN: 'localhost', PORT: '3100' }).publicURL, 'http://localhost:3100');
    const config = networkConfig({ DOMAIN: 'launcher.example', USE_HTTPS: 'true', HOST: '::1' });
    assert.equal(config.publicURL, 'https://launcher.example');
    assert.equal(config.httpsEnabled, true);
    assert.equal(config.host, '::1');
});

test('public URL cannot contain credentials or route fragments', () => {
    for (const url of ['ftp://example.com', 'https://user:password@example.com', 'https://example.com/api',
        'https://example.com?secret=value', 'https://example.com#fragment']) {
        assert.throws(() => networkConfig({ PUBLIC_URL: url }), /PUBLIC_URL/);
    }
});
