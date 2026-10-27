#!/usr/bin/env bash
# NixOS launcher: provides Node 22, pnpm and an FHS-style environment (steam-run) so the prebuilt native
# binaries inside node_modules (Next.js SWC, Tailwind) can run, then starts the normal demo script.
set -euo pipefail
cd "$(dirname "$0")"
if command -v nix-shell >/dev/null 2>&1; then
  exec nix-shell -p nodejs_22 pnpm steam-run curl --run "steam-run bash ./start-demo.sh"
elif command -v nix >/dev/null 2>&1; then
  exec nix --extra-experimental-features "nix-command flakes" shell nixpkgs#nodejs_22 nixpkgs#pnpm nixpkgs#steam-run nixpkgs#curl -c steam-run bash ./start-demo.sh
fi
echo "Nix not found; run ./start-demo.sh directly." >&2
exit 1
