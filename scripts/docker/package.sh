#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output=${1:-$root/data/backups/mc-launcher-docker.tar.gz}
if [ -e "$output" ]; then echo 'Файл назначения уже существует.' >&2; exit 1; fi
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$stage/mc-launcher/scripts/docker" "$stage/mc-launcher/deploy/docker" "$(dirname -- "$output")"
"$root/scripts/docker.sh" build app
"$root/scripts/docker.sh" pull db proxy
docker image save --output "$stage/mc-launcher/images.tar" "${LAUNCHER_IMAGE:-mc-launcher:local}" postgres:16-bookworm caddy:2-alpine
cp -p "$root/compose.yaml" "$stage/mc-launcher/"
cp -p "$root/scripts/docker.sh" "$stage/mc-launcher/scripts/"
for file in init.sh backup.sh restore.sh; do
    cp -p "$root/scripts/docker/$file" "$stage/mc-launcher/scripts/docker/"
done
cp -p "$root/deploy/docker/Caddyfile" "$root/deploy/docker/init-db.sh" "$stage/mc-launcher/deploy/docker/"
cp -p "$root/deploy/docker/install.sh" "$stage/mc-launcher/install.sh"
cp -p "$root/docs/docker.md" "$stage/mc-launcher/README.md"
tar -C "$stage" -czf "$output" mc-launcher
echo "$output"
