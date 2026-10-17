#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose=$root/scripts/docker.sh
config=${MC_DOCKER_ENV:-$root/.env.docker}
archive=${1:?Укажите архив: restore.sh backup.tar.gz [https://new-domain]}
if [ -e "$config" ]; then echo "$config уже существует. Восстанавливайте на чистой установке, чтобы сохранить текущие данные." >&2; exit 1; fi
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Extract only the fixed members produced by our backup tools.
tar -xzf "$archive" -C "$stage" --no-same-owner --no-same-permissions --keep-old-files \
    VERSION SHA256SUMS config.env database.dump files.tar.gz
for file in VERSION SHA256SUMS config.env database.dump files.tar.gz; do
    if [ ! -f "$stage/$file" ] || [ -L "$stage/$file" ]; then echo 'Неверный формат архива.' >&2; exit 1; fi
done
if [ "$(cat "$stage/VERSION")" != 1 ]; then echo 'Неподдерживаемая версия архива.' >&2; exit 1; fi
(cd "$stage" && sha256sum -c SHA256SUMS)
cp "$stage/config.env" "$config"
chmod 600 "$config"
# Enable the bot explicitly at cutover, after the old worker has stopped.
sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' "$config"
if [ -n "${2:-}" ]; then "$root/scripts/docker/init.sh" "$2" --update-url; fi
"$compose" up -d --wait db
count=$("$compose" exec -T db sh -ec 'psql -U postgres -d "$APP_DB_NAME" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('\''pg_catalog'\'', '\''information_schema'\'')"')
if [ "$count" != 0 ]; then echo 'Целевая база не пуста. Восстановление отменено.' >&2; exit 1; fi
"$compose" run --rm --no-deps -T tools -ec 'test -z "$(find /transfer -type f -print -quit)"' \
    || { echo 'Целевые файловые тома не пусты. Восстановление отменено.' >&2; exit 1; }
"$compose" exec -T db sh -ec 'exec pg_restore -U "$APP_DB_USER" -d "$APP_DB_NAME" --no-owner --no-acl --exit-on-error --single-transaction' < "$stage/database.dump"
"$compose" run --rm --no-deps -T --entrypoint tar tools -C /transfer --no-same-owner -xzf - < "$stage/files.tar.gz"
"$compose" run --rm --no-deps -T tools -ec 'chown -R 1000:1000 /transfer/data /transfer/bot'
echo 'База и файлы восстановлены. Запуск: ./scripts/docker.sh up -d --build --wait'
