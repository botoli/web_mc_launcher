# Express API

Точка входа — `src/server.js`. Запуск из корня репозитория: `npm run start:backend`; вместе с веб-интерфейсом: `npm run dev` или `npm start` после `npm run build`.

- `src/auth/` — пароли.
- `src/config/` — расположение корня, `.env` и данных.
- `src/database/` — PostgreSQL, схема и транзакции.
- `src/players/` — профили, роли, модерация и журнал.
- `src/telegram/` — серверная логика диалогов бота и авторизация лаунчера.

Настройки читаются из корневого `.env`, файловые данные — из корневого `data/`. Изменения проверяются через `npm run test:telegram`, `npm run test:database` и `npm test`.

Подробнее: [архитектура](../../docs/architecture.md), [база](../../docs/database.md), [контракт Telegram-входа](../../docs/launcher-auth.md).

Обновления Windows публикуются существующей админкой (`POST /api/upload-launcher`).
Загружаемый ZIP должен содержать ровно `Nevermore.exe` и `README.txt` в корне.
Сервер сохраняет современный `<version>.zip` и автоматически создаёт
`<version>-legacy.zip` с `EquestrianDreamLauncher.exe` и тем же `README.txt`.
EXE в обоих вариантах совпадает побайтово; оба ZIP проверяются до переключения
текущей версии в транзакции PostgreSQL. Повторная публикация версии запрещена,
включая файлы, оставшиеся после неуспешного коммита. Для повторной публикации
нужен новый номер версии.

Публичный `GET /api/launcher-update?platform=windows-x64` выбирает legacy ZIP
для `User-Agent: EquestrianDreamLauncher/<version>`, а для `Nevermore/<version>`
и остальных клиентов — современный ZIP. Ответ содержит прежние поля `version`,
`url`, `sha256`, `size`; SHA-256 и размер относятся к выбранному архиву.
Заголовки: `Vary: User-Agent`, `Cache-Control: no-store`. Относительный `url`
ведёт на тот же HTTPS origin, под `/download/launcher/`; скачивание публичное,
без авторизации и перенаправлений. Опубликованные ZIP неизменяемые и кэшируются.

При старте backend существующая текущая публикация автоматически получает
совместимый ZIP и метаданные без изменения исходного ZIP. При несовпадении
контрольной суммы или ошибке проверки запуск прерывается; каталог не изменяется.
Миграцию имени EXE после установки выполняет клиент 0.1.26.

Проверка: `node --test tests/launcher-release.test.js`, затем `npm test`
(Node.js 24). Для установки изменений backend достаточно
`sudo systemctl restart mc-launcher-server.service`;
проверка состояния: `sudo systemctl status mc-launcher-server.service --no-pager`.
Сборка фронтенда для этого изменения не требуется.
