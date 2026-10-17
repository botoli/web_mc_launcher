#!/bin/sh
set -eu
node /app/scripts/docker/prepare.js
exec node /app/scripts/run.js start
