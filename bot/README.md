# Совместимость прежнего пути бота

Исходники worker и инструкция перенесены в [`apps/bot/`](../apps/bot/README.md), контракт входа лаунчера — в [`docs/launcher-auth.md`](../docs/launcher-auth.md).

`node bot/bot.js` продолжает запускать worker. Существующие `.env` и `.delivery-receipts.json` остаются здесь и используются автоматически. Рабочий код редактируйте в `apps/bot/` и `apps/api/src/telegram/`.
