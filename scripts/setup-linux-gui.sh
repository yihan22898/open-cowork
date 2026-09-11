#!/usr/bin/env bash
# scripts/setup-linux-gui.sh
#
# Install the system packages Open Cowork needs for Linux GUI automation
# (click / type / key / screenshot). Detects distro + display server and
# picks the right package set. Idempotent: re-running skips already-installed
# packages and only fixes missing pieces.
#
# Usage:
#   ./scripts/setup-linux-gui.sh             # auto-detect everything
#   ./scripts/setup-linux-gui.sh --check     # dry-run; report missing tools only
#
# Exit codes:
#   0 - all required tools present (or successfully installed)
#   1 - install failed (network, permissions, unsupported distro)
#   2 - check mode found missing tools (with --check)

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { printf '\033[1;34m[setup-linux-gui]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup-linux-gui]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[setup-linux-gui]\033[0m %s\n' "$*" >&2; }
die()  { err "$@"; exit 1; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      SUDO="sudo"
    else
      die "This script needs root to install packages. Re-run with sudo or as root."
    fi
  else
    SUDO=""
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# ── detection ────────────────────────────────────────────────────────────────
detect_distro() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
    DISTRO_LIKE="${ID_LIKE:-}"
  else
    DISTRO_ID="unknown"
    DISTRO_LIKE=""
  fi

  case "$DISTRO_ID" in
    ubuntu|debian|linuxmint|pop|elementary|zorin|kali|raspbian)
      PKG_MGR="apt" ;;
    fedora|rhel|centos|rocky|almalinux|amazon)
      PKG_MGR="dnf" ;;
    arch|manjaro|endeavouros|garuda)
      PKG_MGR="pacman" ;;
    opensuse*|sles)
      PKG_MGR="zypper" ;;
    *)
      # Fall back to ID_LIKE
      case "$DISTRO_LIKE" in
        *debian*|*ubuntu*) PKG_MGR="apt" ;;
        *fedora*|*rhel*)   PKG_MGR="dnf" ;;
        *arch*)            PKG_MGR="pacman" ;;
        *suse*)            PKG_MGR="zypper" ;;
        *) PKG_MGR="unknown" ;;
      esac
      ;;
  esac

  log "Detected distro: $DISTRO_ID (package manager: $PKG_MGR)"
}

detect_session() {
  # XDG_SESSION_TYPE is set by systemd-logind; WAYLAND_DISPLAY / DISPLAY are
  # the most reliable fallbacks for nested sessions.
  local session="${XDG_SESSION_TYPE:-}"
  if [[ -z "$session" ]]; then
    if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then session="wayland"
    elif [[ -n "${DISPLAY:-}" ]]; then session="x11"
    else session="unknown"
    fi
  fi
  log "Detected display server: $session"
  SESSION="$session"
}

# ── install actions ─────────────────────────────────────────────────────────
install_apt() {
  # Common screenshot tools across both sessions.
  local pkgs=(grim xdotool xclip)
  # Wayland-specific extras.
  if [[ "$SESSION" == "wayland" ]]; then
    pkgs+=(wl-clipboard ydotool)
  fi

  $SUDO apt-get update -y
  # shellcheck disable=SC2086
  $SUDO apt-get install -y --no-install-recommends "${pkgs[@]}"

  # ydotoold daemon: needs to be running for ydotool input to work.
  if [[ "$SESSION" == "wayland" ]] && have systemctl; then
    if have ydotoold; then
      log "Enabling ydotoold user daemon (ydotool needs this for input)"
      systemctl --user enable --now ydotoold || \
        warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
    fi
  fi
}

install_dnf() {
  local pkgs=(grim xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO dnf install -y "${pkgs[@]}"

  if [[ "$SESSION" == "wayland" ]] && have systemctl && have ydotoold; then
    systemctl --user enable --now ydotoold || \
      warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
  fi
}

install_pacman() {
  local pkgs=(grim xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO pacman -S --noconfirm "${pkgs[@]}"

  if [[ "$SESSION" == "wayland" ]] && have systemctl && have ydotoold; then
    systemctl --user enable --now ydotoold || \
      warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
  fi
}

install_zypper() {
  local pkgs=(grim xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO zypper --non-interactive install "${pkgs[@]}"

  if [[ "$SESSION" == "wayland" ]] && have systemctl && have ydotoold; then
    systemctl --user enable --now ydotoold || \
      warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
  fi
}

# ── verification ────────────────────────────────────────────────────────────
# Returns the list of missing tools on stdout. Used by both --check and the
# post-install self-test.
missing_tools() {
  local missing=()
  # All sessions need a screenshot tool + an input tool.
  if ! have grim && ! have scrot && ! have gnome-screenshot; then
    missing+=("screenshot tool (grim / scrot / gnome-screenshot)")
  fi
  # Input tool: xdotool works on X11, ydotool on wlroots Wayland. GNOME
  # Wayland blocks all input injection by design; we report that honestly.
  case "$SESSION" in
    x11)
      have xdotool || missing+=("xdotool")
      ;;
    wayland)
      have ydotool || missing+=("ydotool (+ running ydotoold)")
      ;;
    *)
      missing+=("input tool (unknown session — install xdotool for X11 or ydotool for wlroots Wayland)")
      ;;
  esac
  # Clipboard: needed for paste-style type.
  if [[ "$SESSION" == "wayland" ]]; then
    have wl-copy || missing+=("wl-clipboard")
  else
    have xclip || missing+=("xclip")
  fi
  printf '%s\n' "${missing[@]}"
}

# ── entrypoint ───────────────────────────────────────────────────────────────
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      die "Unknown argument: $arg (try --help)"
      ;;
  esac
done

if [[ "$CHECK_ONLY" -eq 0 ]]; then
  require_root
fi
detect_distro
detect_session

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  log "Checking installed tools..."
  missing=$(missing_tools)
  if [[ -z "$missing" ]]; then
    log "All required tools are present."
    exit 0
  fi
  warn "Missing tools:"
  printf '  - %s\n' $missing
  echo
  log "Run without --check to install them (sudo required)."
  exit 2
fi

case "$PKG_MGR" in
  apt)    install_apt    ;;
  dnf)    install_dnf    ;;
  pacman) install_pacman ;;
  zypper) install_zypper ;;
  unknown)
    die "Unsupported distro ($DISTRO_ID). Install manually: grim, xdotool/ydotool, xclip/wl-clipboard."
    ;;
esac

log "Verifying install..."
missing=$(missing_tools || true)
if [[ -n "$missing" ]]; then
  warn "Some tools are still missing after install:"
  printf '  - %s\n' $missing
  echo
  warn "This is common on Wayland compositors that block input injection (e.g. GNOME Wayland)."
  warn "Try switching to an X11 session, or use a wlroots compositor (Sway, Hyprland)."
  exit 1
fi

log "All set. GUI automation should work on the next agent loop run."
log "If you previously launched the AppImage, restart it so the preflight check re-runs."
