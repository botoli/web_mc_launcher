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
async function post(endpoint, body, telegram = false, timeout = 15000) {
  const target = telegram
    ? `https://api.telegram.org/bot${token}/${endpoint}`
    : new URL(`/api/internal/telegram/${endpoint}`, url);
  const response = await fetch(target, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      ...(!telegram ? { "X-Bot-Secret": secret } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
  });
  const result = await response.json();
  if (!response.ok || (telegram && !result.ok)) {
    const error = new Error(
      `${telegram ? "Telegram" : "Auth API"} returned ${response.status}`,
    );
    error.fatal = [401, 403, 409].includes(response.status);
    error.retry = Math.min(
      60,
      Math.max(1, Number(result.parameters?.retry_after) || 5),
    );
    throw error;
  }
  return telegram ? result.result : result;
}
async function main() {
  const me = await post("getMe", {}, true);
  const webhook = await post("getWebhookInfo", {}, true);
  if (webhook.url)
    throw new Error(
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
      console.error("Connection unavailable; retrying.");
      await delay((error.retry || 5) * 1000, undefined, {
        signal: controller.signal,
      }).catch(() => {});
    }
  }
}
main().catch(() => {
  if (!stopped) {
    console.error(
      "Bot stopped. Check credentials, backend availability, webhook and other bot instances.",
    );
    process.exitCode = 1;
  }
});
