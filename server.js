const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const archiver = require('archiver');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Domain
const DOMAIN = process.env.DOMAIN || '89.125.214.122';
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const publicURL = USE_HTTPS ? `https://${DOMAIN}` : `http://${DOMAIN}:${PORT}`;

const DATA_DIR = path.join(__dirname, 'data');
const MODS_DIR = path.join(DATA_DIR, 'mods');
const CLIENTS_DIR = path.join(DATA_DIR, 'clients');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

[DATA_DIR, MODS_DIR, CLIENTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ======================== JWT Secret ========================
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = 'mc_launcher_token';

// ======================== Users ========================
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}');
const users = JSON.parse(fs.readFileSync(USERS_FILE));

const BUILD_CONFIG_FILE = path.join(DATA_DIR, 'build-config.json');
const CLIENT_VERSION_FILE = path.join(DATA_DIR, 'client-version.json');
const SERVER_CONFIG_FILE = path.join(DATA_DIR, 'server-config.json');

let serverConfig = {};
if (fs.existsSync(SERVER_CONFIG_FILE)) {
    serverConfig = JSON.parse(fs.readFileSync(SERVER_CONFIG_FILE));
}
function saveServerConfig() {
    fs.writeFileSync(SERVER_CONFIG_FILE, JSON.stringify(serverConfig, null, 2));
}

const DEFAULT_BUILD_CONFIG = {
    version: '1.21.1',
    loader: 'neoforge',
    loaderVersion: '21.1.115',
    javaVersion: 21,
    minMemory: 2048,
    maxMemory: 4096,
    jvmArgs: ['-Dfile.encoding=UTF-8'],
    servers: [{ name: 'MinecraftServer', address: '45.157.232.7:32761' }],
    launcherServer: publicURL
};
if (!fs.existsSync(BUILD_CONFIG_FILE)) {
    fs.writeFileSync(BUILD_CONFIG_FILE, JSON.stringify(DEFAULT_BUILD_CONFIG, null, 2));
}
const getBuildConfig = () => {
    try { return JSON.parse(fs.readFileSync(BUILD_CONFIG_FILE)); }
    catch (e) { return DEFAULT_BUILD_CONFIG; }
};

function getModsHash() {
    if (!fs.existsSync(MODS_DIR)) return 'empty';
    const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).sort();
    if (files.length === 0) return 'empty';
    const hash = crypto.createHash('md5');
    files.forEach(f => hash.update(f + fs.statSync(path.join(MODS_DIR, f)).size.toString()));
    return hash.digest('hex');
}

function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

// ======================== Crypto helpers ========================
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    // Old format: SHA256 with static salt
    if (!stored.startsWith('pbkdf2:') && !stored.startsWith('$2')) {
        const oldHash = crypto.createHash('sha256').update(password + 'mc_salt_2026').digest('hex');
        return stored === oldHash;
    }
    // bcryptjs format
    if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
        // Can't verify bcrypt without the module, fall back to re-hashing
        return false;
    }
    // pbkdf2 format
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const hash = crypto.pbkdf2Sync(password, parts[1], 10000, 64, 'sha512').toString('hex');
    return hash === parts[2];
}

// ======================== JWT helpers (manual, no external deps) ========================
function base64url(str) {
    return Buffer.from(str).toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString('utf8');
}

function generateToken(login) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { login, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (JWT_EXPIRES_IN / 1000) };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', JWT_SECRET)
        .update(headerB64 + '.' + payloadB64)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return headerB64 + '.' + payloadB64 + '.' + signature;
}

function verifyToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const signature = crypto.createHmac('sha256', JWT_SECRET)
            .update(parts[0] + '.' + parts[1])
            .digest('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        if (signature !== parts[2]) return null;
        const payload = JSON.parse(base64urlDecode(parts[1]));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// ======================== Migration ========================
function migrateUser(login, user) {
    if (!user.password || !user.password.startsWith) return user;
    if (user.password.startsWith('pbkdf2:')) return user; // already migrated
    const migrated = {
        password: user.password,
        email: user.email || '',
        nickname: user.nickname || login,
        registrationStatus: user.registrationStatus || 'confirmed',
        registeredAt: user.created || Date.now(),
        lastLogin: user.lastLogin || null,
        token: user.token || null
    };
    return migrated;
}

let migrated = false;
for (const [login, user] of Object.entries(users)) {
    if (typeof user.password !== 'object' && (!user.registrationStatus || user.password)) {
        users[login] = migrateUser(login, user);
        migrated = true;
    }
}
if (migrated) saveUsers();

// ======================== Middleware ========================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 500 * 1024 * 1024 } }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/download', express.static(CLIENTS_DIR));
app.use('/mods', express.static(MODS_DIR));

// Cookie parser (manual, no external deps)
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(c => {
            const idx = c.indexOf('=');
            if (idx > 0) req.cookies[c.substring(0, idx).trim()] = decodeURIComponent(c.substring(idx + 1).trim());
        });
    }
    next();
});

// Redirect HTTP to HTTPS only for browser requests
app.use((req, res, next) => {
    if (USE_HTTPS && !req.secure && req.get('x-forwarded-proto') !== 'https') {
        if (req.path.startsWith('/api') || req.path.startsWith('/download') || req.path.startsWith('/mods')) {
            return next();
        }
        return res.redirect(301, 'https://' + req.get('host') + req.url);
    }
    next();
});

// Template locals
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.domain = DOMAIN;
    res.locals.useHTTPS = USE_HTTPS;
    res.locals.publicURL = publicURL;
    next();
});

// ======================== Auth middleware ========================
function authRequired(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Unauthorized' });
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
    }
    const decoded = verifyToken(token);
    if (!decoded || !users[decoded.login]) {
        res.cookie(COOKIE_NAME, '', { maxAge: 0 });
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Invalid token' });
        return res.redirect('/login');
    }
    req.user = decoded;
    req.userToken = token;
    next();
}

function adminRequired(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME] || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) {
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Unauthorized' });
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
    }
    const decoded = verifyToken(token);
    if (!decoded || !users[decoded.login]) {
        res.cookie(COOKIE_NAME, '', { maxAge: 0 });
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Invalid token' });
        return res.redirect('/login');
    }
    req.user = decoded;
    req.userToken = token;
    next();
}

// Helper to set cookie
function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}`;
    if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
    if (options.httpOnly) cookie += '; HttpOnly';
    if (options.secure) cookie += '; Secure';
    if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
    cookie += '; Path=/';
    res.setHeader('Set-Cookie', cookie);
}

// ======================== Web UI: Player pages ========================
app.get('/login', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token && verifyToken(token)) return res.redirect('/profile');
    res.render('login', { error: null, redirect: req.query.redirect || '' });
});

app.get('/register', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token && verifyToken(token)) return res.redirect('/profile');
    res.render('register', { error: null });
});

app.get('/profile', authRequired, (req, res) => {
    const userData = users[req.user.login];
    res.render('profile', {
        login: req.user.login,
        nickname: userData.nickname || req.user.login,
        email: userData.email || '',
        registrationStatus: userData.registrationStatus || 'pending',
        registeredAt: userData.registeredAt,
        lastLogin: userData.lastLogin,
        error: null,
        success: null
    });
});

// ======================== Web UI: Admin dashboard ========================
app.get('/', adminRequired, (req, res) => {
    const modsList = fs.existsSync(MODS_DIR) ? fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')) : [];
    const buildConfig = getBuildConfig();
    res.render('dashboard', {
        mods: modsList,
        versions: ['1.21.1', '1.20.1', '1.19.2', '1.18.2'],
        loaders: ['neoforge', 'forge', 'fabric', 'vanilla'],
        userCount: Object.keys(users).length,
        clientExists: fs.existsSync(path.join(CLIENTS_DIR, 'minecraft-client.zip')),
        mcServer: buildConfig.servers?.[0]?.address || '45.157.232.7:32761',
        buildConfig: buildConfig,
        domain: DOMAIN,
        useHTTPS: USE_HTTPS,
        users: users
    });
});

// ======================== API: Auth ========================
app.post('/api/register', (req, res) => {
    const { login, password, email, nickname } = req.body;
    if (!login || !password) return res.json({ error: 'Логин и пароль обязательны' });
    if (login.length < 3) return res.json({ error: 'Логин должен быть не менее 3 символов' });
    if (password.length < 4) return res.json({ error: 'Пароль должен быть не менее 4 символов' });
    if (users[login]) return res.json({ error: 'Пользователь с таким логином уже существует' });

    users[login] = {
        password: hashPassword(password),
        email: email || '',
        nickname: nickname || login,
        registrationStatus: 'confirmed',
        registeredAt: Date.now(),
        lastLogin: null,
        token: null
    };
    saveUsers();
    res.json({ success: true, message: 'Регистрация успешна! Теперь войдите.' });
});

app.post('/api/auth', (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.json({ error: 'Логин и пароль обязательны' });
    const user = users[login];
    if (!user) return res.json({ error: 'Пользователь не найден' });

    if (!verifyPassword(password, user.password)) {
        return res.json({ error: 'Неверный пароль' });
    }

    // Re-hash old SHA256 passwords to pbkdf2
    if (!user.password.startsWith('pbkdf2:')) {
        user.password = hashPassword(password);
    }

    const token = generateToken(login);
    user.token = token;
    user.lastLogin = Date.now();
    saveUsers();

    setCookie(res, COOKIE_NAME, token, {
        httpOnly: true,
        secure: USE_HTTPS,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
    });

    res.json({ success: true, token, username: login, nickname: user.nickname });
});

app.post('/api/verify', (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    const decoded = verifyToken(token);
    if (!decoded) return res.json({ valid: false });
    const user = users[decoded.login];
    res.json({ valid: true, username: decoded.login, nickname: user?.nickname || decoded.login });
});

// ======================== API: Profile ========================
app.get('/api/profile', authRequired, (req, res) => {
    const user = users[req.user.login];
    res.json({
        login: req.user.login,
        nickname: user.nickname || req.user.login,
        email: user.email || '',
        registrationStatus: user.registrationStatus || 'confirmed',
        registeredAt: user.registeredAt,
        lastLogin: user.lastLogin
    });
});

app.put('/api/profile', authRequired, (req, res) => {
    const { nickname } = req.body;
    const user = users[req.user.login];
    if (nickname !== undefined) {
        if (nickname.length < 1 || nickname.length > 16) return res.json({ error: 'Никнейм должен быть от 1 до 16 символов' });
        user.nickname = nickname;
    }
    saveUsers();
    res.json({ success: true, message: 'Профиль обновлён' });
});

// ======================== API: Logout ========================
app.post('/api/logout', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
        const decoded = verifyToken(token);
        if (decoded && users[decoded.login]) {
            users[decoded.login].token = null;
            saveUsers();
        }
    }
    setCookie(res, COOKIE_NAME, '', { maxAge: 0 });
    res.json({ success: true });
});

// ======================== API: Launcher Auth ========================
app.post('/api/launcher-auth', (req, res) => {
    const { login, password, token } = req.body;

    // Auth by token
    if (token) {
        const decoded = verifyToken(token);
        if (decoded && users[decoded.login]) {
            users[decoded.login].lastLogin = Date.now();
            saveUsers();
            return res.json({ success: true, username: decoded.login, nickname: users[decoded.login].nickname });
        }
    }

    // Auth by login+password
    if (login && password) {
        const user = users[login];
        if (!user) return res.json({ error: 'Пользователь не найден' });

        if (!verifyPassword(password, user.password)) {
            return res.json({ error: 'Неверный пароль' });
        }

        if (!user.password.startsWith('pbkdf2:')) {
            user.password = hashPassword(password);
        }

        const newToken = generateToken(login);
        user.token = newToken;
        user.lastLogin = Date.now();
        saveUsers();

        return res.json({ success: true, token: newToken, username: login, nickname: user.nickname });
    }

    res.json({ error: 'Требуется логин/пароль или токен' });
});

// ======================== API: Admin Players ========================
app.get('/api/admin/players', adminRequired, (req, res) => {
    const list = Object.entries(users).map(([login, data]) => ({
        login,
        nickname: data.nickname || login,
        email: data.email || '—',
        registrationStatus: data.registrationStatus || 'confirmed',
        registeredAt: data.registeredAt || 0,
        lastLogin: data.lastLogin || null
    }));
    res.json(list);
});

app.put('/api/admin/players/:login/status', adminRequired, (req, res) => {
    const { login } = req.params;
    const { status } = req.body;
    if (!users[login]) return res.json({ error: 'Пользователь не найден' });
    if (!['confirmed', 'pending', 'banned'].includes(status)) return res.json({ error: 'Неверный статус' });
    users[login].registrationStatus = status;
    saveUsers();
    res.json({ success: true, message: `Статус игрока ${login} изменён на ${status}` });
});

// ======================== API: Users list (public) ========================
app.get('/api/users', (req, res) => {
    const list = Object.entries(users).map(([login, data]) => ({
        login,
        created: data.registeredAt || data.created || 0
    }));
    res.json(list);
});

// ======================== API: Mods ========================
app.post('/api/upload-mod', (req, res) => {
    if (!req.files || !req.files.mod) return res.json({ error: 'No file' });
    const mod = req.files.mod;
    const filePath = path.join(MODS_DIR, mod.name);
    mod.mv(filePath, (err) => {
        if (err) return res.json({ error: err.message });
        res.json({ success: true, name: mod.name, size: mod.size });
    });
});

app.post('/api/delete-mod', (req, res) => {
    const { name } = req.body;
    const filePath = path.join(MODS_DIR, name);
    if (!fs.existsSync(filePath)) return res.json({ error: 'Mod not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
});

app.get('/api/download-mods', (req, res) => {
    const archive = archiver('zip');
    res.attachment('mods.zip');
    archive.pipe(res);
    if (fs.existsSync(MODS_DIR) && fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).length > 0) {
        archive.directory(MODS_DIR, 'mods');
    } else {
        archive.append('no mods', { name: 'empty.txt' });
    }
    archive.finalize();
});

app.get('/api/mods-list', (req, res) => {
    if (!fs.existsSync(MODS_DIR)) return res.json({ mods: [], hash: 'empty' });
    const files = fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).sort();
    const mods = files.map(f => ({
        name: f,
        size: fs.statSync(path.join(MODS_DIR, f)).size
    }));
    res.json({ mods, hash: getModsHash() });
});

// ======================== API: Build config ========================
app.get('/api/client-config', (req, res) => {
    const config = getBuildConfig();
    res.json({
        version: config.version,
        loader: config.loader,
        loaderVersion: config.loaderVersion,
        javaVersion: config.javaVersion,
        minMemory: config.minMemory,
        maxMemory: config.maxMemory,
        jvmArgs: config.jvmArgs || ['-Dfile.encoding=UTF-8'],
        servers: config.servers || [{ name: 'MinecraftServer', address: '45.157.232.7:32761' }],
        modsHash: getModsHash(),
        modsURL: `${publicURL}/api/download-mods`,
        launcherServer: config.launcherServer || publicURL,
        serverIP: config.servers?.[0]?.address || '45.157.232.7:32761'
    });
});

app.post('/api/build-config', (req, res) => {
    const { version, loader, loaderVersion, javaVersion, minMemory, maxMemory, serverIP } = req.body;
    const config = getBuildConfig();
    if (version) config.version = version;
    if (loader) config.loader = loader;
    if (loaderVersion) config.loaderVersion = loaderVersion;
    if (javaVersion) config.javaVersion = parseInt(javaVersion);
    if (minMemory) config.minMemory = parseInt(minMemory);
    if (maxMemory) config.maxMemory = parseInt(maxMemory);
    if (serverIP) {
        config.servers = [{ name: 'MinecraftServer', address: serverIP }];
    }
    config.launcherServer = publicURL;
    fs.writeFileSync(BUILD_CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true, config });
});

// ======================== API: Client info ========================
app.get('/api/client-info', (req, res) => {
    const versionData = fs.existsSync(CLIENT_VERSION_FILE)
        ? JSON.parse(fs.readFileSync(CLIENT_VERSION_FILE))
        : { version: '1.0.0', file: 'launcher-portable.zip' };
    const filePath = path.join(CLIENTS_DIR, versionData.file);
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    res.json({
        version: versionData.version,
        url: `${publicURL}/download/${versionData.file}`,
        size: size
    });
});

// ======================== API: Status ========================
app.get('/api/status', (req, res) => {
    res.json({
        server: 'online',
        version: '3.0.0',
        users: Object.keys(users).length,
        mods: fs.existsSync(MODS_DIR) ? fs.readdirSync(MODS_DIR).filter(f => f.endsWith('.jar')).length : 0,
        mcServer: getBuildConfig().servers?.[0]?.address || '45.157.232.7:32761',
        buildConfig: getBuildConfig(),
        domain: DOMAIN,
        useHTTPS: USE_HTTPS
    });
});

// ======================== Start server ========================
function startServer() {
    http.createServer(app).listen(PORT, '0.0.0.0', () => {
        console.log(`[MCL] HTTP server on http://0.0.0.0:${PORT}`);
    });

    const keyPath = path.join(DATA_DIR, 'certs/privkey.pem');
    const certPath = path.join(DATA_DIR, 'certs/fullchain.pem');

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const httpsOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log(`[MCL] HTTPS server on https://0.0.0.0:${HTTPS_PORT}`);
        });
        console.log(`[MCL] HTTPS active: https://${DOMAIN}`);
    } else {
        console.log('[MCL] HTTPS not configured.');
    }

    console.log(`[MCL] Public URL: ${publicURL}`);
    console.log(`[MCL] Web panel: ${publicURL}`);
    console.log(`[MCL] Player portal: ${publicURL}/login`);
    console.log(`[MCL] JWT Secret: ${JWT_SECRET.substring(0, 8)}...`);
}

startServer();