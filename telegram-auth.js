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

// Only this backend writes users.json. The separately hosted bot forwards updates
// over the authenticated internal API and never opens a second copy of the file.
function installTelegramAuth(
  app,
  { users, saveUsers, dataDir, secret = "", now = Date.now },
) {
  const stateFile = path.join(dataDir, "telegram-auth-state.json");
  let state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : { challenges: {}, sessions: {}, offset: 0, bot: null };
  function save() {
    const temp = `${stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, stateFile);
  }
  function clean() {
    for (const [id, c] of Object.entries(state.challenges)) {
      if (c.expires_at + 60000 < now()) delete state.challenges[id];
    }
    for (const [id, s] of Object.entries(state.sessions)) {
      if (s.expires_at < now()) delete state.sessions[id];
    }
  }
  function userForTelegram(id) {
    return Object.entries(users).find(([, u]) => u.telegramId === String(id));
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
      users[login].registrationStatus !== "banned" &&
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
      !eligible(s.login) ||
      users[s.login].telegramId !== s.telegramId
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
    const ip = req.socket.remoteAddress;
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
    const c = {
      poll_hash: hash(poll),
      link_hash: hash(link),
      code: crypto.randomBytes(3).toString("hex").toUpperCase(),
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
    res.set("Cache-Control", "no-store").json({ status: req.challenge.status });
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
      if (!eligible(c.login))
        return res
          .status(403)
          .json({ error: "Доступ заблокирован или некорректный ник" });
      const token = random();
      const expires_at = now() + 30 * 86400000;
      c.status = "consumed";
      state.sessions[hash(token)] = {
        login: c.login,
        telegramId: users[c.login].telegramId,
        expires_at,
      };
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
  app.post("/api/internal/telegram/update", workerRequired, (req, res) => {
    const update = req.body;
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0)
      return res.status(400).json({ error: "Invalid update" });
    if (update.update_id < state.offset) return res.json({ actions: [] });
    clean();
    const actions = [];
    const send = (chat_id, text, reply_markup) =>
      actions.push({
        method: "sendMessage",
        body: { chat_id, text, ...(reply_markup ? { reply_markup } : {}) },
      });
    const msg = update.message;
    const cb = update.callback_query;
    if (
      msg?.chat?.type === "private" &&
      Number.isSafeInteger(msg.from?.id) &&
      !msg.from.is_bot &&
      msg.chat.id === msg.from.id
    ) {
      const id = String(msg.from.id);
      const start =
        typeof msg.text === "string" &&
        /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/.exec(msg.text);
      let c;
      if (start) {
        c = Object.values(state.challenges).find(
          (c) =>
            c.link_hash === hash(start[1]) &&
            c.status === "pending" &&
            c.expires_at > now(),
        );
        if (c && (!c.telegramId || c.telegramId === id)) {
          c.telegramId = id;
          c.chatId = msg.chat.id;
          c.started_at = now();
        } else c = null;
      } else {
        c = Object.values(state.challenges)
          .filter(
            (c) =>
              c.telegramId === id &&
              c.status === "pending" &&
              c.expires_at > now(),
          )
          .sort((a, b) => b.started_at - a.started_at)[0];
      }
      if (!c) send(msg.chat.id, "Для входа откройте ссылку из лаунчера.");
      else {
        const existing = userForTelegram(id);
        if (existing && !eligible(existing[0]))
          send(
            msg.chat.id,
            "Аккаунт заблокирован или ник некорректен. Обратитесь к администратору.",
          );
        else {
          if (existing) c.login = existing[0];
          else if (!start && nicknameValid(msg.text?.trim())) {
            const nick = msg.text.trim();
            if (
              Object.values(users).some(
                (u) => String(u.nickname).toLowerCase() === nick.toLowerCase(),
              )
            )
              send(msg.chat.id, "Этот ник занят. Введите другой.");
            else c.nickname = nick;
          }
          if (c.login || c.nickname) {
            send(
              msg.chat.id,
              `Equestrian Dream Launcher\nВход: ${c.login ? users[c.login].nickname : c.nickname}\nКод запроса: ${c.code}\nПодтвердите, только если этот код показан в вашем лаунчере.`,
              {
                inline_keyboard: [
                  [
                    {
                      text: "Подтвердить вход",
                      callback_data: `yes:${c.code}`,
                    },
                    { text: "Отклонить", callback_data: `no:${c.code}` },
                  ],
                ],
              },
            );
          } else
            send(
              msg.chat.id,
              "Введите новый игровой ник: 3–16 латинских букв, цифр или _. Существующий ник не подтверждает владение аккаунтом.",
            );
        }
      }
    } else if (
      cb?.message?.chat?.type === "private" &&
      Number.isSafeInteger(cb.from?.id) &&
      !cb.from.is_bot &&
      cb.message.chat.id === cb.from.id
    ) {
      const match = /^(yes|no):([A-F0-9]{6})$/.exec(cb.data || "");
      const c =
        match &&
        Object.values(state.challenges).find(
          (c) =>
            c.code === match[2] &&
            c.telegramId === String(cb.from.id) &&
            c.chatId === cb.message.chat.id &&
            c.status === "pending" &&
            c.expires_at > now(),
        );
      let text = "Запрос недоступен или уже обработан.";
      if (c && match[1] === "no") {
        c.status = "rejected";
        text = "Вход отклонён.";
      } else if (c) {
        if (!c.login && nicknameValid(c.nickname)) {
          const login = `tg_${c.telegramId}`;
          if (
            !own(users, login) &&
            !userForTelegram(c.telegramId) &&
            !Object.values(users).some(
              (u) =>
                String(u.nickname).toLowerCase() === c.nickname.toLowerCase(),
            )
          ) {
            users[login] = {
              password: null,
              email: "",
              nickname: c.nickname,
              registrationStatus: "pending",
              registeredAt: now(),
              lastLogin: null,
              token: null,
              telegramId: c.telegramId,
            };
            saveUsers();
            c.login = login;
          }
        }
        if (eligible(c.login) && users[c.login].telegramId === c.telegramId) {
          c.status = "confirmed";
          text = "Вход подтверждён. Вернитесь в лаунчер.";
        } else
          text =
            "Ник занят или доступ заблокирован. Начните новый вход в лаунчере.";
      }
      actions.push({
        method: "answerCallbackQuery",
        body: { callback_query_id: cb.id, text },
      });
      send(cb.message.chat.id, text);
    }
    state.offset = update.update_id + 1;
    save();
    res.json({ actions });
  });
  return { session };
}
module.exports = { installTelegramAuth };
