const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function startLauncher({ mode = 'start', root = path.resolve(__dirname, '..'), frontendDirectory = path.join(root, 'apps/web') } = {}) {
    // Explicit shell overrides win; a production URL in .env must not turn a
    // default local dev session into an HTTPS redirect to an HTTP listener.
    const explicitPublicURL = process.env.PUBLIC_URL;
    require('@next/env').loadEnvConfig(root, mode === 'dev');
    const frontendPort = process.env.FRONTEND_PORT || '3001';
    const backendPort = process.env.PORT || '3000';
    if (frontendPort === backendPort) throw new Error('PORT и FRONTEND_PORT должны отличаться.');
    if (mode === 'start' && !fs.existsSync(path.join(frontendDirectory, '.next/BUILD_ID'))) {
        throw new Error('Сначала выполните npm run build. Для разработки: npm run dev.');
    }
    const env = {
        ...process.env,
        NODE_ENV: mode === 'dev' ? 'development' : 'production',
        BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        FRONTEND_PORT: frontendPort,
        NEXT_TELEMETRY_DISABLED: '1',
        ...(mode === 'dev' ? {
            PUBLIC_URL: explicitPublicURL || `http://localhost:${backendPort}`,
            HTTPS_ENABLED: 'false',
        } : {})
    };
    const children = [
        spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, '.', '--hostname', '127.0.0.1', '--port', frontendPort], { cwd: frontendDirectory, env, stdio: 'inherit', windowsHide: true }),
        spawn(process.execPath, [path.join(root, 'apps/api/src/server.js')], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    ];
    let stopping = false;
    function stop(code = 0) {
        if (stopping) return;
        stopping = true;
        for (const child of children) {
            if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue;
            if (process.platform === 'win32') {
                // Next dev can have a worker. Stop only processes this runner started.
                const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
                if (result.error || result.status !== 0) child.kill();
            } else {
                child.kill('SIGTERM');
            }
        }
        process.exitCode = code;
    }
    for (const child of children) {
        child.on('error', error => { console.error(error.message); stop(1); });
        child.on('exit', code => stop(code === null ? 1 : code));
    }
    process.once('SIGINT', () => stop());
    process.once('SIGTERM', () => stop());
    return { children, stop };
}

if (require.main === module) {
    try { startLauncher({ mode: process.argv[2] === 'dev' ? 'dev' : 'start' }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { startLauncher };
