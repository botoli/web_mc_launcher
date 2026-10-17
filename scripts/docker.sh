#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
config=${MC_DOCKER_ENV:-$root/.env.docker}
if [ ! -f "$config" ]; then
    echo 'Сначала выполните: ./scripts/docker/init.sh http://NEW_IP:8080' >&2
    exit 1
fi
exec docker compose --project-name "${MC_DOCKER_PROJECT:-mc-launcher}" \
    --env-file "$config" -f "$root/compose.yaml" "$@"
