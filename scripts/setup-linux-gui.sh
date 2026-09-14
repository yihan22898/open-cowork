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

# Detect the desktop environment. GNOME on Wayland is the worst case for GUI
# automation: it has no wlroots screencopy (grim fails), it blocks synthetic
# input from xdotool by design, and even ydotool is unreliable because GNOME's
# mutter compositor does not implement the zwlr-virtual-pointer protocol.
# When we detect that combo, we surface a hard warning so the user is not
# stuck wondering why nothing works.
detect_desktop() {
  local raw="${XDG_CURRENT_DESKTOP:-unknown}"
  DESKTOP="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  if [[ "$DESKTOP" == *gnome* ]]; then
    if [[ "$SESSION" == "wayland" ]]; then
      GNOME_WAYLAND=1
      warn "Detected GNOME on Wayland. Screenshots and clicks will not work fully here:"
      warn "  - grim returns 'no wlr-screencopy-unstable-v1' (mutter doesn't ship it)"
      warn "  - xdotool clicks are silently dropped (mutter blocks synthetic input)"
      warn "  - ydotool often fails because mutter doesn't implement zwlr-virtual-pointer"
      warn "Workarounds, best → worst:"
      warn "  1. Log out, pick 'Ubuntu on Xorg' at the login screen — whole session becomes X11"
      warn "  2. Launch GUI targets with GDK_BACKEND=x11 (e.g. 'GDK_BACKEND=x11 gnome-calculator &')"
      warn "  3. Install Sway or Hyprland instead of GNOME"
    fi
  fi
}

# ── install actions ─────────────────────────────────────────────────────────
install_apt() {
  # Screenshot fallbacks the MCP server tries in order: grim → scrot →
  # gnome-screenshot. grim needs wlroots Wayland compositors. scrot and
  # gnome-screenshot cover X11 / XWayland surfaces and are the practical
  # fallback on GNOME Wayland (where grim returns "no wlr-screencopy").
  # Without scrot + gnome-screenshot installed, screenshot tools silently
  # fail on most Ubuntu machines — fix that here.
  local pkgs=(grim scrot gnome-screenshot xdotool xclip)
  # Wayland-specific extras.
  if [[ "$SESSION" == "wayland" ]]; then
    pkgs+=(wl-clipboard ydotool)
  fi

  $SUDO apt-get update -y
  # shellcheck disable=SC2086
  $SUDO apt-get install -y --no-install-recommends "${pkgs[@]}" || \
    warn "Some packages failed to install; rerun with --check to see what's still missing."

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
  # grim needs wlroots Wayland; scrot/gnome-screenshot cover X11 + XWayland
  # surfaces so the MCP server's screenshot fallback chain has at least
  # one tool that works on GNOME Wayland.
  local pkgs=(grim scrot gnome-screenshot xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO dnf install -y "${pkgs[@]}" || \
    warn "Some packages failed to install; rerun with --check to see what's still missing."

  if [[ "$SESSION" == "wayland" ]] && have systemctl && have ydotoold; then
    systemctl --user enable --now ydotoold || \
      warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
  fi
}

install_pacman() {
  # gnome-screenshot lives in AUR on Arch-family; pacman -S may fail for it,
  # which is fine — the script degrades gracefully (MCP server still has grim
  # and scrot as fallbacks).
  local pkgs=(grim scrot gnome-screenshot xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO pacman -S --noconfirm "${pkgs[@]}" || \
    warn "Some packages failed to install (gnome-screenshot may need AUR); rerun with --check."

  if [[ "$SESSION" == "wayland" ]] && have systemctl && have ydotoold; then
    systemctl --user enable --now ydotoold || \
      warn "Could not enable ydotoold. Start it manually: systemctl --user enable --now ydotoold"
  fi
}

install_zypper() {
  local pkgs=(grim scrot gnome-screenshot xdotool xclip)
  [[ "$SESSION" == "wayland" ]] && pkgs+=(wl-clipboard ydotool)
  # shellcheck disable=SC2086
  $SUDO zypper --non-interactive install "${pkgs[@]}" || \
    warn "Some packages failed to install; rerun with --check to see what's still missing."

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
  # At least one screenshot tool. We DON'T require all three: each works on
  # a different compositor. grim for wlroots, scrot for X11/XWayland,
  # gnome-screenshot for GNOME Shell fallback. The MCP server tries the
  # whole chain, but if none of these is installed every screenshot fails.
  if ! have grim && ! have scrot && ! have gnome-screenshot; then
    missing+=("screenshot tool (install at least one: grim / scrot / gnome-screenshot)")
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
detect_desktop

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

# Final hard warning if this is GNOME Wayland — even with all tools installed,
# the user will hit synthetic-input blocks that no script can fix. Make that
# obvious before they go debugging the wrong layer.
if [[ "${GNOME_WAYLAND:-0}" == "1" ]]; then
  warn ""
  warn "==> REMINDER: you are on GNOME Wayland. Tools were installed, but:"
  warn "    - mouse clicks via xdotool/ydotool may still be silently dropped"
  warn "    - screenshots of native Wayland windows may be black/empty"
  warn "    For reliable GUI automation, switch to an X11 session at login:"
  warn "      logout → click the gear icon → 'Ubuntu on Xorg'"
fi
