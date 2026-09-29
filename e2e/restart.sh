#!/bin/sh
# Rebuild and restart the app on :3100 against the dev database (used by local E2E runs).
(fuser -k 3100/tcp || true) 2>/dev/null; sleep 1
export DATABASE_URL=${DATABASE_URL:-postgres://postgres@localhost:5433/samakose_dev}
npx next build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
NODE_ENV=production SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret-0123 APP_URL=http://localhost:3100 AI_MODE=mock STORAGE_DIR=/tmp/e2e-storage TRUST_PROXY=0 MFA_REQUIRED_ROLES= nohup npx next start -p 3100 > /tmp/next.log 2>&1 &
sleep 6; curl -s localhost:3100/api/v1/health; echo
