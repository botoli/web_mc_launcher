const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const random = () => crypto.randomBytes(32).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const nicknameValid = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_]{3,16}$/.test(value);
const own = (object, key) =>
  typeof key === "string" && Object.hasOwn(object, key);
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  crypto.timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

// The bot forwards updates over the authenticated internal API. Production state
// belongs to the request's PostgreSQL transaction; the file adapter supports legacy fixtures.
function installTelegramAuth(
  app,
  { users, saveUsers, dataDir, storage, secret = "", now = Date.now, audit = () => {}, restriction = u => u.registrationStatus === "banned" || u.frozenUntil > now() },
) {
  const stateFile = path.join(dataDir, "telegram-auth-state.json");
  let state = storage ? storage.telegram : fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : { challenges: {}, sessions: {}, offset: 0, bot: null };
  state.conversations ||= {};
  state.codeAttempts ||= {};
  function save() {
    if (storage) return; // Committed atomically with users and audit events.
    const temp = `${stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, stateFile);
  }
  function clean() {
    for (const [id, c] of Object.entries(state.challenges)) {
      if (c.expires_at + 60000 < now()) delete state.challenges[id];
    }
    for (const bucket of [state.conversations, state.codeAttempts]) {
      for (const [id, item] of Object.entries(bucket))
        if (item.expires_at <= now()) delete bucket[id];
    }
    for (const [id, s] of Object.entries(state.sessions)) {
      if (s.expires_at < now()) delete state.sessions[id];
    }
  }
  function userForTelegram(id) {
    return Object.entries(users).find(([, u]) => u.telegramId != null && String(u.telegramId) === String(id));
  }
  function profile(login) {
    const u = users[login];
    return {
      login,
      nickname: u.nickname,
      registrationStatus: u.registrationStatus || "confirmed",
    };
  }
  function eligible(login) {
    return (
      own(users, login) &&
      !restriction(users[login]) &&
      nicknameValid(users[login].nickname)
    );
  }
  const attempts = new Map();
  function rateLimit(req, res, next) {
    const key = req.socket.remoteAddress;
    const entry = attempts.get(key);
    if (!entry || entry.until < now()) {
      if (attempts.size > 10000) {
        for (const [k, v] of attempts) if (v.until < now()) attempts.delete(k);
        if (attempts.size > 10000)
          return res.status(429).json({ error: "Повторите позже" });
      }
      attempts.set(key, { count: 1, until: now() + 60000 });
    } else if (++entry.count > 120)
      return res.status(429).json({ error: "Слишком много запросов" });
    next();
  }
  function workerRequired(req, res, next) {
    if (secret.length < 32 || !same(req.get("X-Bot-Secret"), secret))
      return res.status(401).json({ error: "Unauthorized" });
    next();
  }
  function challenge(req, res, next) {
    const c =
      own(state.challenges, req.params.id) && state.challenges[req.params.id];
    if (!c || !same(hash(req.get("X-Poll-Secret") || ""), c.poll_hash))
      return res.status(404).json({ error: "Запрос не найден" });
    if (c.expires_at <= now() && !["consumed", "cancelled"].includes(c.status))
      c.status = "expired";
    req.challenge = c;
    next();
  }
  function session(req, res, next) {
    const token = (req.get("Authorization") || "").replace(/^Bearer /, "");
    const key = hash(token);
    const s = state.sessions[key];
    if (
      !s ||
      s.expires_at <= now() ||
      (s.launcherVersion || 0) !== (users[s.login]?.launcherVersion || 0) ||
      !eligible(s.login) ||
      String(users[s.login].telegramId) !== s.telegramId
    ) {
      return res
        .status(401)
        .json({ error: "Сессия истекла или доступ заблокирован" });
    }
    req.telegramSession = s;
    req.telegramSessionKey = key;
    next();
  }

  app.use("/api/auth", rateLimit);
  app.post("/api/auth/telegram/challenges", (req, res) => {
    clean();
    if (!state.bot || secret.length < 32)
      return res.status(503).json({ error: "Telegram-бот ещё не подключён" });
    if (Object.keys(state.challenges).length >= 5000)
      return res.status(429).json({ error: "Повторите позже" });
    const ip = req.ip || req.socket.remoteAddress;
    if (
      Object.values(state.challenges).filter(
        (c) => c.ip === ip && c.expires_at > now() && c.status === "pending",
      ).length >= 5
    ) {
      return res
        .status(429)
        .json({ error: "Слишком много активных запросов входа" });
    }
    const id = random();
    const poll = random();
    const link = random();
    let code;
    do { code = crypto.randomBytes(4).toString("hex").toUpperCase(); }
    while (Object.values(state.challenges).some((c) => c.code === code));
    const c = {
      step: "awaiting_code",
      poll_hash: hash(poll),
      link_hash: hash(link),
      code,
      expires_at: now() + 300000,
      status: "pending",
      ip,
    };
    state.challenges[id] = c;
    save();
    res
      .set("Cache-Control", "no-store")
      .json({
        id,
        poll_secret: poll,
        code: c.code,
        expires_at: c.expires_at,
        url: `https://t.me/${state.bot}?start=${link}`,
      });
  });
  app.get("/api/auth/telegram/challenges/:id", challenge, (req, res) => {
    res.set("Cache-Control", "no-store").json({
      status: req.challenge.status,
      step: req.challenge.status === "pending"
        ? req.challenge.step || "awaiting_code" : req.challenge.status,
      expires_at: req.challenge.expires_at,
    });
  });
  app.delete("/api/auth/telegram/challenges/:id", challenge, (req, res) => {
    if (["pending", "confirmed"].includes(req.challenge.status))
      req.challenge.status = "cancelled";
    save();
    res.json({ success: true });
  });
  app.post(
    "/api/auth/telegram/challenges/:id/exchange",
    challenge,
    (req, res) => {
      const c = req.challenge;
      if (c.status !== "confirmed")
        return res
          .status(409)
          .json({ error: "Вход не подтверждён или запрос уже использован" });
      if (!eligible(c.login) || !c.code_verified ||
          String(users[c.login].telegramId) !== c.telegramId) {
        audit(req, c.login, "auth", "login", { source: "telegram", method: "bot", bot: state.bot, outcome: "denied", reason: "Доступ заблокирован или некорректный ник" });
        return res
          .status(403)
          .json({ error: "Доступ заблокирован или некорректный ник" });
      }
      const token = random();
      const expires_at = now() + 30 * 86400000;
      c.status = "consumed";
      state.sessions[hash(token)] = {
        login: c.login,
        telegramId: String(users[c.login].telegramId),
        expires_at,
        launcherVersion: users[c.login].launcherVersion || 0,
      };
      audit(req, c.login, "auth", "login", { source: "telegram", method: "bot", bot: state.bot, telegramId: c.telegramId, telegramUsername: users[c.login].telegramUsername });
      users[c.login].lastLogin = now();
      saveUsers();
      save();
      res
        .set("Cache-Control", "no-store")
        .json({ token, expires_at, user: profile(c.login) });
    },
  );
  app.get("/api/auth/me", session, (req, res) => {
    res
      .set("Cache-Control", "no-store")
      .json(profile(req.telegramSession.login));
  });
  app.post("/api/auth/logout", session, (req, res) => {
    audit(req, req.telegramSession.login, "auth", "logout", { source: "telegram", method: "token", bot: state.bot });
    delete state.sessions[req.telegramSessionKey];
    save();
    res.json({ success: true });
  });

  app.post("/api/internal/telegram/connect", workerRequired, (req, res) => {
    if (
      typeof req.body.username !== "string" ||
      !/^[A-Za-z0-9_]{5,32}$/.test(req.body.username)
    )
      return res.status(400).json({ error: "Invalid bot username" });
    if (state.bot && state.bot !== req.body.username)
      return res
        .status(409)
        .json({ error: "Another bot is already configured" });
    state.bot = req.body.username;
    save();
    res.json({ offset: state.offset });
  });
  require('./cabinet').installTelegramCabinet(app, {
    state, users, saveUsers, save, clean, now, audit, restriction, workerRequired,
  });
  return { session };
}
module.exports = { installTelegramAuth };
