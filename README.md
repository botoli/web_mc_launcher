# Minecraft Launcher

Веб-панель и кабинет игроков на **Next.js / React / TypeScript** с backend на **Express**.

## Запуск

Нужен Node.js 20.9 или новее.

```powershell
cd E:\mc_launcher\web_mc_launcher
npm.cmd install
npm.cmd run dev
```

Откройте **http://localhost:3000**. Для Windows PowerShell используется `npm.cmd`, чтобы запуск не зависел от политики выполнения `.ps1`.

Для production:

```powershell
npm.cmd run build
npm.cmd start
```

Обе команды запуска (`dev` и `start`) поднимают Express и отдельный процесс Next.js. Остановка через Ctrl+C завершает оба процесса. `npm.cmd run start:backend` запускает только Express; без Next.js страницы будут недоступны, API продолжит работать.

## Настройки и архитектура

Можно скопировать `.env.example` в `.env` и изменить настройки. Общий скрипт запуска загружает `.env` из корня проекта. Переменные окружения процесса имеют приоритет.

- **Express** принимает публичные запросы на `PORT` (по умолчанию `3000`).
- `/api/*`, `/mods/*` и `/download/*` обслуживает существующий backend.
- Страницы и `/_next/*` Express проксирует в Next.js на `127.0.0.1:FRONTEND_PORT` (по умолчанию `3001`). WebSocket-проксирование поддерживает обновление интерфейса при разработке.
- Заходить в приложение нужно через **порт Express**, а не через внутренний порт Next.js.
- Next.js получает данные для серверного рендеринга непосредственно от Express. Cookie авторизации передаётся только в backend; JWT не хранится в localStorage.

Исходные правила формирования адресов сохранены:

```js
const DOMAIN = process.env.DOMAIN || '89.125.214.122';
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const publicURL = USE_HTTPS ? `https://${DOMAIN}` : `http://${DOMAIN}:${PORT}`;
```

При `USE_HTTPS=true` публичный адрес — `https://DOMAIN`. Как и раньше, сертификаты читаются из `data/certs/privkey.pem` и `data/certs/fullchain.pem`, HTTPS слушает `HTTPS_PORT` (по умолчанию `3443`). Для стандартного публичного порта 443 требуется соответствующая настройка reverse proxy / перенаправления портов. Внешний proxy должен передавать `X-Forwarded-Proto: https`.

Все пути в `data` по-прежнему вычисляются относительно **server.js**:

```text
server.js                 Express API, авторизация, файлы и proxy в Next.js
frontend/app/             Маршруты и layout Next.js
frontend/components/      React-компоненты интерфейса
frontend/lib/             Типы и клиенты API
scripts/run.js            Совместный запуск frontend и backend
data/users.json           Пользователи
data/build-config.json    Настройки сборки
data/client-version.json  Версия и имя файла лаунчера
data/mods/                Моды .jar
data/clients/             Файлы для скачивания
```

Существующие launcher API, JWT, форматы конфигурации и хранения пользователей сохранены. Новый защищённый `GET /api/dashboard` выдаёт исходные данные панели без паролей и токенов. Проверки прав используют прежнюю backend-логику; отдельная система ролей этим переносом не добавляется.

## Интерфейс

- `/` — настройки сборки, Java, памяти и игрового сервера.
- `/mods` — загрузка и замена модов, поиск, скачивание и подтверждение удаления.
- `/players` — поиск игроков, фильтр по статусу и изменение статуса.
- `/profile` — данные аккаунта и изменение никнейма.
- `/login`, `/register` — вход и регистрация.

Цвета: `#AC88F6`, `#1A1A1A`, `#464646`, `#222222`, `#B8FEBF`. Шрифт Manrope поставляется локально вместе с приложением. В интерфейсе есть адаптивная навигация, состояния загрузки, сообщения об ошибках и клавиатурное управление.

На широком экране страницы помещаются в высоту окна; на узком длинные формы и списки прокручиваются внутри области содержимого без прокрутки всей страницы и без выхода за ширину экрана.

## Проверки

```powershell
npm.cmd run typecheck
npm.cmd run build
npx.cmd playwright install chromium --only-shell
npm.cmd test
```

Тесты запускают Next.js и Express на свободных локальных портах, создают отдельные временные данные и проверяют API и действия в браузере. Настоящая папка `data` не используется. Скриншоты сохраняются в `artifacts/`.
