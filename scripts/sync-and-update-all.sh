#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VPS_HOST="${1:-root@187.77.46.223}"

cd "$PROJECT_ROOT"

echo "==> 1. Buscando novidades do OpenBot oficial (nightly-labs/openbot)..."
git fetch upstream main

echo "==> 2. Mesclando novidades oficiais com as melhorias do seu fork (BNOads/openbot)..."
git merge upstream/main --no-edit

echo "==> 3. Salvando no seu GitHub (BNOads/openbot)..."
git push --no-verify origin main

echo "==> 4. Atualizando o aplicativo no seu Mac (/Applications/OpenBot.app)..."
"$SCRIPT_DIR/update-mac-app.sh"

echo "==> 5. Atualizando a VPS ($VPS_HOST) com backup automático e zero perda de dados..."
"$SCRIPT_DIR/deploy-vps.sh" "$VPS_HOST"

echo "==> Tudo atualizado (Oficial + Suas Melhorias no Mac e na VPS)!"
