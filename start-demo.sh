#!/usr/bin/env bash
# Dudhwala local client demo (Linux/macOS). Starts: mock API :4010, storefront :3100, admin :3101 (127.0.0.1 only).
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is required. $2" >&2; exit 1; }; }
need node "Install Node.js 22 or newer from https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "ERROR: Node.js 22+ required (found $(node -v))" >&2; exit 1; }
if ! command -v pnpm >/dev/null 2>&1; then corepack enable 2>/dev/null || true; fi
need pnpm "Run: corepack enable   (or: npm install -g pnpm@9.15.9)"

export NEXT_PUBLIC_API_URL=/v1
export API_PROXY_TARGET=http://127.0.0.1:4010
export API_INTERNAL_URL=http://127.0.0.1:4010/v1
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_DEMO_BRANDING=1   # demo behaviours + About page + developer credit (demo build only; never set in production)
export NEXT_PUBLIC_DEMO_ADMIN_LOGIN='admin@demo.local / demo1234'          # shown on the admin login page (demo only)
export NEXT_PUBLIC_DEMO_MANAGER_LOGIN='manager@demo.local / manager1234'  # shown on the manager login page (demo only)
export npm_config_package_manager_strict=false   # tolerate a different pnpm 9/10 (e.g. from Nix)

if [ ! -d node_modules ]; then
  echo "== Installing dependencies (first run only, needs internet) =="
  pnpm install --frozen-lockfile --filter "@dudhwala/web..." --filter "@dudhwala/admin..."
fi
if [ ! -f apps/web/.next/BUILD_ID ] || [ ! -f apps/admin/.next/BUILD_ID ]; then
  echo "== Building storefront and admin (first run only, a few minutes) =="
  pnpm --filter @dudhwala/shared build
  NEXT_PUBLIC_PREVIEW_LABEL='ডেমো প্রিভিউ — পণ্যের নাম আসল তালিকা থেকে; দাম ও স্টক এখনো দেওয়া হয়নি। কোনো আসল অর্ডার বা টাকা নেওয়া হয় না।' pnpm --filter @dudhwala/web build
  NEXT_PUBLIC_STOREFRONT_URL=http://127.0.0.1:3100 NEXT_PUBLIC_PREVIEW_LABEL='অ্যাডমিন ডেমো — পরিবর্তনগুলো এই কম্পিউটারে সংরক্ষিত হয়, আসল ডেটাবেস নয়।' pnpm --filter @dudhwala/admin build
fi

# Each service runs in its own process group (job control), so stopping kills pnpm AND the node process it started.
set -m
pids=()
cleanup() {
  trap - EXIT INT TERM
  echo; echo "Stopping demo..."
  for p in "${pids[@]}"; do kill -TERM -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

node demo/mock-api/server.mjs & pids+=($!)
pnpm --filter @dudhwala/web exec next start -H 127.0.0.1 -p 3100 & pids+=($!)
pnpm --filter @dudhwala/admin exec next start -H 127.0.0.1 -p 3101 & pids+=($!)

for url in http://127.0.0.1:4010/v1/health/ready http://127.0.0.1:3100/ http://127.0.0.1:3101/login; do
  for _ in $(seq 1 60); do curl -fs -o /dev/null "$url" && break; sleep 1; done
done
cat <<MSG

 Dudhwala DEMO is running (real product names; no prices; demo orders only):
   Storefront : http://127.0.0.1:3100
   Admin      : http://127.0.0.1:3101        admin@demo.local / demo1234
   Manager    : http://127.0.0.1:3101/manager/login   manager@demo.local / manager1234 (view only)
   Mock API   : http://127.0.0.1:4010/v1/health/ready
 Press Ctrl+C to stop.
MSG
wait
