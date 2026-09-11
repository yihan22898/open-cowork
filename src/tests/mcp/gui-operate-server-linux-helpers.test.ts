/**
 * Tests for Linux tool detection helpers (U2).
 *
 * The async helpers (`linuxResolveInputTool`, `linuxResolveScreenshotTool`,
 * `detectLinuxInstallCommand`) compose pure priority parsers
 * (`selectLinuxInputTool`, `selectLinuxScreenshotTool`, `parseLinuxOsRelease`)
 * with filesystem / process probes. We test the pure parsers directly to keep
 * the suite deterministic; the async wrappers get one integration smoke each.
 *
 * Helper coverage:
 *   - linuxDetectDisplayServer: env-only, sync.
 *   - selectLinuxInputTool / selectLinuxScreenshotTool: pure priority logic.
 *   - linuxResolveInputTool / linuxResolveScreenshotTool: async integration.
 *   - parseLinuxOsRelease / detectLinuxInstallCommand: pure parser + one
 *     filesystem smoke.
 *   - linuxCommandExists: one integration smoke that confirms a missing tool
 *     reports false (we do not assert true, since the test host may or may
 *     not have `which` and the candidate tool installed).
 *   - throwLinuxToolMissing: pure error constructor.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as guiOperate from '../../main/mcp/gui-operate-server';

describe('linuxDetectDisplayServer', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;

  afterEach(() => {
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('returns "wayland" when WAYLAND_DISPLAY is set', () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    delete process.env.DISPLAY;
    expect(guiOperate.linuxDetectDisplayServer()).toBe('wayland');
  });

  it('returns "x11" when DISPLAY is set and WAYLAND_DISPLAY is not', () => {
    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ':0';
    expect(guiOperate.linuxDetectDisplayServer()).toBe('x11');
  });

  it('prefers "wayland" when both env vars are set', () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    process.env.DISPLAY = ':0';
    expect(guiOperate.linuxDetectDisplayServer()).toBe('wayland');
  });

  it('returns "unknown" when neither env var is set', () => {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    expect(guiOperate.linuxDetectDisplayServer()).toBe('unknown');
  });
});

describe('selectLinuxInputTool', () => {
  it('resolves to ydotool on Wayland when ydotool is available', () => {
    expect(guiOperate.selectLinuxInputTool('wayland', new Set(['ydotool']))).toBe('ydotool');
  });

  it('returns null on Wayland when ydotool is missing (no implicit xdotool fallback)', () => {
    expect(guiOperate.selectLinuxInputTool('wayland', new Set(['xdotool']))).toBeNull();
  });

  it('returns null on Wayland when nothing is available', () => {
    expect(guiOperate.selectLinuxInputTool('wayland', new Set())).toBeNull();
  });

  it('resolves to xdotool on X11 when xdotool is available', () => {
    expect(guiOperate.selectLinuxInputTool('x11', new Set(['xdotool']))).toBe('xdotool');
  });

  it('returns null on X11 when xdotool is missing', () => {
    expect(guiOperate.selectLinuxInputTool('x11', new Set(['ydotool']))).toBeNull();
  });

  it('returns null when display server is unknown, even if tools are available', () => {
    expect(guiOperate.selectLinuxInputTool('unknown', new Set(['xdotool', 'ydotool']))).toBeNull();
  });
});

describe('selectLinuxScreenshotTool', () => {
  it('prefers grim on Wayland when installed', () => {
    expect(guiOperate.selectLinuxScreenshotTool('wayland', new Set(['grim', 'gnome-screenshot']))).toBe(
      'grim',
    );
  });

  it('falls back to gnome-screenshot on Wayland when grim is missing', () => {
    expect(guiOperate.selectLinuxScreenshotTool('wayland', new Set(['gnome-screenshot']))).toBe(
      'gnome-screenshot',
    );
  });

  it('returns null on Wayland when nothing is installed', () => {
    expect(guiOperate.selectLinuxScreenshotTool('wayland', new Set())).toBeNull();
  });

  it('prefers scrot on X11 when installed', () => {
    expect(guiOperate.selectLinuxScreenshotTool('x11', new Set(['scrot', 'gnome-screenshot']))).toBe(
      'scrot',
    );
  });

  it('falls back to gnome-screenshot on X11 when scrot is missing', () => {
    expect(guiOperate.selectLinuxScreenshotTool('x11', new Set(['gnome-screenshot']))).toBe(
      'gnome-screenshot',
    );
  });

  it('returns null on X11 when neither scrot nor gnome-screenshot is installed', () => {
    expect(guiOperate.selectLinuxScreenshotTool('x11', new Set())).toBeNull();
  });

  it('returns null when display server is unknown', () => {
    expect(guiOperate.selectLinuxScreenshotTool('unknown', new Set(['grim']))).toBeNull();
  });
});

describe('parseLinuxOsRelease', () => {
  it('returns apt command for Debian/Ubuntu (ID_LIKE=debian)', () => {
    expect(guiOperate.parseLinuxOsRelease('ID=debian\nID_LIKE=debian\n')).toBe(
      'sudo apt install xdotool grim',
    );
  });

  it('returns apt command for Ubuntu-derived distros that only set ID', () => {
    expect(guiOperate.parseLinuxOsRelease('NAME="Pop!_OS"\nID=pop\nID_LIKE=debian ubuntu\n')).toBe(
      'sudo apt install xdotool grim',
    );
  });

  it('returns dnf command for Fedora/RHEL', () => {
    expect(guiOperate.parseLinuxOsRelease('ID=fedora\nID_LIKE="rhel fedora"\n')).toBe(
      'sudo dnf install xdotool grim',
    );
  });

  it('returns pacman command for Arch', () => {
    expect(guiOperate.parseLinuxOsRelease('ID=arch\nID_LIKE=arch\n')).toBe(
      'sudo pacman -S xdotool grim',
    );
  });

  it('returns zypper command for openSUSE', () => {
    expect(guiOperate.parseLinuxOsRelease('ID=opensuse-leap\nID_LIKE="suse opensuse"\n')).toBe(
      'sudo zypper install xdotool grim',
    );
  });

  it('returns apt as the safe default for an unrecognized distro family', () => {
    expect(guiOperate.parseLinuxOsRelease('ID=unknownos\nID_LIKE=\n')).toBe(
      'sudo apt install xdotool grim',
    );
  });

  it('returns apt as the safe default for empty input', () => {
    expect(guiOperate.parseLinuxOsRelease('')).toBe('sudo apt install xdotool grim');
  });
});

describe('linuxResolveInputTool (integration)', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;

  afterEach(() => {
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('returns null when the display server is unknown', async () => {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    expect(await guiOperate.linuxResolveInputTool()).toBeNull();
  });
});

describe('linuxResolveScreenshotTool (integration)', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;

  afterEach(() => {
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('returns null when the display server is unknown', async () => {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    expect(await guiOperate.linuxResolveScreenshotTool()).toBeNull();
  });
});

describe('linuxCommandExists (integration)', () => {
  it('returns false for a tool that does not exist on this host', async () => {
    // A unique sentinel name that no real package provides.
    expect(await guiOperate.linuxCommandExists('open-cowork-does-not-exist-tool-xyz123')).toBe(
      false,
    );
  });
});

describe('throwLinuxToolMissing', () => {
  it('throws an error whose message names the missing tool', () => {
    expect(() => guiOperate.throwLinuxToolMissing('xdotool', 'sudo apt install xdotool')).toThrow(
      /xdotool/,
    );
  });

  it('includes the install command in the error message', () => {
    expect(() => guiOperate.throwLinuxToolMissing('grim', 'sudo apt install grim')).toThrow(
      /sudo apt install grim/,
    );
  });

  it('mentions $PATH as a fallback in the message', () => {
    expect(() => guiOperate.throwLinuxToolMissing('grim', 'sudo apt install grim')).toThrow(
      /\$PATH/,
    );
  });
});
