function networkConfig(env = process.env) {
    const port = env.PORT || '3000';
    const domain = env.DOMAIN || 'localhost';
    const fallback = env.USE_HTTPS === 'true' ? `https://${domain}` : `http://${domain}:${port}`;
    const url = new URL(env.PUBLIC_URL || fallback);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
        throw new Error('PUBLIC_URL must be an HTTP(S) origin without credentials, path or query');
    }
    return {
        host: env.HOST || '127.0.0.1',
        port,
        httpsPort: env.HTTPS_PORT || '3443',
        // Public HTTPS and the optional internal TLS listener are independent.
        useHTTPS: url.protocol === 'https:',
        httpsEnabled: env.HTTPS_ENABLED !== 'false',
        publicURL: url.origin,
        domain: url.hostname,
    };
}

module.exports = { networkConfig };
