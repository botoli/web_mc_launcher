# play.nevermoreland.ru на 89.125.214.122

Для Ubuntu с уже работающими Nginx и `mc-launcher-server.service`. Команды ниже выполняются **на 89.125.214.122**, из `/opt/mc-launcher/web_mc_launcher`, после доставки актуальных файлов репозитория. Не используйте для этой задачи `deploy/nginx.conf`: он предназначен для другой установки на IP 87.58.220.248.

## Схема

- `launcher.nevermoreland.ru` сохраняет действующий административный virtual host.
- `play.nevermoreland.ru` обслуживается новым virtual host с явным списком публичных маршрутов. Главная `/` перенаправляет на `/play`; инструкции — `/play/how-to-play`, `/play/telegram`; скачивание — `/play/download`.
- Nginx передаёт эти запросы в существующий Next.js на `127.0.0.1:3001`. Второй Node.js-процесс, копия базы и отдельная установка приложения не нужны.
- `/play/download` запрашивает метаданные и архив у Express через внутренний `BACKEND_URL=http://127.0.0.1:3000`. Браузер остаётся на публичном домене.
- На `play` административные страницы и весь `/api` возвращают 404. На административных/IP virtual hosts `/play` закрывается отдельным include.

Это разделение HTTP-маршрутов в общей установке. Процессы и ресурсы сервера общие; административный домен по-прежнему имеет действующий сетевой доступ. VPN/IP-ограничения админки настраиваются отдельно.

## 1. Проверить приложение и DNS

```sh
cd /opt/mc-launcher/web_mc_launcher
curl -I http://127.0.0.1:3001/play
dig +short A play.nevermoreland.ru
dig +short AAAA play.nevermoreland.ru
```

Ожидаются 200 и A-запись `89.125.214.122`. AAAA публикуйте только для настроенного IPv6 этого сервера. На момент подготовки инструкции A уже указывает на нужный IP, AAAA отсутствует. Порты 80/443 должны принимать подключения; 3000/3001 остаются на loopback.

`PUBLIC_URL=https://launcher.nevermoreland.ru` и текущую службу оставьте как есть. Runner уже задаёт внутренний `BACKEND_URL`. Если `/play` ещё не включён в установленную сборку, сначала обновите исходники и production-сборку по действующей процедуре обновления. Не собирайте поверх каталога работающего production Next.js.

## 2. Подключить временный HTTP virtual host

Требуются Nginx, Certbot с webroot-плагином и права sudo. Файл `mc-player` должен быть новым для этой установки. Перед заменой уже существующего одноимённого файла сохраните его копию.

```sh
sudo install -d -m 755 /var/www/nevermoreland-play-acme
sudo install -m 644 deploy/nginx/player-site-http.conf /etc/nginx/sites-available/mc-player
sudo ln -s /etc/nginx/sites-available/mc-player /etc/nginx/sites-enabled/mc-player
sudo nginx -t && sudo systemctl reload nginx
```

При повторном запуске существующую правильную символическую ссылку создавать заново не нужно. Временная конфигурация обслуживает ACME challenge, остальные запросы на `play` получают 404. Она не меняет настройки административного домена и не требует остановки Nginx.

## 3. Выпустить сертификат и включить HTTPS

```sh
sudo certbot certonly --webroot -w /var/www/nevermoreland-play-acme --cert-name play.nevermoreland.ru -d play.nevermoreland.ru
sudo install -m 644 deploy/nginx/player-site.conf /etc/nginx/sites-available/mc-player
sudo nginx -t && sudo systemctl reload nginx
```

Certbot использует отдельный сертификат `play.nevermoreland.ru`; сертификат админки сохраняется. Если сертификат с этим именем уже существует, проверьте его через `sudo certbot certificates` и используйте существующий действующий сертификат.

Для продления:

```sh
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -m 755 deploy/renew-player-nginx.sh /etc/letsencrypt/renewal-hooks/deploy/mc-player-nginx.sh
sudo systemctl enable --now certbot.timer
sudo certbot renew --cert-name play.nevermoreland.ru --dry-run
```

Если на сервере уже используется собственное расписание или snap-версия Certbot, подключите сертификат к существующему механизму продления вместо создания параллельного. HTTP-путь ACME сохраняется и после включения HTTPS.

## 4. Закрыть страницы игрока на домене админки

```sh
sudo install -m 644 deploy/nginx/player-hide-on-admin.conf /etc/nginx/snippets/mc-player-hide-on-admin.conf
```

В существующие `server {}` админки и IP-сайта, которые проксируют приложение, добавьте:

```nginx
include /etc/nginx/snippets/mc-player-hide-on-admin.conf;
```

Добавлять include нужно **внутрь server**, рядом с существующими `location`. В конфигурации `play` его быть не должно. Если в старом конфиге уже есть `location /play`, объедините правила, чтобы избежать дублирования. Затем:

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Действующие конфигурации другого сервера из этого репозитория не заменяют реальную конфигурацию админки на 89.125.214.122. Сохраните её копию перед правками. При ошибке `nginx -t` перезагрузку не выполняйте; исправьте файл либо верните копию.

## 5. Проверить результат

```sh
curl -I https://play.nevermoreland.ru/
curl -I https://play.nevermoreland.ru/play
curl -I https://play.nevermoreland.ru/play/how-to-play
curl -I https://play.nevermoreland.ru/play/telegram
curl -I https://play.nevermoreland.ru/login
curl -I https://play.nevermoreland.ru/api/dashboard
curl -I https://launcher.nevermoreland.ru/play
curl -I https://launcher.nevermoreland.ru/login
```

Ожидается: `/` на `play` → 302 на `/play`, публичные страницы → 200, `/login` и `/api/dashboard` на `play` → 404, `/play` на админке → 404, вход в админку сохраняет прежнее поведение. Скачивание проверяйте в браузере: при наличии опубликованного файла он выдаётся с `play`, при недоступности возвращает на `/play` с сообщением. Переключение тем и шрифты должны работать.

Файлы статических ресурсов и фоновых изображений доступны через домен игрока; это публичные данные общей сборки. Доступа к административным страницам, действиям и данным через них нет.

Описание директив: [Nginx location](https://nginx.org/en/docs/http/ngx_http_core_module.html#location), [proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass). Получение сертификата без остановки сервера: [Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).
