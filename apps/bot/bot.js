// Standalone Node.js 22+ worker. No npm dependencies; copy this directory to
// another host and provide .env. Users and sessions stay on the web backend.
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

// Existing deployments keep their private .env and pending delivery receipts.
// A copied apps/bot directory remains standalone and uses its own configuration.
const legacyDirectory = path.resolve(__dirname, "../../bot");
const configDirectory = fs.existsSync(path.join(legacyDirectory, ".env"))
  ? legacyDirectory
  : __dirname;
try {
  process.loadEnvFile(path.join(configDirectory, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw new Error("Cannot read bot .env");
}
const token = process.env.telegrambotapi;
const secret = process.env.TELEGRAM_BOT_SECRET;
const base = process.env.AUTH_API_URL;
if (!token || !secret || secret.length < 32 || !base)
  throw new Error(
    "Set telegrambotapi, TELEGRAM_BOT_SECRET (32+ chars), AUTH_API_URL in the bot .env",
  );
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !(
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
) {
  throw new Error(
    "AUTH_API_URL must use HTTPS (HTTP is allowed only on localhost)",
  );
}
let stopped = false;
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopped = true;
    controller.abort();
  });
// Only messages built here may be logged. Fetch errors and API bodies can
// contain credentials, Bot API URLs or other private values.
class BotError extends Error {}
const receiptFile = process.env.TELEGRAM_DELIVERY_STATE_FILE || path.join(configDirectory, '.delivery-receipts.json');
let receipts = [];
try {
  if (fs.existsSync(receiptFile)) receipts = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (!Array.isArray(receipts) || receipts.some(r => !['sent', 'edited'].includes(r.kind) || !Number.isSafeInteger(r.chat_id) || r.chat_id <= 0 || !Number.isSafeInteger(r.message_id) || r.message_id <= 0)) throw new Error();
} catch { throw new BotError('Cannot read bot delivery state.'); }
function saveReceipts() {
  try {
    fs.writeFileSync(receiptFile + '.tmp', JSON.stringify(receipts), { mode: 0o600 });
    fs.renameSync(receiptFile + '.tmp', receiptFile);
  } catch { throw new BotError('Cannot save bot delivery state.'); }
}
function safeReason(error) {
  return error instanceof BotError ? error.message : "Unexpected internal error";
}
async function post(endpoint, body, telegram = false, timeout = 15000) {
  const target = telegram
    ? `https://api.telegram.org/bot${token}/${endpoint}`
    : new URL(`/api/internal/telegram/${endpoint}`, url);
  const label = `${telegram ? "Telegram" : "Backend"} ${endpoint}`;
  let response;
  try {
    response = await fetch(target, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(!telegram ? { "X-Bot-Secret": secret } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
    });
  } catch {
    throw new BotError(`${label}: connection failed or timed out. Check network, API address and whether the backend is running.`);
  }
  let result;
  try { result = await response.json(); }
  catch { result = null; }
  if (telegram && endpoint === 'editMessageText' && response.status === 400 && /message is not modified/i.test(result?.description || '')) {
    return { message_id: body.message_id };
  }
  if (!response.ok || (telegram && !result?.ok)) {
    const code = response.status;
    let hint = "Check service availability.";
    if (telegram && [401, 404].includes(code)) hint = "Check telegrambotapi in the bot .env; the bot token may be invalid or revoked.";
    else if (!telegram && [401, 403].includes(code)) hint = "TELEGRAM_BOT_SECRET must match in backend .env and bot .env (32+ characters). Restart the backend after changing it.";
    else if (!telegram && code === 404) hint = "Update apps/api, then restart the backend; verify AUTH_API_URL and port.";
    else if (telegram && code === 409) hint = "Another getUpdates process or webhook is active. Run only one bot instance.";
    else if (!telegram && code === 409) hint = "Backend is already configured for a different bot username.";
    const error = new BotError(`${label}: HTTP ${code}. ${hint}`);
    error.code = code;
    error.fatal = [401, 403, 409].includes(response.status);
    error.retry = Math.min(
      60,
      Math.max(1, Number(result?.parameters?.retry_after) || 5),
    );
    throw error;
  }
  if (!result || typeof result !== "object") throw new BotError(`${label}: invalid JSON response. Check backend address and proxy configuration.`);
  return telegram ? result.result : result;
}
async function main() {
  const me = await post("getMe", {}, true);
  const webhook = await post("getWebhookInfo", {}, true);
  if (webhook.url)
    throw new BotError(
      "Bot has an active webhook. Remove it deliberately before starting long polling.",
    );
  let { offset } = await post("connect", { username: me.username });
  try {
    await post("setMyCommands", { commands: [
      { command: "menu", description: "🌙 Главное меню" },
      { command: "login", description: "🔗 Привязать лаунчер / войти по коду" },
      { command: "account", description: "👤 Мой аккаунт" },
      { command: "password", description: "🔐 Изменить пароль" },
      { command: "sessions", description: "💻 Сессии лаунчера" },
      { command: "unlink", description: "🔓 Отвязать аккаунт" },
      { command: "help", description: "❔ Помощь" },
      { command: "cancel", description: "✖️ Отменить действие" },
    ] }, true);
  } catch (error) {
    if (error.fatal) throw error;
    console.error("Could not configure bot command menu; chat buttons remain available.");
  }
  console.log(`Telegram bot @${me.username} connected`);
  async function drainReceipts() {
    while (receipts.length) {
      const result = await post('delivery', receipts[0]);
      receipts.shift(); saveReceipts();
      await deliver(result.actions || []);
    }
  }
  async function deliver(actions) {
    for (const action of actions) {
      if (!["sendMessage", "editMessageText", "answerCallbackQuery", "deleteMessages"].includes(action.method)) throw new BotError("Unexpected bot action");
      let result, deliveredMethod = action.method;
      try { result = await post(action.method, action.body, true); }
      catch (error) {
        if (action.method === 'editMessageText' && error.code === 400) {
          const { message_id, ...body } = action.body;
          result = await post('sendMessage', body, true);
          deliveredMethod = 'sendMessage';
        } else {
          if (action.method === 'deleteMessages') {
            await post('delivery', { kind: 'delete_failed', chat_id: action.body.chat_id, operation_id: action.id, code: error.code || 0 });
            if (error.code === 401) throw error;
            console.error('Message cleanup failed; a retry is scheduled.');
            continue;
          }
          if (error.fatal) throw error;
          console.error("Could not deliver bot reply. Send /menu or /login to retry.");
          continue;
        }
      }
      if (['sendMessage', 'editMessageText'].includes(deliveredMethod)) {
        const messageId = result?.message_id || (deliveredMethod === 'editMessageText' ? action.body.message_id : null);
        if (Number.isSafeInteger(messageId)) {
          receipts.push({ kind: deliveredMethod === 'sendMessage' ? 'sent' : 'edited', chat_id: action.body.chat_id, message_id: messageId });
          saveReceipts();
          await drainReceipts();
        }
      } else if (action.method === 'deleteMessages') {
        await post('delivery', { kind: 'deleted', chat_id: action.body.chat_id, operation_id: action.id });
      }
    }
  }
  while (!stopped) {
    try {
      await drainReceipts();
      await deliver((await post('pending-actions', {})).actions);
      const updates = await post(
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
        true,
        35000,
      );
      for (const update of updates) {
        const { actions } = await post("update", update);
        offset = update.update_id + 1;
        await deliver(actions);
      }
    } catch (error) {
      if (stopped) break;
      if (error.fatal) throw error;
      console.error(`Connection unavailable; retrying. ${safeReason(error)}`);
      await delay((error.retry || 5) * 1000, undefined, {
        signal: controller.signal,
      }).catch(() => {});
    }
  }
}
main().catch((error) => {
  if (!stopped) {
    console.error(`Bot stopped. ${safeReason(error)}`);
    process.exitCode = 1;
  }
});
