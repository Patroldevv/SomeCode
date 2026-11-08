#!/usr/bin/env bash
# Builds the release tarball: the app (sources, built web UI) with its production dependencies, for this platform.
# usage: scripts/package.sh [outdir]   ->  <outdir>/somecode-linux-x64.tar.gz (+ .sha256)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/release}"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"; [ "$arch" = "x86_64" ] && arch=x64; [ "$arch" = "aarch64" ] && arch=arm64
name="somecode-$os-$arch"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

npm --prefix "$root" ci
npm --prefix "$root" run build -w apps/web

app="$stage/somecode"
mkdir -p "$app/apps/web" "$app/apps/server" "$app/packages" "$out"
cp "$root/package.json" "$root/package-lock.json" "$root/LICENSE" "$app/" 2>/dev/null || cp "$root/package.json" "$root/package-lock.json" "$app/"
cp -r "$root/bin" "$root/desktop" "$app/"
cp -r "$root/packages/protocol" "$app/packages/"
cp -r "$root/apps/server/src" "$root/apps/server/package.json" "$app/apps/server/"
cp -r "$root/apps/web/dist" "$app/apps/web/"
find "$app" -name '*.test.ts' -delete

# Production dependencies only, built for this platform (node-pty is native).
# The web UI is already built, so its libraries are not needed to run it (no package.json there = not a workspace).
(cd "$app" && npm install --omit=dev --no-audit --no-fund --package-lock-only=false)
echo "$(node -p "require('$root/package.json').version")" > "$app/VERSION"

tar -C "$stage" -czf "$out/$name.tar.gz" somecode
(cd "$out" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
echo "built $out/$name.tar.gz ($(du -h "$out/$name.tar.gz" | cut -f1))"
