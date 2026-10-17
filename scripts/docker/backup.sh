#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose=$root/scripts/docker.sh
config=${MC_DOCKER_ENV:-$root/.env.docker}
output=${1:-$root/data/backups/docker-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}
if [ -e "$output" ]; then echo 'Файл назначения уже существует.' >&2; exit 1; fi
mkdir -p "$(dirname -- "$output")"
stage=$(mktemp -d)
running=$("$compose" ps --status running --services)
resume_app=false
resume_bot=false
# Match one service per line, including the first and last lines.
for service in $running; do
    case "$service" in app) resume_app=true;; bot) resume_bot=true;; esac
done
cleanup() {
    result=$?
    trap - EXIT
    if [ "$resume_app" = true ]; then "$compose" start app >&2 || result=1; fi
    if [ "$resume_bot" = true ]; then "$compose" start bot >&2 || result=1; fi
    rm -rf -- "$stage"
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$compose" stop bot app >&2
cp "$config" "$stage/config.env"
"$compose" exec -T db sh -ec 'exec pg_dump -U postgres -d "$APP_DB_NAME" --format=custom --no-owner --no-acl' > "$stage/database.dump"
"$compose" run --rm --no-deps -T --entrypoint tar tools -C /transfer -czf - data bot > "$stage/files.tar.gz"
printf '1\n' > "$stage/VERSION"
(cd "$stage" && sha256sum config.env database.dump files.tar.gz > SHA256SUMS)
tar -C "$stage" -czf "$output" VERSION SHA256SUMS config.env database.dump files.tar.gz
echo "$output"
