const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
async function freePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
async function startTestApp() {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-launcher-test-'));
    const backendPort = await freePort();
    let frontendPort = await freePort();
    while (frontendPort === backendPort) frontendPort = await freePort();
    await fs.copyFile(path.join(root, 'server.js'), path.join(fixture, 'server.js'));
    await fs.copyFile(path.join(root, 'telegram-auth.js'), path.join(fixture, 'telegram-auth.js'));
    await fs.mkdir(path.join(fixture, 'data/mods'), { recursive: true });
    await fs.mkdir(path.join(fixture, 'data/clients'), { recursive: true });
    for (const name of ['jei-1.21.1-neoforge.jar', 'journeymap-1.21.1.jar', 'sodium-neoforge-0.6.13.jar']) {
        await fs.writeFile(path.join(fixture, 'data/mods', name), 'Test mod fixture');
    }
    await fs.writeFile(path.join(fixture, 'data/clients/launcher-portable.zip'), 'Test launcher fixture');
    const env = {
        ...process.env, PORT: String(backendPort), FRONTEND_PORT: String(frontendPort),
        BACKEND_URL: `http://127.0.0.1:${backendPort}`, DOMAIN: 'localhost',
        USE_HTTPS: 'false', JWT_SECRET: 'integration-test-only-secret',
        NODE_ENV: 'production', NODE_PATH: path.join(root, 'node_modules'),
        NEXT_TELEMETRY_DISABLED: '1'
    };
    const bootstrap = path.join(fixture, 'bootstrap.cjs');
    await fs.writeFile(bootstrap, `
        const { startLauncher } = require(${JSON.stringify(path.join(root, 'scripts/run.js'))});
        const launcher = startLauncher({ root: __dirname, frontendDirectory: ${JSON.stringify(path.join(root, 'frontend'))} });
        process.on('message', message => { if (message === 'stop') { launcher.stop(); process.disconnect(); } });
    `);
    const children = [spawn(process.execPath, [bootstrap], { cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })];
    let output = '';
    for (const child of children) {
        child.stdout.on('data', data => { output = (output + data).slice(-8000); });
        child.stderr.on('data', data => { output = (output + data).slice(-8000); });
    }
    const baseURL = `http://127.0.0.1:${backendPort}`;
    async function stop() {
        for (const child of children) {
            if (child.exitCode === null && child.signalCode === null) {
                child.send('stop');
                await once(child, 'exit').catch(() => {});
            }
        }
        const target = path.resolve(fixture);
        const tempRoot = path.resolve(os.tmpdir()) + path.sep;
        if (!target.startsWith(tempRoot) || !path.basename(target).startsWith('mc-launcher-test-')) {
            throw new Error(`Refusing to remove unexpected test directory: ${target}`);
        }
        await fs.rm(target, { recursive: true, force: true });
    }
    try {
        const deadline = Date.now() + 30000;
        while (true) {
            if (children.some(child => child.exitCode !== null)) throw new Error(`Test server exited:\n${output}`);
            try { const response = await fetch(`${baseURL}/login`); if (response.ok) break; } catch {}
            if (Date.now() > deadline) throw new Error(`Test server readiness timeout:\n${output}`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    } catch (error) { await stop(); throw error; }
    return { baseURL, backendPort, frontendPort, fixture, stop, output: () => output };
}
module.exports = { startTestApp };
