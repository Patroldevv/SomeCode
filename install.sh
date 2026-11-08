#!/usr/bin/env bash
# SomeCode installer.
#   curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | bash          # for you (~/.local)
#   curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | sudo bash     # for everyone (/usr/local)
# Options (after `bash -s --`): --version vX.Y.Z   --prefix DIR   --uninstall
set -euo pipefail

REPO="Patroldevv/SomeCode"
NODE_MAJOR=26
version="latest"; prefix=""; uninstall=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="$2"; shift 2 ;;
    --prefix) prefix="$2"; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n 2,6p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'somecode install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is required"; }

if [ "$(id -u)" -eq 0 ]; then
  home_dir="${prefix:-/usr/local/lib/somecode}"; bin_dir="/usr/local/bin"
else
  home_dir="${prefix:-${XDG_DATA_HOME:-$HOME/.local/share}/somecode}"; bin_dir="$HOME/.local/bin"
fi

if [ "$uninstall" -eq 1 ]; then
  rm -rf "$home_dir" "$bin_dir/somecode"
  say "SomeCode removed (your chats in ~/.local/share/somecode-data or the app data folder are kept)."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "this installer is for Linux (got $(uname -s))"
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; *) die "only x86_64 builds are published for now (got $(uname -m))" ;; esac
need curl; need tar; need sha256sum

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
asset="somecode-linux-$arch.tar.gz"
if [ -n "${SOMECODE_TARBALL:-}" ]; then
  cp "$SOMECODE_TARBALL" "$tmp/$asset"                       # for testing a local build
else
  if [ "$version" = "latest" ]; then base="https://github.com/$REPO/releases/latest/download"
  else base="https://github.com/$REPO/releases/download/$version"; fi
  say "Downloading $asset ($version)"
  curl -fSL --progress-bar "$base/$asset" -o "$tmp/$asset" || die "download failed: $base/$asset"
  curl -fsSL "$base/$asset.sha256" -o "$tmp/$asset.sha256" || die "checksum download failed"
  (cd "$tmp" && sha256sum -c "$asset.sha256" >/dev/null) || die "checksum mismatch, nothing was installed"
fi

# SomeCode needs Node $NODE_MAJOR or newer. Use the one on the machine, else fetch Node's own build into the install folder.
node_bin=""
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; then
  node_bin="$(command -v node)"
fi

say "Installing into $home_dir"
rm -rf "$home_dir.new"; mkdir -p "$home_dir.new"
tar -xzf "$tmp/$asset" -C "$home_dir.new" --strip-components=1

if [ -z "$node_bin" ]; then
  say "Node $NODE_MAJOR+ not found, fetching it (official build from nodejs.org)"
  idx="$(curl -fsSL https://nodejs.org/dist/index.json)" || die "could not reach nodejs.org"
  nv="$(printf '%s' "$idx" | tr '{' '\n' | grep -o "\"version\":\"v$NODE_MAJOR\.[0-9.]*\"" | head -1 | cut -d'"' -f4)"
  [ -n "$nv" ] || die "no Node $NODE_MAJOR release found"
  nf="node-$nv-linux-$arch.tar.xz"
  curl -fSL --progress-bar "https://nodejs.org/dist/$nv/$nf" -o "$tmp/$nf"
  curl -fsSL "https://nodejs.org/dist/$nv/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " $nf\$" SHASUMS256.txt | sha256sum -c >/dev/null) || die "Node checksum mismatch"
  mkdir -p "$home_dir.new/node"; tar -xJf "$tmp/$nf" -C "$home_dir.new/node" --strip-components=1
  node_bin="$home_dir/node/bin/node"
fi

rm -rf "$home_dir"; mv "$home_dir.new" "$home_dir"
mkdir -p "$bin_dir"
cat > "$bin_dir/somecode" <<LAUNCH
#!/bin/sh
exec "$node_bin" "$home_dir/bin/somecode.ts" "\$@"
LAUNCH
chmod +x "$bin_dir/somecode"

say "SomeCode $(cat "$home_dir/VERSION" 2>/dev/null || echo '') is installed: $bin_dir/somecode"
case ":$PATH:" in *":$bin_dir:"*) ;; *) echo "    Add $bin_dir to your PATH:  export PATH=\"$bin_dir:\$PATH\"" ;; esac
echo "    Start it with:  somecode"
echo "    The agents (Claude, OpenCode, Antigravity) sign in with their own CLIs; see Settings > Agents."
