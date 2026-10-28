#!/usr/bin/env bash
# Post-deploy smoke test (DEPLOYMENT_RUNBOOK §9). Read-only: places no orders.
# Usage: infra/ops/smoke.sh https://api.example.com https://example.com https://admin.example.com
set -uo pipefail
API="${1:?API base URL (no /v1)}"; WEB="${2:?storefront URL}"; ADMIN="${3:?admin URL}"
fail=0
check() { # name, command
  if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi
}
hdr() { curl -sSI --max-time 15 "$1" | tr -d '\r' | grep -qi "^$2"; }
# A route that is not registered at all answers with Nest's "Cannot GET" message.
unregistered() { curl -s --max-time 15 "$1" | grep -q 'Cannot GET'; }

check "API ready"                         "curl -fs --max-time 15 $API/v1/health/ready | grep -q '\"ok\"'"
check "API catalogue answers"             "curl -fs --max-time 15 '$API/v1/catalog/products?limit=1' | grep -q '\"data\"'"
check "API refuses admin without login"   "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $API/v1/admin/outlets)\" = 401 ]"
check "API sends no-store on private data" "hdr $API/v1/me 'cache-control: no-store'"
check "API HSTS header (production)"      "hdr $API/v1/health/live 'strict-transport-security'"
check "Storefront home is Bangla"         "curl -fs --max-time 20 $WEB/ | grep -q '<html lang=\"bn\"'"
check "Storefront CSP header"             "hdr $WEB/ 'content-security-policy'"
check "Storefront frame protection"       "hdr $WEB/ 'x-frame-options: deny'"
check "Admin login page"                  "curl -fs --max-time 20 $ADMIN/login | grep -q 'html'"
check "Admin frame protection"            "hdr $ADMIN/login 'x-frame-options: deny'"
check "HTTP redirects to HTTPS"           "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \"\${WEB/https:/http:}/\")\" -ge 301 ]"
check "Dev SMS outbox is not exposed"     "unregistered '$API/v1/dev/sms?phone=01700000000'"
check "Payment sandbox refuses anonymous"  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST $API/v1/payments/sandbox/x/complete)\" -ge 401 ]"
exit $fail
