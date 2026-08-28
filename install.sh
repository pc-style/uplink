#!/usr/bin/env bash
set -euo pipefail

REPO="pc-style/uplink"
REF="${UPLINK_REF:-main}"
YES=0
INSTALL_DIR="${UPLINK_INSTALL_DIR:-${BUN_INSTALL:-$HOME/.bun}/bin}"

usage() {
  cat <<'EOF'
Install the up!link CLI globally for the current user.

Usage: install.sh [--yes] [--install-dir <path>] [--help]

Options:
  -y, --yes                 Skip the confirmation prompt
      --install-dir <path>  Install directory (default: $BUN_INSTALL/bin or ~/.bun/bin)
  -h, --help                Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES=1
      shift
      ;;
    --install-dir)
      [[ $# -ge 2 ]] || { printf 'error: --install-dir requires a path\n' >&2; exit 1; }
      INSTALL_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

info() {
  if command -v gum >/dev/null 2>&1 && [[ -t 1 ]]; then
    gum log --level info "$*"
  else
    printf 'info: %s\n' "$*"
  fi
}

fail() {
  if command -v gum >/dev/null 2>&1 && [[ -t 1 ]]; then
    gum log --level error "$*" >&2
  else
    printf 'error: %s\n' "$*" >&2
  fi
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

confirm_install() {
  [[ "$YES" == "1" ]] && return 0

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    if command -v gum >/dev/null 2>&1; then
      gum confirm "Build up!link from GitHub and install it to $INSTALL_DIR/uplink?" </dev/tty >/dev/tty || exit 0
      return 0
    fi

    local answer
    printf 'Build up!link from GitHub and install it to %s/uplink? [y/N] ' "$INSTALL_DIR" >/dev/tty
    IFS= read -r answer </dev/tty
    [[ "$answer" =~ ^[Yy]$ ]] || exit 0
    return 0
  fi

  fail "Non-interactive installation requires --yes"
}

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) fail "Unsupported operating system: $(uname -s)" ;;
esac

require_cmd bun
require_cmd curl
require_cmd tar

confirm_install

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

archive="$tmp_dir/uplink.tar.gz"
source_dir="$tmp_dir/uplink-$REF"

info "Downloading $REPO@$REF"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$REF.tar.gz" -o "$archive"
tar -xzf "$archive" -C "$tmp_dir"
[[ -d "$source_dir/cli" ]] || fail "Downloaded archive does not contain the up!link CLI"

if command -v gum >/dev/null 2>&1 && [[ -t 1 ]]; then
  gum spin --title "Building up!link CLI..." --show-output -- \
    bash -c 'bun install --cwd "$1" && bun run --cwd "$1" build' _ "$source_dir/cli"
else
  info "Building up!link CLI"
  bun install --cwd "$source_dir/cli"
  bun run --cwd "$source_dir/cli" build
fi

mkdir -p "$INSTALL_DIR"
install -m 0755 "$source_dir/cli/uplink" "$INSTALL_DIR/uplink"

if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
  info "Add $INSTALL_DIR to PATH to run uplink without its full path"
fi

info "Installed up!link CLI to $INSTALL_DIR/uplink"
"$INSTALL_DIR/uplink" --version
printf '\nNext: uplink auth set --key <api-key>   (add --server <url> for keys without the uplink_ prefix)\n'
