# Express API

Точка входа — `src/server.js`. Запуск из корня репозитория: `npm run start:backend`; вместе с веб-интерфейсом: `npm run dev` или `npm start` после `npm run build`.

- `src/auth/` — пароли.
- `src/config/` — расположение корня, `.env` и данных.
- `src/database/` — PostgreSQL, схема и транзакции.
- `src/players/` — профили, роли, модерация и журнал.
- `src/telegram/` — серверная логика диалогов бота и авторизация лаунчера.

Настройки читаются из корневого `.env`, файловые данные — из корневого `data/`. Изменения проверяются через `npm run test:telegram`, `npm run test:database` и `npm test`.

Подробнее: [архитектура](../../docs/architecture.md), [база](../../docs/database.md), [контракт Telegram-входа](../../docs/launcher-auth.md).
