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

if [ "$(id -u)" -eq 0 ]; then
  apps_dir="/usr/share/applications"; icon_dir="/usr/share/icons/hicolor/scalable/apps"
else
  apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; icon_dir="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
fi

if [ "$uninstall" -eq 1 ]; then
  rm -rf "$home_dir" "$bin_dir/somecode" "$apps_dir/somecode.desktop" "$icon_dir/somecode.svg"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" 2>/dev/null || true
  say "SomeCode removed (your chats in ~/.local/share/somecode-data or the app data folder are kept)."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "this installer is for Linux (got $(uname -s))"
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; *) die "only x86_64 builds are published for now (got $(uname -m))" ;; esac
need curl

# Installs system packages through whichever package manager there is (with sudo when not root). Best effort.
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo "$@"; else return 1; fi; }
pkg_install() {   # names: tar xz xdg desktop-utils build
  local pk=""; for what in "$@"; do
    if command -v apt-get >/dev/null 2>&1; then
      case "$what" in tar) pk="$pk tar";; xz) pk="$pk xz-utils";; xdg) pk="$pk xdg-utils";; desktop-utils) pk="$pk desktop-file-utils";; build) pk="$pk build-essential python3";; esac
    elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
      case "$what" in tar) pk="$pk tar";; xz) pk="$pk xz";; xdg) pk="$pk xdg-utils";; desktop-utils) pk="$pk desktop-file-utils";; build) pk="$pk gcc-c++ make python3";; esac
    elif command -v pacman >/dev/null 2>&1; then
      case "$what" in tar) pk="$pk tar";; xz) pk="$pk xz";; xdg) pk="$pk xdg-utils";; desktop-utils) pk="$pk desktop-file-utils";; build) pk="$pk base-devel python";; esac
    elif command -v zypper >/dev/null 2>&1; then
      case "$what" in tar) pk="$pk tar";; xz) pk="$pk xz";; xdg) pk="$pk xdg-utils";; desktop-utils) pk="$pk update-desktop-files";; build) pk="$pk gcc-c++ make python3";; esac
    fi
  done
  [ -n "$pk" ] || return 1
  say "Installing missing packages:$pk"
  if command -v apt-get >/dev/null 2>&1; then as_root apt-get install -y $pk
  elif command -v dnf >/dev/null 2>&1; then as_root dnf install -y $pk
  elif command -v yum >/dev/null 2>&1; then as_root yum install -y $pk
  elif command -v pacman >/dev/null 2>&1; then as_root pacman -S --needed --noconfirm $pk
  elif command -v zypper >/dev/null 2>&1; then as_root zypper --non-interactive install $pk; fi
}

command -v tar >/dev/null 2>&1 || pkg_install tar || die "'tar' is required"
command -v sha256sum >/dev/null 2>&1 || die "'sha256sum' (coreutils) is required"
# What the app uses to open its window and to show up in the application menu (optional, best effort).
command -v xdg-open >/dev/null 2>&1 || pkg_install xdg >/dev/null 2>&1 || true
command -v update-desktop-database >/dev/null 2>&1 || pkg_install desktop-utils >/dev/null 2>&1 || true

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
  command -v xz >/dev/null 2>&1 || pkg_install xz || die "'xz' is required to unpack Node"
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

# The terminal panel uses a native module built on a recent system. If it does not load here, build it for this computer.
if ! "$node_bin" -e "require('$home_dir/node_modules/node-pty')" >/dev/null 2>&1; then
  say "Preparing the terminal for this system"
  pty_ok=0
  if PATH="$(dirname "$node_bin"):$PATH" command -v npm >/dev/null 2>&1; then
    command -v g++ >/dev/null 2>&1 && command -v make >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 || pkg_install build || true
    if (cd "$home_dir" && PATH="$(dirname "$node_bin"):$PATH" npm rebuild node-pty --foreground-scripts >/dev/null 2>&1) && "$node_bin" -e "require('$home_dir/node_modules/node-pty')" >/dev/null 2>&1; then pty_ok=1; fi
  fi
  [ "$pty_ok" -eq 1 ] || echo "    Note: the built-in terminal could not be prepared on this system; everything else works."
fi
mkdir -p "$bin_dir"
cat > "$bin_dir/somecode" <<LAUNCH
#!/bin/sh
exec "$node_bin" "$home_dir/bin/somecode.ts" "\$@"
LAUNCH
chmod +x "$bin_dir/somecode"

# An entry for the application menu and desktop search, with an icon.
mkdir -p "$apps_dir" "$icon_dir"
cat > "$icon_dir/somecode.svg" <<'ICON'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#111111"/><path d="M48 38 22 64l26 26M80 38l26 26-26 26" fill="none" stroke="#f2f2f2" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M72 30 56 98" stroke="#8b8bff" stroke-width="8" stroke-linecap="round"/></svg>
ICON
cat > "$apps_dir/somecode.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SomeCode
GenericName=Coding agents
Comment=Work with Claude, OpenCode and Antigravity in one place
Exec=$bin_dir/somecode
Icon=somecode
Terminal=false
Categories=Development;IDE;
Keywords=code;agent;claude;ai;
StartupWMClass=SomeCode
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "${icon_dir%/hicolor/*}/hicolor" 2>/dev/null || true

say "SomeCode $(cat "$home_dir/VERSION" 2>/dev/null || echo '') is installed: $bin_dir/somecode"
case ":$PATH:" in *":$bin_dir:"*) ;; *) echo "    Add $bin_dir to your PATH:  export PATH=\"$bin_dir:\$PATH\"" ;; esac
echo "    Start it with:  somecode"
echo "    The agents (Claude, OpenCode, Antigravity) sign in with their own CLIs; see Settings > Agents."
