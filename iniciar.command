#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  (umask 077; { echo "DB_PASSWORD=$(openssl rand -hex 24)"; echo "SESSION_SECRET=$(openssl rand -hex 32)"; echo "INTERNAL_KEY=$(openssl rand -hex 32)"; echo "STAFF_CODE=demo-local"; } > .env)
fi
docker info >/dev/null 2>&1 || docker desktop start
docker compose up -d --build
echo "Central de Atendimento: http://localhost:${HELPDESK_PORT:-4380} · código da equipe: veja STAFF_CODE em .env"
