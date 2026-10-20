import config from "../player-site.config.json";

// Public contact only. Bot tokens and backend secrets never belong in this file.
const username = config.telegramBotUsername.trim().replace(/^@/, "");
if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
  throw new Error("player-site.config.json: telegramBotUsername must be a Telegram username, without a URL.");
}

export const telegramBot = {
  username,
  handle: `@${username}`,
  url: `https://t.me/${username}`,
};
