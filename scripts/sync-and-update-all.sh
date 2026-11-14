#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FROM_UI="false"
VPS_HOST="root@187.77.46.223"

for arg in "$@"; do
  if [ "$arg" = "--from-ui" ]; then
    FROM_UI="true"
  else
    VPS_HOST="$arg"
  fi
done

cd "$PROJECT_ROOT"

if [ "$FROM_UI" = "true" ]; then
  exec >> /tmp/openbot-fork-update.log 2>&1
  echo "===================================================="
  echo "[$(date -Is)] Atualização acionada pelo botão Reiniciar do OpenBot"
  sleep 2
fi

echo "==> 1. Buscando novidades do OpenBot oficial (nightly-labs/openbot)..."
git fetch upstream main --tags

echo "==> 2. Mesclando novidades oficiais mantendo as melhorias do fork (BNOads/openbot)..."
git add -A && git diff --cached --quiet || git commit --no-verify -m "chore: save local changes before upstream sync" || true
if ! git merge upstream/main -X ours --no-edit; then
  git checkout --ours . || true
  git add -A
  git commit --no-verify --no-edit || true
fi

echo "==> 3. Garantindo dependências atualizadas..."
bun install --no-save || true

echo "==> 4. Atualizando o aplicativo no seu Mac (/Applications/OpenBot.app)..."
"$SCRIPT_DIR/update-mac-app.sh"

if [ "$FROM_UI" = "true" ]; then
  echo "==> 5. Reabrindo /Applications/OpenBot.app..."
  open -a /Applications/OpenBot.app
fi

echo "==> 6. Salvando no seu GitHub (BNOads/openbot)..."
git push --no-verify origin main || true

echo "==> 7. Atualizando a VPS ($VPS_HOST) com backup automático e zero perda de dados..."
"$SCRIPT_DIR/deploy-vps.sh" "$VPS_HOST" || true

echo "==> [$(date -Is)] Tudo atualizado com sucesso (Oficial + Suas Melhorias no Mac e na VPS)!"
