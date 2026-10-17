#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root"
url=${1:?Запуск: ./install.sh http://NEW_IP:8080 [migration.tar.gz]}
docker compose version >/dev/null
docker image load --input "$root/images.tar"
if [ -n "${2:-}" ]; then
    "$root/scripts/docker/restore.sh" "$2" "$url"
else
    "$root/scripts/docker/init.sh" "$url"
fi
exec "$root/scripts/docker.sh" up -d --wait --wait-timeout 180
