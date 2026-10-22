const { ROOT_DIR, DATA_DIR } = require("./config/paths");
require("@next/env").loadEnvConfig(ROOT_DIR);
const { createDatabase } = require("./database");
async function main() {
  const database = createDatabase();
  await database.initialize();
  const express = require("express");
  const fileUpload = require("express-fileupload");
  const path = require("path");
  const fs = require("fs");
  const https = require("https");
  const http = require("http");
  const archiver = require("archiver");
  const crypto = require("crypto");
  const httpProxy = require("http-proxy");
  const {
    sendErrorPage,
    previewError,
    handlePageError,
  } = require("./http/error-pages");

  const { createPlayerServices } = require("./players/services");
  const app = express();
  // Forwarded IPs are accepted only from explicitly configured proxies.
  if (process.env.TRUST_PROXY)
    app.set(
      "trust proxy",
      process.env.TRUST_PROXY.split(",").map((value) => value.trim()),
    );
  const { networkConfig } = require("./config/network");
  const {
    host: HOST,
    port: PORT,
    httpsPort: HTTPS_PORT,
    domain: DOMAIN,
    useHTTPS: USE_HTTPS,
    httpsEnabled: HTTPS_ENABLED,
    publicURL,
  } = networkConfig();

  const MODS_DIR = path.join(DATA_DIR, "mods");
  const CLIENTS_DIR = path.join(DATA_DIR, "clients");
  const launcherReleases = require('./launcher/releases').createLauncherReleases(DATA_DIR);

  if (
    fs.existsSync(path.join(DATA_DIR, "users.json")) &&
    !(
      await database.pool.query(
        "SELECT 1 FROM schema_migrations WHERE version='002_legacy_import'",
      )
    ).rowCount
  )
    throw new Error(
      "Обнаружены старые данные. Сначала остановите старый backend и выполните npm run db:migrate.",
    );

  [DATA_DIR, MODS_DIR, CLIENTS_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  const configStore = require("./configs/archive").createConfigStore(DATA_DIR);

  // ======================== JWT Secret ========================
  const JWT_SECRET =
    process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
  const JWT_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days
  const COOKIE_NAME = "mc_launcher_token";

  // ======================== Users ========================
  const users = database.users;
  const saveUsers = () => {}; // Request unit of work commits before the response.

  const DEFAULT_BUILD_CONFIG = {
    version: "1.21.1",
    loader: "neoforge",
    loaderVersion: "21.1.115",
    javaVersion: 21,
    minMemory: 2048,
    maxMemory: 4096,
    jvmArgs: ["-Dfile.encoding=UTF-8"],
    servers: [{ name: "MinecraftServer", address: "45.157.232.7:32761" }],
    launcherServer: publicURL,
  };
  await database.transaction(async (state) => {
    const catalog = state.settings.launcherReleases;
    await launcherReleases.ensureCompatibility(catalog?.versions?.[catalog.current]);
    state.settings.build ||= DEFAULT_BUILD_CONFIG;
    state.settings.server ||= {};
    state.settings.client ||= {
      version: "1.0.0",
      file: "launcher-portable.zip",
    };
  });
  const getBuildConfig = () =>
    structuredClone(database.settings().build || DEFAULT_BUILD_CONFIG);

  function getModsHash() {
    const files = fs.existsSync(MODS_DIR)
      ? fs
          .readdirSync(MODS_DIR)
          .filter((f) => f.endsWith(".jar"))
          .sort()
      : [];
    const configs = configStore.info();
    if (files.length === 0 && !configs) return "empty";
    const hash = crypto.createHash("md5");
    files.forEach((f) =>
      hash.update(f + fs.statSync(path.join(MODS_DIR, f)).size.toString()),
    );
    if (configs) hash.update(`configs:${configs.hash}`);
    return hash.digest("hex");
  }

  // ======================== Crypto helpers ========================
  const { hashPassword, verifyPassword } = require("./auth/passwords");

  // ======================== JWT helpers (manual, no external deps) ========================
  function base64url(str) {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  function base64urlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Buffer.from(str, "base64").toString("utf8");
  }

  function generateToken(login) {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      login,
      launcherVersion: users[login]?.launcherVersion || 0,
      sessionVersion: users[login]?.sessionVersion || 0,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + JWT_EXPIRES_IN / 1000,
    };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signature = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(headerB64 + "." + payloadB64)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    return headerB64 + "." + payloadB64 + "." + signature;
  }

  function verifyToken(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const signature = crypto
        .createHmac("sha256", JWT_SECRET)
        .update(parts[0] + "." + parts[1])
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      if (signature !== parts[2]) return null;
      const payload = JSON.parse(base64urlDecode(parts[1]));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000))
        return null;
      if (
        Object.hasOwn(users, payload.login) &&
        (payload.sessionVersion || 0) !==
          (users[payload.login].sessionVersion || 0)
      )
        return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  // ======================== Migration ========================
  function migrateUser(login, user) {
    if (!user.password || !user.password.startsWith) return user;
    if (
      user.password.startsWith("pbkdf2:") ||
      user.password.startsWith("scrypt:")
    )
      return user; // already migrated
    const migrated = {
      ...user,
      password: user.password,
      email: user.email || "",
      nickname: user.nickname || login,
      registrationStatus: user.registrationStatus || "confirmed",
      registeredAt: user.registeredAt || user.created || Date.now(),
      lastLogin: user.lastLogin || null,
      token: user.token || null,
    };
    return migrated;
  }

  await database.transaction(() => {
    let migrated = false;
    for (const [login, user] of Object.entries(users)) {
      if (
        typeof user.password !== "object" &&
        (!user.registrationStatus || user.password)
      ) {
        users[login] = migrateUser(login, user);
        migrated = true;
      }
    }
    if (migrated) saveUsers();
  });

  const playerServices = createPlayerServices({
    users,
    saveUsers,
    dataDir: DATA_DIR,
    storage: database,
  });

  // ======================== Middleware ========================
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(fileUpload({ limits: { fileSize: 500 * 1024 * 1024 } }));

  // Cookie parser (manual, no external deps)
  app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(";").forEach((c) => {
        const idx = c.indexOf("=");
        if (idx > 0)
          req.cookies[c.substring(0, idx).trim()] = decodeURIComponent(
            c.substring(idx + 1).trim(),
          );
      });
    }
    next();
  });

  app.get('/download/launcher/:archive', async (req, res, next) => {
    try {
      const selected = await database.transaction(state => {
        const versions = state.settings.launcherReleases?.versions || {};
        for (const release of Object.values(versions)) {
          for (const legacy of [false, true]) {
            const variant = legacy ? release.legacy : release;
            if (variant?.file === req.params.archive &&
                launcherReleases.url(release.version, legacy) === `/download/launcher/${req.params.archive}`)
              return { version: release.version, legacy };
          }
        }
      });
      const file = selected && launcherReleases.file(selected.version, selected.legacy);
      if (!file || !fs.existsSync(file)) return res.sendStatus(404);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.download(file, req.params.archive);
    } catch (error) { next(error); }
  });
  app.use("/download", express.static(CLIENTS_DIR));
  app.use("/mods", express.static(MODS_DIR, { redirect: false, index: false }));

  // Redirect HTTP to HTTPS only for browser requests
  app.use((req, res, next) => {
    if (USE_HTTPS && !req.secure && req.get("x-forwarded-proto") !== "https") {
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/download") ||
        req.path.startsWith("/mods")
      ) {
        return next();
      }
      return res.redirect(301, "https://" + req.get("host") + req.url);
    }
    next();
  });

  // These previews remain available without a database request or Next.js.
  app.get("/errors/:code", previewError);

  app.use(database.middleware);

  // ======================== Auth middleware ========================
  function authRequired(req, res, next) {
    const token =
      req.cookies?.[COOKIE_NAME] ||
      (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) {
      if (req.path.startsWith("/api"))
        return res.status(401).json({ error: "Unauthorized" });
      return res.redirect(
        "/login?redirect=" + encodeURIComponent(req.originalUrl),
      );
    }
    const decoded = verifyToken(token);
    if (!decoded || !Object.hasOwn(users, decoded.login)) {
      res.cookie(COOKIE_NAME, "", { maxAge: 0 });
      if (req.path.startsWith("/api"))
        return res.status(401).json({ error: "Invalid token" });
      return res.redirect("/login");
    }
    req.user = decoded;
    req.userToken = token;
    next();
  }

  const { adminRequired } = playerServices.install(app, authRequired);
  function launcherDenied(req, res, login, method, tokenPayload) {
    const user = users[login];
    const reason =
      playerServices.restriction(user) ||
      (tokenPayload &&
      (tokenPayload.launcherVersion || 0) !== (user.launcherVersion || 0)
        ? "Сессия отозвана. Войдите снова."
        : null);
    if (!reason) return false;
    playerServices.audit(req, login, "auth", "login", {
      source: "launcher",
      method,
      outcome: "denied",
      reason,
    });
    res.status(403).json({ error: reason });
    return true;
  }

  // Helper to set cookie
  function setCookie(res, name, value, options = {}) {
    let cookie = `${name}=${encodeURIComponent(value)}`;
    if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
    if (options.httpOnly) cookie += "; HttpOnly";
    if (options.secure) cookie += "; Secure";
    if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
    cookie += "; Path=/";
    res.setHeader("Set-Cookie", cookie);
  }

  // Initial data for the Next.js dashboard. Existing launcher endpoints stay unchanged.
  app.get("/api/dashboard", adminRequired, (req, res) => {
    const modsList = fs.existsSync(MODS_DIR)
      ? fs
          .readdirSync(MODS_DIR)
          .filter((f) => f.endsWith(".jar"))
          .sort()
      : [];
    const buildConfig = getBuildConfig();
    res.json({
      mods: modsList.map((name) => ({
        name,
        size: fs.statSync(path.join(MODS_DIR, name)).size,
      })),
      configs: configStore.info(),
      versions: ["1.21.1", "1.20.1", "1.19.2", "1.18.2"],
      loaders: ["neoforge", "forge", "fabric", "vanilla"],
      userCount: Object.keys(users).length,
      clientExists: fs.existsSync(
        path.join(CLIENTS_DIR, "minecraft-client.zip"),
      ),
      mcServer: buildConfig.servers?.[0]?.address || "45.157.232.7:32761",
      buildConfig: buildConfig,
      domain: DOMAIN,
      useHTTPS: USE_HTTPS,
      publicURL,
    });
  });

  // ======================== API: Auth ========================
  require("./telegram/auth").installTelegramAuth(app, {
    users,
    saveUsers,
    dataDir: DATA_DIR,
    storage: database,
    secret: process.env.TELEGRAM_BOT_SECRET || "",
    launcherDownloadURL: publicURL,
    audit: playerServices.audit,
    restriction: playerServices.restriction,
  });

  // Native POST forms also work before hydration or when browser scripts fail.
  // Launcher API responses remain JSON, including for URL-encoded API clients.
  app.post(
    ["/api/web-auth/login", "/api/web-auth/register"],
    (req, res, next) => {
      const origin = req.get("origin");
      const sameOrigin = `${req.protocol}://${req.get("host")}`;
      if (
        (origin &&
          origin !== sameOrigin &&
          origin !== new URL(publicURL).origin) ||
        req.get("sec-fetch-site") === "cross-site"
      ) {
        return res
          .status(403)
          .send("Откройте форму входа на сайте и повторите попытку.");
      }
      res.set("Cache-Control", "no-store");
      next();
    },
  );

  function authResponse(req, res, data) {
    if (!req.path.startsWith("/api/web-auth/")) return res.json(data);
    const register = req.path === "/api/web-auth/register";
    if (data.error) {
      const query = new URLSearchParams({ error: data.error });
      if (!register && typeof req.body.redirect === "string")
        query.set("redirect", req.body.redirect);
      return res.redirect(303, `${register ? "/register" : "/login"}?${query}`);
    }
    if (register) return res.redirect(303, "/login?registered=1");
    let destination = "/profile";
    try {
      const url = new URL(
        typeof req.body.redirect === "string" ? req.body.redirect : "/profile",
        publicURL,
      );
      if (url.origin === new URL(publicURL).origin)
        destination = url.pathname + url.search;
    } catch {}
    return res.redirect(303, destination);
  }

  app.post(["/api/register", "/api/web-auth/register"], (req, res) => {
    const reply = (data) => authResponse(req, res, data);
    const { login, password, email, nickname } = req.body;
    if (
      typeof login !== "string" ||
      typeof password !== "string" ||
      !login ||
      !password
    )
      return reply({ error: "Логин и пароль обязательны" });
    if (login.length < 3)
      return reply({ error: "Логин должен быть не менее 3 символов" });
    if (password.length < 4)
      return reply({ error: "Пароль должен быть не менее 4 символов" });
    if (
      Object.hasOwn(users, login) ||
      ["__proto__", "constructor", "prototype"].includes(login)
    )
      return reply({ error: "Пользователь с таким логином уже существует" });

    users[login] = {
      password: hashPassword(password),
      email: email || "",
      nickname: nickname || login,
      registrationStatus: "confirmed",
      registeredAt: Date.now(),
      lastLogin: null,
      token: null,
    };
    saveUsers();
    playerServices.audit(req, login, "account", "registered", {
      method: "password",
    });
    reply({ success: true, message: "Регистрация успешна! Теперь войдите." });
  });

  app.post(["/api/auth", "/api/web-auth/login"], (req, res) => {
    const reply = (data) => authResponse(req, res, data);
    const { login, password } = req.body;
    if (
      typeof login !== "string" ||
      typeof password !== "string" ||
      !login ||
      !password
    )
      return reply({ error: "Логин и пароль обязательны" });
    const user = Object.hasOwn(users, login) ? users[login] : null;
    if (!user) return reply({ error: "Пользователь не найден" });

    if (!verifyPassword(password, user.password)) {
      playerServices.audit(req, login, "auth", "login", {
        method: "password",
        outcome: "failed",
        reason: "Неверный пароль",
      });
      return reply({ error: "Неверный пароль" });
    }

    // Upgrade legacy password hashes on a successful password login
    if (!user.password.startsWith("scrypt:")) {
      user.password = hashPassword(password);
    }

    playerServices.audit(req, login, "auth", "login", { method: "password" });
    const token = generateToken(login);
    user.token = token;
    user.lastLogin = Date.now();
    saveUsers();

    setCookie(res, COOKIE_NAME, token, {
      httpOnly: true,
      secure: USE_HTTPS,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    reply({ success: true, token, username: login, nickname: user.nickname });
  });

  app.post("/api/verify", (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ valid: false });
    const decoded = verifyToken(token);
    if (!decoded) return res.json({ valid: false });
    const user = users[decoded.login];
    if (
      !user ||
      playerServices.restriction(user) ||
      (decoded.launcherVersion || 0) !== (user.launcherVersion || 0)
    )
      return res.json({ valid: false });
    res.json({
      valid: true,
      username: decoded.login,
      nickname: user?.nickname || decoded.login,
    });
  });

  // ======================== API: Profile ========================
  app.get("/api/profile", authRequired, (req, res) => {
    res.json(playerServices.profile(req.user.login));
  });

  app.put("/api/profile", authRequired, (req, res) => {
    const { nickname } = req.body;
    const user = users[req.user.login];
    if (nickname !== undefined && nickname !== user.nickname) {
      if (
        typeof nickname !== "string" ||
        nickname.length < 1 ||
        nickname.length > 16
      )
        return res.json({ error: "Никнейм должен быть от 1 до 16 символов" });
      const previous = user.nickname;
      user.nickname = nickname;
      playerServices.audit(req, req.user.login, "account", "nickname_changed", {
        target: nickname,
        reason: `Предыдущий ник: ${previous}`,
      });
    }
    saveUsers();
    res.json({ success: true, message: "Профиль обновлён" });
  });

  // ======================== API: Logout ========================
  app.post("/api/logout", (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) {
      const decoded = verifyToken(token);
      if (decoded && users[decoded.login]) {
        playerServices.audit(req, decoded.login, "auth", "logout", {
          method: "cookie",
        });
        users[decoded.login].token = null;
        saveUsers();
      }
    }
    setCookie(res, COOKIE_NAME, "", { maxAge: 0 });
    res.json({ success: true });
  });

  // ======================== API: Launcher Auth ========================
  app.post("/api/launcher-auth", (req, res) => {
    const { login, password, token } = req.body;

    // Auth by token
    if (token) {
      const decoded = verifyToken(token);
      if (decoded && users[decoded.login]) {
        if (launcherDenied(req, res, decoded.login, "token", decoded)) return;
        playerServices.audit(req, decoded.login, "auth", "login", {
          source: "launcher",
          method: "token",
        });
        users[decoded.login].lastLogin = Date.now();
        saveUsers();
        return res.json({
          success: true,
          username: decoded.login,
          nickname: users[decoded.login].nickname,
        });
      }
    }

    // Auth by login+password
    if (
      typeof login === "string" &&
      typeof password === "string" &&
      login &&
      password
    ) {
      const user = Object.hasOwn(users, login) ? users[login] : null;
      if (!user) return res.json({ error: "Пользователь не найден" });
      if (launcherDenied(req, res, login, "password")) return;

      if (!verifyPassword(password, user.password)) {
        playerServices.audit(req, login, "auth", "login", {
          source: "launcher",
          method: "password",
          outcome: "failed",
          reason: "Неверный пароль",
        });
        return res.json({ error: "Неверный пароль" });
      }

      if (!user.password.startsWith("scrypt:")) {
        user.password = hashPassword(password);
      }

      playerServices.audit(req, login, "auth", "login", {
        source: "launcher",
        method: "password",
      });
      const newToken = generateToken(login);
      user.token = newToken;
      user.lastLogin = Date.now();
      saveUsers();

      return res.json({
        success: true,
        token: newToken,
        username: login,
        nickname: user.nickname,
      });
    }

    res.json({ error: "Требуется логин/пароль или токен" });
  });

  // ======================== API: Admin Players ========================
  app.get("/api/admin/players", adminRequired, (req, res) => {
    res.json(Object.keys(users).map((login) => playerServices.profile(login)));
  });

  app.put("/api/admin/players/:login/status", adminRequired, (req, res) => {
    const { login } = req.params;
    const { status } = req.body;
    if (!Object.hasOwn(users, login))
      return res.status(404).json({ error: "Пользователь не найден" });
    if (!["confirmed", "pending", "banned"].includes(status))
      return res.json({ error: "Неверный статус" });
    if (status === "banned") {
      users[login].statusBeforeBan =
        users[login].registrationStatus === "banned"
          ? users[login].statusBeforeBan
          : users[login].registrationStatus;
      users[login].launcherVersion = (users[login].launcherVersion || 0) + 1;
      users[login].frozenUntil = null;
    }
    if (users[login].registrationStatus === status && status !== "banned")
      return res.json({ success: true, player: playerServices.profile(login) });
    users[login].registrationStatus = status;
    playerServices.audit(req, login, "moderation", "status_changed", {
      actor: req.user.login,
      target: status,
    });
    saveUsers();
    res.json({
      success: true,
      player: playerServices.profile(login),
      message: `Статус игрока ${login} изменён на ${status}`,
    });
  });

  // ======================== API: Users list (public) ========================
  app.get("/api/users", (req, res) => {
    const list = Object.entries(users).map(([login, data]) => ({
      login,
      created: data.registeredAt || data.created || 0,
    }));
    res.json(list);
  });

  // ======================== API: Mods ========================
  app.post("/api/upload-mod", adminRequired, (req, res) => {
    if (!req.files || !req.files.mod) return res.json({ error: "No file" });
    const mod = req.files.mod;
    const filePath = path.join(MODS_DIR, mod.name);
    const replacing = fs.existsSync(filePath);
    mod.mv(filePath, (err) => {
      if (err) return res.json({ error: err.message });
      playerServices.audit(
        req,
        req.user.login,
        "administration",
        replacing ? "mod_replaced" : "mod_added",
        { target: mod.name },
      );
      res.json({ success: true, name: mod.name, size: mod.size });
    });
  });

  app.post("/api/delete-mod", adminRequired, (req, res) => {
    const { name } = req.body;
    const filePath = path.join(MODS_DIR, name);
    if (!fs.existsSync(filePath)) return res.json({ error: "Mod not found" });
    fs.unlinkSync(filePath);
    playerServices.audit(req, req.user.login, "administration", "mod_deleted", {
      target: name,
    });
    res.json({ success: true });
  });

  function downloadBuildArchive(req, res, configsOnly = false) {
    const configs = configStore.info();
    if (configsOnly && !configs)
      return res.status(404).json({ error: "Архив конфигов ещё не загружен." });
    const configSnapshot = configStore.acquire();
    const archive = archiver("zip");
    archive.on("error", (error) => {
      console.error("[MCL] Archive:", error.message);
      res.destroy(error);
    });
    archive.on("warning", (error) => {
      console.error("[MCL] Archive:", error.message);
      res.destroy(error);
    });
    res.on("close", () => {
      archive.abort();
      configSnapshot?.release();
    });
    res.attachment(configsOnly ? "configs.zip" : "mods.zip");
    res.set("Cache-Control", "no-store");
    archive.pipe(res);
    const hasMods =
      !configsOnly &&
      fs.existsSync(MODS_DIR) &&
      fs.readdirSync(MODS_DIR).some((f) => f.endsWith(".jar"));
    if (hasMods) {
      archive.directory(MODS_DIR, "mods");
    }
    if (configSnapshot) archive.directory(configSnapshot.directory, "configs");
    if (!hasMods && !configs) {
      archive.append("no mods", { name: "empty.txt" });
    }
    archive.finalize().catch((error) => res.destroy(error));
  }

  app.get("/api/download-mods", (req, res) => downloadBuildArchive(req, res));
  app.get("/api/download-configs", (req, res) =>
    downloadBuildArchive(req, res, true),
  );

  app.get("/api/configs-info", adminRequired, (req, res) =>
    res.json({ configs: configStore.info() }),
  );
  app.post("/api/upload-configs", adminRequired, async (req, res) => {
    try {
      const replacing = Boolean(configStore.info());
      const configs = await configStore.replace(req.files?.configs);
      playerServices.audit(
        req,
        req.user.login,
        "administration",
        replacing ? "configs_replaced" : "configs_added",
        { target: configs.name },
      );
      res.json({ success: true, configs });
    } catch (error) {
      if (!error.status) console.error("[MCL] Config upload:", error.message);
      res
        .status(error.status || 500)
        .json({
          error: error.status
            ? error.message
            : "Не удалось сохранить конфиги. Попробуйте ещё раз.",
        });
    }
  });

  app.get("/api/mods-list", (req, res) => {
    if (!fs.existsSync(MODS_DIR)) return res.json({ mods: [], hash: "empty" });
    const files = fs
      .readdirSync(MODS_DIR)
      .filter((f) => f.endsWith(".jar"))
      .sort();
    const mods = files.map((f) => ({
      name: f,
      size: fs.statSync(path.join(MODS_DIR, f)).size,
    }));
    res.json({ mods, hash: getModsHash() });
  });

  // ======================== API: Build config ========================
  app.get("/api/client-config", (req, res) => {
    const config = getBuildConfig();
    res.json({
      version: config.version,
      loader: config.loader,
      loaderVersion: config.loaderVersion,
      javaVersion: config.javaVersion,
      minMemory: config.minMemory,
      maxMemory: config.maxMemory,
      jvmArgs: config.jvmArgs || ["-Dfile.encoding=UTF-8"],
      servers: config.servers || [
        { name: "MinecraftServer", address: "45.157.232.7:32761" },
      ],
      modsHash: getModsHash(),
      modsURL: `${publicURL}/api/download-mods`,
      configsHash: configStore.info()?.hash || "empty",
      configsURL: configStore.info()
        ? `${publicURL}/api/download-configs`
        : null,
      configsDirectory: "configs",
      launcherServer: config.launcherServer || publicURL,
      serverIP: config.servers?.[0]?.address || "45.157.232.7:32761",
    });
  });

  app.post("/api/build-config", adminRequired, (req, res) => {
    const {
      version,
      loader,
      loaderVersion,
      javaVersion,
      minMemory,
      maxMemory,
      serverIP,
    } = req.body;
    const config = getBuildConfig();
    const previous = JSON.stringify(config);
    if (version) config.version = version;
    if (loader) config.loader = loader;
    if (loaderVersion) config.loaderVersion = loaderVersion;
    if (javaVersion) config.javaVersion = parseInt(javaVersion);
    if (minMemory) config.minMemory = parseInt(minMemory);
    if (maxMemory) config.maxMemory = parseInt(maxMemory);
    if (serverIP) {
      config.servers = [{ name: "MinecraftServer", address: serverIP }];
    }
    config.launcherServer = publicURL;
    database.settings().build = config;
    if (JSON.stringify(config) !== previous)
      playerServices.audit(
        req,
        req.user.login,
        "administration",
        "build_config_changed",
        { target: "server_build" },
      );
    res.json({ success: true, config });
  });

  // ======================== API: Client info ========================
  app.post("/api/upload-launcher", adminRequired, async (req, res) => {
    try {
      const version = String(req.body?.version || '').trim();
      const settings = database.settings();
      const release = await launcherReleases.publish(req.files?.launcher, version, settings.launcherReleases?.versions);
      const catalog = settings.launcherReleases || { versions: {} };
      catalog.versions[version] = release;
      catalog.current = version;
      settings.launcherReleases = catalog;
      playerServices.audit(req, req.user.login, 'administration', 'launcher_uploaded', { target: release.file });
      res.json({ success: true, version, url: launcherReleases.url(version), sha256: release.sha256, size: release.size });
    } catch (error) {
      if (!error.status) console.error("[MCL] Launcher upload:", error.message);
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Не удалось сохранить лаунчер. Попробуйте ещё раз.' });
    }
  });

  app.get('/api/launcher-update', (req, res) => {
    res.vary('User-Agent');
    res.set('Cache-Control', 'no-store');
    if (req.query.platform !== launcherReleases.platform)
      return res.status(400).json({ error: 'Поддерживается только platform=windows-x64.' });
    const catalog = database.settings().launcherReleases;
    const release = catalog?.versions?.[catalog.current];
    const variant = launcherReleases.select(release, req.get('User-Agent'));
    const legacy = variant === release?.legacy;
    if (!variant || !fs.existsSync(launcherReleases.file(release.version, legacy)))
      return res.status(404).json({ error: 'Обновление лаунчера пока не опубликовано.' });
    res.json({ version: release.version, url: launcherReleases.url(release.version, legacy), sha256: variant.sha256, size: variant.size });
  });

  app.get("/api/download-launcher", (req, res) => {
    const file = database.settings().client?.file;
    if (!file || file !== path.basename(file) || !/\.(exe|zip)$/i.test(file))
      return res.status(404).json({ error: "Лаунчер пока недоступен." });
    const filePath = path.join(CLIENTS_DIR, file);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "Лаунчер пока недоступен." });
    res.set("Cache-Control", "no-store");
    res.download(filePath, file);
  });

  app.get("/api/client-info", (req, res) => {
    const catalog = database.settings().launcherReleases;
    const release = catalog?.versions?.[catalog.current];
    if (release && fs.existsSync(launcherReleases.file(release.version))) {
      res.set('Cache-Control', 'no-store');
      return res.json({ version: release.version, url: launcherReleases.url(release.version), sha256: release.sha256, size: release.size });
    }
    const versionData = database.settings().client;
    const file = versionData?.file;
    const filePath = file && file === path.basename(file) ? path.join(CLIENTS_DIR, file) : null;
    const size = filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    res.set("Cache-Control", "no-store");
    res.json({
      version: versionData?.version || "",
      url: `${publicURL}/api/download-launcher`,
      size: size,
      sha256: size ? versionData.sha256 || null : null,
    });
  });

  // ======================== API: Status ========================
  app.get("/api/status", (req, res) => {
    res.json({
      server: "online",
      version: "3.0.0",
      users: Object.keys(users).length,
      mods: fs.existsSync(MODS_DIR)
        ? fs.readdirSync(MODS_DIR).filter((f) => f.endsWith(".jar")).length
        : 0,
      mcServer: getBuildConfig().servers?.[0]?.address || "45.157.232.7:32761",
      buildConfig: getBuildConfig(),
      domain: DOMAIN,
      useHTTPS: USE_HTTPS,
    });
  });

  // Preserve page authorization and return URLs at the public Express entry point.
  app.get(
    ["/", "/mods", "/players", "/profile", "/logs", "/players/:login"],
    authRequired,
    (req, res, next) => next(),
  );
  app.get(["/login", "/register"], (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token && verifyToken(token)) return res.redirect("/profile");
    next();
  });

  // Next.js runs independently. Express remains the public entry point so DOMAIN,
  // PORT, HTTPS, cookies, launcher URLs and the data directory retain their meaning.
  const frontendProxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${process.env.FRONTEND_PORT || 3001}`,
    ws: true,
    xfwd: true,
  });
  frontendProxy.on("error", (err, req, res) => {
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      if (req.accepts("html")) sendErrorPage(res, 503);
      else
        res
          .status(503)
          .set({ "Cache-Control": "no-store", "Retry-After": "5" })
          .json({
            error: "Интерфейс временно недоступен. Попробуйте ещё раз.",
          });
    } else if (res && typeof res.destroy === "function") {
      res.destroy();
    }
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  app.use((req, res) => frontendProxy.web(req, res));
  app.use(handlePageError);

  // ======================== Start server ========================
  function startServer() {
    const httpServer = http.createServer(app);
    httpServer.on("upgrade", (req, socket, head) =>
      frontendProxy.ws(req, socket, head),
    );
    httpServer.listen(PORT, HOST, () => {
      console.log(`[MCL] HTTP server on http://${HOST}:${PORT}`);
    });

    const keyPath = path.join(DATA_DIR, "certs/privkey.pem");
    const certPath = path.join(DATA_DIR, "certs/fullchain.pem");

    if (HTTPS_ENABLED && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.on("upgrade", (req, socket, head) =>
        frontendProxy.ws(req, socket, head),
      );
      httpsServer.listen(HTTPS_PORT, HOST, () => {
        console.log(`[MCL] HTTPS server on https://${HOST}:${HTTPS_PORT}`);
      });
      console.log(`[MCL] HTTPS active: https://${DOMAIN}`);
    } else {
      console.log("[MCL] HTTPS not configured.");
    }

    console.log(`[MCL] Public URL: ${publicURL}`);
    console.log(`[MCL] Web panel: ${publicURL}`);
    console.log(`[MCL] Player portal: ${publicURL}/login`);
  }

  startServer();
}
main().catch((error) => {
  console.error("[MCL] Startup failed:", error.code || error.message);
  process.exit(1);
});
