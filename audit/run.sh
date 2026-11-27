#!/usr/bin/env bash
# Auditoria completa: sobe um mock do Mercado Livre/Anthropic (porta 4200) e a aplicação (porta 4100)
# com banco novo, roda a auditoria de API e a auditoria de interface (Playwright).
# Uso: AUDIT_FILES=/pasta/com/relatorios bash audit/run.sh   (AUDIT_FILES é opcional)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; OUT="$HERE/out"
for port in 4100 4200; do
  if curl -s -o /dev/null "localhost:$port"; then echo "Porta $port já está em uso: encerre o processo antes da auditoria." >&2; exit 2; fi
done
rm -rf "$OUT/data"; mkdir -p "$OUT/data"
npm --prefix "$ROOT/web" run build >/dev/null
node "$HERE/mock.cjs" > "$OUT/mock.log" 2>&1 & MOCK=$!
( cd "$ROOT/server" && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 DATA_DIR="$OUT/data" PORT=4100 APP_URL=http://localhost:4100 \
  ML_CLIENT_ID=AUDIT-CLIENT ML_CLIENT_SECRET=AUDIT-SECRET ML_REDIRECT_URI=http://localhost:4100/api/ml/oauth/callback \
  ML_AUTH_HOST=http://localhost:4200 ML_API_BASE=http://localhost:4200 ML_MIN_INTERVAL_MS=0 \
  ANTHROPIC_API_KEY=audit-key ANTHROPIC_BASE_URL=http://localhost:4200 \
  node --disable-warning=ExperimentalWarning src/index.ts > "$OUT/server.log" 2>&1 ) & APP=$!
trap 'kill $MOCK $APP 2>/dev/null; pkill -P $APP 2>/dev/null' EXIT
for i in $(seq 1 30); do curl -sf localhost:4100/api/health >/dev/null && break; sleep 0.5; done
NO_PROXY=localhost node "$HERE/audit.mjs"; A=$?
NODE_PATH="${NODE_PATH:-$(npm root -g)}" node "$HERE/ui.cjs"; U=$?
exit $((A + U))
