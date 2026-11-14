#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VPS_HOST="${1:-root@187.77.46.223}"

echo "==> 1. Compilando OpenBot (BNOads/openbot)..."
cd "$PROJECT_ROOT"
bun run build

echo "==> 2. Empacotando build customizado..."
tar -czf /tmp/openbot-out.tar.gz out scripts/update-asar-out.mjs

echo "==> 3. Criando backup seguro no VPS ($VPS_HOST) antes de atualizar..."
STAMP="$(date +%Y-%m-%d-%H%M)"
ssh -o BatchMode=yes "$VPS_HOST" "mkdir -p /opt/openbot/custom-build && docker exec -u root openbot sh -c 'mkdir -p /data/backups && cp -a /data/.config/OpenBot/openbot.db /data/backups/openbot.db.bak-$STAMP && cp -a /opt/OpenBot/app/resources/app.asar /data/backups/app.asar.bak-$STAMP'"

echo "==> 4. Enviando e aplicando build no container openbot ($VPS_HOST)..."
scp -q /tmp/openbot-out.tar.gz "$VPS_HOST:/opt/openbot/custom-build/openbot-out.tar.gz"
ssh -o BatchMode=yes "$VPS_HOST" "cd /opt/openbot/custom-build && tar -xzf openbot-out.tar.gz && /opt/openbot/auto-update.sh || (docker cp /opt/openbot/custom-build/out openbot:/tmp/custom-out && docker cp /opt/openbot/custom-build/scripts/update-asar-out.mjs openbot:/tmp/update-asar-out.mjs && docker exec -u root openbot node /tmp/update-asar-out.mjs /opt/OpenBot/app/resources/app.asar /tmp/custom-out /opt/OpenBot/app/resources/app.asar.unpacked && docker exec -u root openbot rm -rf /tmp/custom-out /tmp/update-asar-out.mjs && docker restart openbot)"

echo "==> Deploy concluído com sucesso em $VPS_HOST (zero perda de dados)!"
