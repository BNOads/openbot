#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VPS_HOST="${1:-root@187.77.46.223}"

echo "==> 1. Compilando OpenBot (BNOads/openbot)..."
cd "$PROJECT_ROOT"
bun run build

echo "==> 2. Empacotando build customizado e dependências ausentes..."
STAGE_DIR="/tmp/openbot-custom-stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp -R out "$STAGE_DIR/out"
cp package.json "$STAGE_DIR/package.json"
mkdir -p "$STAGE_DIR/scripts"
cp scripts/update-asar-out.mjs "$STAGE_DIR/scripts/update-asar-out.mjs"
cp scripts/update-asar-out.py "$STAGE_DIR/scripts/update-asar-out.py"
node "$SCRIPT_DIR/stage-missing-asar-deps.mjs" "$PROJECT_ROOT" "$STAGE_DIR/node_modules_extra" "$PROJECT_ROOT/dist/app.asar.orig.bak"
xattr -cr "$STAGE_DIR" 2>/dev/null || true
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf /tmp/openbot-out.tar.gz -C "$STAGE_DIR" out package.json scripts/update-asar-out.mjs scripts/update-asar-out.py node_modules_extra 2>/dev/null || COPYFILE_DISABLE=1 tar -czf /tmp/openbot-out.tar.gz -C "$STAGE_DIR" out package.json scripts/update-asar-out.mjs scripts/update-asar-out.py node_modules_extra

echo "==> 3. Criando backup seguro no VPS ($VPS_HOST) antes de atualizar..."
STAMP="$(date +%Y-%m-%d-%H%M)"
ssh-add --apple-load-keychain >/dev/null 2>&1 || true
ssh -o BatchMode=yes "$VPS_HOST" "mkdir -p /opt/openbot/custom-build && docker stop -t 15 openbot >/dev/null 2>&1 || true && docker cp openbot:/opt/OpenBot/app/resources/app.asar /opt/openbot/custom-build/app.asar && cp -a /opt/openbot/custom-build/app.asar /opt/openbot/custom-build/app.asar.bak-$STAMP && docker run --rm -u root --entrypoint sh -v openbot_openbot-data:/data ghcr.io/nightly-labs/openbot:latest -c 'mkdir -p /data/backups && cp -a /data/.config/OpenBot/openbot.db /data/backups/openbot.db.bak-$STAMP'"

echo "==> 4. Aplicando build + dependências no app.asar do VPS ($VPS_HOST)..."
scp -q /tmp/openbot-out.tar.gz "$VPS_HOST:/opt/openbot/custom-build/openbot-out.tar.gz"
ssh -o BatchMode=yes "$VPS_HOST" "cd /opt/openbot/custom-build && rm -rf out package.json node_modules_extra unpacked_out ._node_modules_extra ._out && tar -xzf openbot-out.tar.gz && python3 /opt/openbot/custom-build/scripts/update-asar-out.py /opt/openbot/custom-build/app.asar /opt/openbot/custom-build/out /opt/openbot/custom-build/unpacked_out /opt/openbot/custom-build/node_modules_extra && docker cp /opt/openbot/custom-build/app.asar openbot:/opt/OpenBot/app/resources/app.asar && docker cp /opt/openbot/custom-build/unpacked_out/out/. openbot:/opt/OpenBot/app/resources/app.asar.unpacked/out/ && docker start openbot"

echo "==> 5. Verificando saúde do container openbot ($VPS_HOST)..."
ssh -o BatchMode=yes "$VPS_HOST" "sleep 12 && docker ps --filter name=openbot --format '{{.Names}} {{.Status}}' && docker logs --tail 10 openbot"
echo "==> Deploy concluído com sucesso em $VPS_HOST (zero perda de dados)!"
