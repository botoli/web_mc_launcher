# Публичный сайт игрока

Размещение на существующем сервере Ubuntu `89.125.214.122` под отдельным доменом описано в [player-domain.md](player-domain.md). В `deploy/nginx/` подготовлены HTTP/HTTPS-конфигурации для `play.nevermoreland.ru` и правило закрытия `/play` на административном домене.

Локальные страницы в существующем Next.js-приложении:

- `/play` — главный экран с кнопками «Скачать для Windows» и «Как начать играть».
- `/play/how-to-play` — установка, три шага, Telegram/Discord и ответы на частые вопросы.
- `/play/telegram` — подробная инструкция по входу: новый, существующий и уже привязанный аккаунт; команды кабинета и помощь.
- `/play/download` — потоковая выдача последней опубликованной версии без авторизации.

Запуск из корня репозитория на Node.js 24:

```sh
npm run dev
```

Открыть `http://localhost:3000/play`. Dev-режим использует HTTP на localhost и отключает встроенный TLS, даже если `.env` содержит production HTTPS-адрес. Явный `PUBLIC_URL`, переданный через окружение команды, имеет приоритет. Production-запуск `npm start` использует прежние настройки. Уже работающий dev-процесс нужно перезапустить после изменения runner.

Административные маршруты сохранены. На сайте игрока нет форм входа, регистрации или профиля. Ссылка на Telegram-бота доступна в инструкции, но вход начинается с кода из самого лаунчера. Discord-бот показан со статусом «В разработке», без ссылки подключения.

Скачивание получает метаданные `/api/client-info` серверным запросом, проверяет путь и передаёт файл через `/play/download`. Браузер не получает абсолютный URL из backend; домен админки не используется в ссылках или перенаправлениях сайта игрока. Поддержаны опубликованные ZIP и прежний endpoint скачивания. При недоступном файле пользователь возвращается на главный экран с понятным сообщением. Этот этап не меняет DNS, сетевой доступ к админке и адреса, зашитые в самом лаунчере.

В шапке доступны две кнопки оформления: «Хеллоуин» и «Оригинальная тема». По умолчанию применяется оригинальная тема. Выбор хранится в `localStorage` под ключом `nevermoreland-player-theme` (`halloween`, `original`). Сохранённая удалённая тема `regular` переводится в `original`; прежнее отключение сезонного оформления также открывает оригинальную тему. Фон загружается при выборе соответствующей темы. Вёрстка адаптирована под телефон и клавиатурную навигацию; инструкция и FAQ читаются и без клиентского JavaScript.

## Контакты и цвета

Публичное имя Telegram-бота задаётся в [`apps/web/player-site.config.json`](../apps/web/player-site.config.json):

```json
{
  "telegramBotUsername": "mc_launcherbot"
}
```

Укажите username без URL (`@` в начале также допускается). Все ссылки и упоминания на сайте используют это значение через `apps/web/lib/player-config.ts`. Dev-сервер подхватит изменение; для production нужно заново собрать и перезапустить Next.js. Это публичный контакт сайта: конфиг не меняет токен или реальное имя worker-бота, которое backend получает через `getMe`. Секреты в этот JSON добавлять нельзя.

Токены цветов находятся в начале `apps/web/app/play/play.css`: оригинальная тема — зелёный `#a7d58b`, Хеллоуин — оранжевый `#f1b475`. При смене темы обновляются акценты, кнопки, текст, рамки и поверхности на всех публичных страницах. Административный интерфейс использует свои стили.

Инструкция `/play/telegram` основана на `apps/api/src/telegram/cabinet.js`, `apps/api/src/telegram/auth.js` и `apps/bot/README.md`. При изменении сценариев бота обновляйте и пользовательскую инструкцию. На сайте нет собственной формы регистрации: код вводится в личный чат с ботом, окончательное подтверждение выполняется там же.

## Фоны

Оригинальная тема использует `apps/web/public/backgrounds/player-original-desktop-75f2dcf2da5a.webp` — дневное изображение пользователя с лошадьми, персонажем и голубым небом (1672×941). Хеллоуинская версия создана встроенным imagegen редактированием этого же изображения: осенняя листва, сумерки и светящиеся тыквы с сохранением композиции.

Пути к актуальным версиям обеих тем находятся в `apps/web/lib/player-backgrounds.json`, файлы — в `apps/web/public/backgrounds/`. Хеллоуинские WebP экспортированы с качеством 80 для компьютера (1672×941) и 78 для телефона (480×854), effort 6. Мобильный вариант — центральный портретный кадр.

Первая загрузка запрашивает только выбранную тему. Первая картинка имеет высокий приоритет загрузки; смена темы начинается после `img.decode()`. Новый фон плавно появляется за 850 мс поверх прежнего. Быстрые нажатия применяют последний выбор; при сетевой ошибке сохраняется предыдущий фон и доступна повторная попытка. При `prefers-reduced-motion: reduce` переход мгновенный. Без JavaScript остаётся статичный адаптивный оригинальный фон.

Имена содержат SHA-256 файлов для обновления браузерного кеша. Для четырёх текущих WebP в Next.js настроен `Cache-Control: public, max-age=31536000, immutable`. Предыдущие версии изображений сохранены. Фоны центрированы на главном экране и в иллюстрации инструкции.

Промпт хэллоуинской версии (встроенный imagegen; исходное изображение передано как edit target):

> Use case: lighting-weather / precise-object-edit. Asset type: wide website background for a Minecraft players page. Edit target: the supplied Minecraft image with horses surrounding a small player. Create a Halloween version of THIS SAME image. Preserve the exact camera angle, wide 16:9 composition, all horses' positions, colors and recognizable markings, central player's identity and pose, stone hillside, birch trees and fence. Keep the Minecraft block geometry and shader-rendered style. Transform daylight into atmospheric blue-violet twilight, foliage into autumn orange and gold, add a few glowing carved block pumpkins along the fence and path, subtle ground mist and warm pumpkin lighting. Keep the horses and player clearly visible, tasteful seasonal mood. No text, no logos, no watermark, no interface. Return only the finished full-bleed landscape image.

## Проверка

```sh
npm run typecheck
npm run build
npm run test:player-site
```

Тест использует временные данные и отдельную схему PostgreSQL, проверяет главную и инструкцию на трёх размерах экрана, сохранение темы, FAQ, отсутствие форм входа, скачивание без cookie после публикации двух версий и поведение при недоступном файле. Дополнительные сценарии проверяют медленную загрузку, наложение фонов, быстрый выбор тем, `reduced-motion`, ошибку загрузки с повторной попыткой и отсутствие запросов настольных фонов на телефоне. Скриншоты сохраняются в `artifacts/player-site/`.
