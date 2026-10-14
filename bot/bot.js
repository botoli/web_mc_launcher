// Standalone Node.js 22+ worker. No npm dependencies; copy this directory to
// another host and provide .env. Users and sessions stay on the web backend.
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (e) {
  if (e.code !== "ENOENT") throw new Error("Cannot read bot/.env");
}
const token = process.env.telegrambotapi;
const secret = process.env.TELEGRAM_BOT_SECRET;
const base = process.env.AUTH_API_URL;
if (!token || !secret || secret.length < 32 || !base)
  throw new Error(
    "Set telegrambotapi, TELEGRAM_BOT_SECRET (32+ chars), AUTH_API_URL in bot/.env",
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
  if (!response.ok || (telegram && !result?.ok)) {
    const code = response.status;
    let hint = "Check service availability.";
    if (telegram && [401, 404].includes(code)) hint = "Check telegrambotapi in bot/.env; the bot token may be invalid or revoked.";
    else if (!telegram && [401, 403].includes(code)) hint = "TELEGRAM_BOT_SECRET must match in backend .env and bot/.env (32+ characters). Restart the backend after changing it.";
    else if (!telegram && code === 404) hint = "Update backend server.js and telegram-auth.js, then restart the backend; verify AUTH_API_URL and port.";
    else if (telegram && code === 409) hint = "Another getUpdates process or webhook is active. Run only one bot instance.";
    else if (!telegram && code === 409) hint = "Backend is already configured for a different bot username.";
    const error = new BotError(`${label}: HTTP ${code}. ${hint}`);
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
  console.log(`Telegram bot @${me.username} connected`);
  while (!stopped) {
    try {
      const updates = await post(
        "getUpdates",
        { offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
        true,
        35000,
      );
      for (const update of updates) {
        const { actions } = await post("update", update);
        for (const action of actions) {
          if (!["sendMessage", "answerCallbackQuery"].includes(action.method))
            throw new Error("Unexpected bot action");
          try {
            await post(action.method, action.body, true);
          } catch (error) {
            if (error.fatal) throw error;
            console.error(
              "Could not deliver bot reply. Open the launcher link again.",
            );
          }
        }
        offset = update.update_id + 1;
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
