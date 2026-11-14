#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_PATH="${1:-/Applications/OpenBot.app}"

echo "==> 1. Compilando OpenBot local..."
cd "$PROJECT_ROOT"
bun run build

echo "==> 2. Gerando app.asar atualizado..."
mkdir -p "$PROJECT_ROOT/dist"
cat "$APP_PATH/Contents/Resources/app.asar" > "$PROJECT_ROOT/dist/app.asar"
OUT_JSON="$(bun "$PROJECT_ROOT/scripts/update-asar-out.mjs" "$PROJECT_ROOT/dist/app.asar" "$PROJECT_ROOT/out" "$APP_PATH/Contents/Resources/app.asar.unpacked")"
echo "$OUT_JSON"
NEW_HASH="$(echo "$OUT_JSON" | sed -E 's/.*"headerSha256":"([^"]+)".*/\1/')"

echo "==> 3. Aplicando no $APP_PATH (backup em $PROJECT_ROOT/dist/app.asar.orig.bak)..."
if [ ! -f "$PROJECT_ROOT/dist/app.asar.orig.bak" ]; then
  cat "$APP_PATH/Contents/Resources/app.asar" > "$PROJECT_ROOT/dist/app.asar.orig.bak"
fi
cat "$PROJECT_ROOT/dist/app.asar" > "$APP_PATH/Contents/Resources/app.asar"
plutil -replace ElectronAsarIntegrity.Resources/app\\.asar.hash -string "$NEW_HASH" "$APP_PATH/Contents/Info.plist"
codesign --force --deep --sign - "$APP_PATH"

echo "==> $APP_PATH atualizado com sucesso!"
