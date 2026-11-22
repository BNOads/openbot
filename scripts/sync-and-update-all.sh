#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FROM_UI="false"
VPS_HOST="root@187.77.46.223"
REOPENED="false"
UPDATE_OK="false"

for arg in "$@"; do
  if [ "$arg" = "--from-ui" ]; then
    FROM_UI="true"
  else
    VPS_HOST="$arg"
  fi
done

notify() {
  if [ "$FROM_UI" = "true" ]; then
    osascript -e "display notification \"$1\" with title \"OpenBot Atualizador\"" >/dev/null 2>&1 || true
  fi
}

cleanup_on_exit() {
  local exit_code=$?
  if [ "$FROM_UI" = "true" ]; then
    if [ "$REOPENED" != "true" ]; then
      echo "==> Reabrindo /Applications/OpenBot.app após saída (código $exit_code)..."
      open -a /Applications/OpenBot.app >/dev/null 2>&1 || true
      REOPENED="true"
    fi
    if [ "$UPDATE_OK" != "true" ] && [ "$exit_code" -ne 0 ]; then
      notify "Falha ao atualizar. Veja /tmp/openbot-fork-update.log"
    fi
  fi
}
trap cleanup_on_exit EXIT

cd "$PROJECT_ROOT"

if [ "$FROM_UI" = "true" ]; then
  exec >> /tmp/openbot-fork-update.log 2>&1
  echo "===================================================="
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] Atualização acionada pelo botão Reiniciar do OpenBot"
  notify "Atualizando OpenBot (oficial + suas melhorias)..."
  sleep 2
fi

ssh-add --apple-load-keychain >/dev/null 2>&1 || true
PRE_MERGE_HEAD="$(git rev-parse HEAD)"

echo "==> 1. Buscando novidades do OpenBot oficial (nightly-labs/openbot)..."
git fetch upstream main --tags || true

echo "==> 2. Mesclando novidades oficiais mantendo as melhorias do fork (BNOads/openbot)..."
git add -A && git diff --cached --quiet || git commit --no-verify -m "chore: save local changes before upstream sync" || true
if ! git merge upstream/main -X ours --no-edit; then
  git checkout --ours . || true
  git add -A
  git commit --no-verify --no-edit || true
fi
# Garante que a versão de package.json acompanhe o upstream após o merge (-X ours pode reter versão antiga)
UPSTREAM_VERSION="$(git show upstream/main:package.json 2>/dev/null | node -e 'try { console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).version || "") } catch {}' || true)"
LOCAL_VERSION="$(node -e 'console.log(require("./package.json").version || "")' 2>/dev/null || true)"
if [ -n "$UPSTREAM_VERSION" ] && [ "$UPSTREAM_VERSION" != "$LOCAL_VERSION" ]; then
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");' "$UPSTREAM_VERSION"
  git add package.json && git commit --no-verify -m "chore: sync version $UPSTREAM_VERSION from upstream" || true
fi

echo "==> 3. Garantindo dependências atualizadas..."
bun install --no-save || true

echo "==> 4. Verificando e atualizando o aplicativo no Mac (/Applications/OpenBot.app)..."
if ! "$SCRIPT_DIR/update-mac-app.sh"; then
  echo "!! Compilação falhou após merge; restaurando commit anterior seguro ($PRE_MERGE_HEAD)..."
  git merge --abort >/dev/null 2>&1 || true
  git reset --hard "$PRE_MERGE_HEAD"
  "$SCRIPT_DIR/update-mac-app.sh"
  if [ "$FROM_UI" = "true" ]; then
    open -a /Applications/OpenBot.app
    REOPENED="true"
  fi
  exit 1
fi

if [ "$FROM_UI" = "true" ]; then
  notify "Mac compilado! Atualizando GitHub e VPS antes de reabrir..."
fi

echo "==> 5. Salvando no seu GitHub (BNOads/openbot)..."
git push --no-verify origin main || true

echo "==> 6. Atualizando a VPS ($VPS_HOST) com backup automático e zero perda de dados..."
VPS_OK="true"
if ! "$SCRIPT_DIR/deploy-vps.sh" "$VPS_HOST"; then
  VPS_OK="false"
  echo "!! Falha ao atualizar a VPS ($VPS_HOST); verifique os logs."
fi

if [ "$FROM_UI" = "true" ]; then
  echo "==> 7. Reabrindo /Applications/OpenBot.app..."
  open -a /Applications/OpenBot.app
  REOPENED="true"
fi

if [ "$VPS_OK" = "true" ]; then
  UPDATE_OK="true"
  notify "OpenBot atualizado no Mac e na VPS com sucesso!"
  echo "==> [$(date '+%Y-%m-%dT%H:%M:%S%z')] Tudo atualizado com sucesso (Oficial + Suas Melhorias no Mac e na VPS)!"
else
  notify "Mac atualizado! Falha ao atualizar a VPS (veja /tmp/openbot-fork-update.log)."
  echo "==> [$(date '+%Y-%m-%dT%H:%M:%S%z')] Mac atualizado, mas houve falha na VPS."
  exit 1
fi
