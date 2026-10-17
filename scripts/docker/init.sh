#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
config=${MC_DOCKER_ENV:-$root/.env.docker}
url=${1:-http://localhost:8080}
case "$url" in
    https://*)
        site=${url#https://}
        case "$site" in ''|*[!a-zA-Z0-9.-]*|.*|-*) echo 'Для HTTPS укажите домен без пути: https://launcher.example.com' >&2; exit 1;; esac
        http_port=80
        ;;
    http://*)
        address=${url#http://}
        case "$address" in ''|*[!a-zA-Z0-9.:-]*) echo 'Укажите HTTP-адрес без пути: http://NEW_IP:8080' >&2; exit 1;; esac
        case "$address" in *:*) http_port=${address##*:};; *) http_port=80;; esac
        case "$http_port" in ''|*[!0-9]*) echo 'Некорректный порт' >&2; exit 1;; esac
        if [ "$http_port" -lt 1 ] || [ "$http_port" -gt 65535 ]; then echo 'Некорректный порт' >&2; exit 1; fi
        site=:80
        ;;
    *) echo 'Укажите http://NEW_IP:8080 или https://launcher.example.com' >&2; exit 1;;
esac
if [ -e "$config" ]; then
    if [ "${2:-}" = '--update-url' ]; then
        sed -i -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$url|" \
            -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$site|" \
            -e "s|^HTTP_PORT=.*|HTTP_PORT=$http_port|" "$config"
        echo 'Публичный адрес обновлён; пароли и секреты сохранены.'
    else echo "$config уже существует; сохранён без изменений."; fi
    exit 0
fi
random() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
# noclobber also protects against two concurrent setup commands.
set -C
cat > "$config" <<EOF
PUBLIC_URL=$url
SITE_ADDRESS=$site
HTTP_PORT=$http_port
TLS_PORT=443
PGDATABASE=mc_launcher
PGUSER=mc_launcher
PGPASSWORD=$(random)
POSTGRES_ADMIN_PASSWORD=$(random)
JWT_SECRET=$(random)
TELEGRAM_BOT_SECRET=$(random)
PLAYER_EVENTS_SECRET=$(random)
# Set the token and COMPOSE_PROFILES=bot to enable the single Telegram worker.
TELEGRAM_BOT_TOKEN=
COMPOSE_PROFILES=
EOF
echo "Создан $config. Запуск: ./scripts/docker.sh up -d --build"
