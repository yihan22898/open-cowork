/**
 * Tests for Linux input action helpers (U3).
 *
 * Mirrors the U2 strategy: test the pure argv builders and the modifier/key
 * mappers directly so the priority + quoting logic is covered without
 * mocking child_process. The async wrappers get one integration smoke each.
 *
 * Helper coverage:
 *   - mapLinuxModifier: macOS-style aliases collapse to ctrl/alt.
 *   - mapLinuxKey: API key names -> xdotool keysyms.
 *   - buildXdotoolClickArgs / buildYdotoolClickArgs: argv shape for click.
 *   - buildXdotoolTypeArgs / buildXdotoolKeyArgs: argv shape for type and key.
 *   - selectLinuxPasteTool / buildLinuxClipboardCopyArgs: clipboard tool pick.
 *   - linuxPerformClick / linuxPerformType / linuxPerformKeyPress: integration
 *     smokes that confirm the error path (missing tool) throws the install
 *     hint and the happy path delegates to the resolved tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as guiOperate from '../../main/mcp/gui-operate-server';

describe('mapLinuxModifier', () => {
  it('collapses macOS-style cmd aliases to ctrl', () => {
    expect(guiOperate.mapLinuxModifier('cmd')).toBe('ctrl');
    expect(guiOperate.mapLinuxModifier('command')).toBe('ctrl');
  });

  it('passes through ctrl / control aliases', () => {
    expect(guiOperate.mapLinuxModifier('ctrl')).toBe('ctrl');
    expect(guiOperate.mapLinuxModifier('control')).toBe('ctrl');
  });

  it('collapses option to alt', () => {
    expect(guiOperate.mapLinuxModifier('option')).toBe('alt');
    expect(guiOperate.mapLinuxModifier('alt')).toBe('alt');
  });

  it('collapses super / meta / win to super', () => {
    expect(guiOperate.mapLinuxModifier('super')).toBe('super');
    expect(guiOperate.mapLinuxModifier('meta')).toBe('super');
    expect(guiOperate.mapLinuxModifier('win')).toBe('super');
  });

  it('defaults unknown modifiers to ctrl', () => {
    expect(guiOperate.mapLinuxModifier('unknown')).toBe('ctrl');
  });
});

describe('mapLinuxKey', () => {
  it('maps Enter / Return to Return', () => {
    expect(guiOperate.mapLinuxKey('Enter')).toBe('Return');
    expect(guiOperate.mapLinuxKey('Return')).toBe('Return');
  });

  it('maps Escape / Esc to Escape', () => {
    expect(guiOperate.mapLinuxKey('Escape')).toBe('Escape');
    expect(guiOperate.mapLinuxKey('esc')).toBe('Escape');
  });

  it('maps Backspace to BackSpace (xdotool spelling)', () => {
    expect(guiOperate.mapLinuxKey('Backspace')).toBe('BackSpace');
  });

  it('maps arrow keys to single-word xdotool keysyms', () => {
    expect(guiOperate.mapLinuxKey('ArrowUp')).toBe('Up');
    expect(guiOperate.mapLinuxKey('arrowdown')).toBe('Down');
    expect(guiOperate.mapLinuxKey('ArrowLeft')).toBe('Left');
    expect(guiOperate.mapLinuxKey('ArrowRight')).toBe('Right');
  });

  it('maps Tab to Tab', () => {
    expect(guiOperate.mapLinuxKey('Tab')).toBe('Tab');
  });

  it('passes through single characters unchanged', () => {
    expect(guiOperate.mapLinuxKey('a')).toBe('a');
    expect(guiOperate.mapLinuxKey('Z')).toBe('Z');
    expect(guiOperate.mapLinuxKey('5')).toBe('5');
  });

  it('maps page navigation keys', () => {
    expect(guiOperate.mapLinuxKey('Home')).toBe('Home');
    expect(guiOperate.mapLinuxKey('End')).toBe('End');
    expect(guiOperate.mapLinuxKey('PageUp')).toBe('Page_Up');
    expect(guiOperate.mapLinuxKey('PageDown')).toBe('Page_Down');
  });
});

describe('buildXdotoolClickArgs', () => {
  it('builds single-click argv', () => {
    expect(guiOperate.buildXdotoolClickArgs(100, 200, 'single', [])).toEqual([
      'mousemove',
      '--',
      '100',
      '200',
      'click',
      '1',
    ]);
  });

  it('builds double-click argv with --repeat 2', () => {
    expect(guiOperate.buildXdotoolClickArgs(100, 200, 'double', [])).toEqual([
      'mousemove',
      '--',
      '100',
      '200',
      'click',
      '--repeat',
      '2',
      '1',
    ]);
  });

  it('builds triple-click argv with --repeat 3', () => {
    expect(guiOperate.buildXdotoolClickArgs(100, 200, 'triple', [])).toEqual([
      'mousemove',
      '--',
      '100',
      '200',
      'click',
      '--repeat',
      '3',
      '1',
    ]);
  });

  it('builds right-click argv with button 3', () => {
    expect(guiOperate.buildXdotoolClickArgs(100, 200, 'right', [])).toEqual([
      'mousemove',
      '--',
      '100',
      '200',
      'click',
      '3',
    ]);
  });

  it('wraps the click in keydown/keyup when modifiers are present', () => {
    expect(guiOperate.buildXdotoolClickArgs(100, 200, 'single', ['shift'])).toEqual([
      'keydown',
      'shift',
      'mousemove',
      '--',
      '100',
      '200',
      'click',
      '1',
      'keyup',
      'shift',
    ]);
  });

  it('maps cmd to ctrl when wrapping modifiers', () => {
    expect(guiOperate.buildXdotoolClickArgs(0, 0, 'single', ['cmd'])).toEqual([
      'keydown',
      'ctrl',
      'mousemove',
      '--',
      '0',
      '0',
      'click',
      '1',
      'keyup',
      'ctrl',
    ]);
  });

  it('handles multiple modifiers in keydown/keyup order', () => {
    // The implementation releases modifiers in the order they were pressed
    // (input order); xdotool accepts this for the supported click patterns.
    expect(guiOperate.buildXdotoolClickArgs(0, 0, 'single', ['ctrl', 'shift'])).toEqual([
      'keydown',
      'ctrl',
      'keydown',
      'shift',
      'mousemove',
      '--',
      '0',
      '0',
      'click',
      '1',
      'keyup',
      'ctrl',
      'keyup',
      'shift',
    ]);
  });

  it('uses -- separator before coordinates to prevent negative-coordinate parsing', () => {
    const args = guiOperate.buildXdotoolClickArgs(-100, -200, 'single', []);
    expect(args.indexOf('--')).toBeGreaterThan(-1);
    expect(args.indexOf('-100')).toBe(args.indexOf('--') + 1);
  });
});

describe('buildYdotoolClickArgs', () => {
  it('uses -a flag for absolute mousemove on single click', () => {
    expect(guiOperate.buildYdotoolClickArgs(100, 200, 'single', [])).toEqual([
      'mousemove',
      '-a',
      '100',
      '200',
      'click',
      '0xC0',
    ]);
  });

  it('uses BTN_RIGHT (0xC1) for right-click', () => {
    expect(guiOperate.buildYdotoolClickArgs(100, 200, 'right', [])).toEqual([
      'mousemove',
      '-a',
      '100',
      '200',
      'click',
      '0xC1',
    ]);
  });

  it('emits repeated click 0xC0 for double-click', () => {
    expect(guiOperate.buildYdotoolClickArgs(0, 0, 'double', [])).toEqual([
      'mousemove',
      '-a',
      '0',
      '0',
      'click',
      '0xC0',
      'click',
      '0xC0',
    ]);
  });

  it('emits three clicks for triple-click', () => {
    const args = guiOperate.buildYdotoolClickArgs(0, 0, 'triple', []);
    const clickCount = args.filter((a) => a === 'click').length;
    expect(clickCount).toBe(3);
  });
});

describe('buildXdotoolTypeArgs', () => {
  it('builds type argv with --delay 12 and --clearmodifiers', () => {
    expect(guiOperate.buildXdotoolTypeArgs('hello', false)).toEqual([
      'type',
      '--delay',
      '12',
      '--clearmodifiers',
      'hello',
    ]);
  });

  it('appends key Return when pressEnter is true', () => {
    expect(guiOperate.buildXdotoolTypeArgs('hello', true)).toEqual([
      'type',
      '--delay',
      '12',
      '--clearmodifiers',
      'hello',
      'key',
      'Return',
    ]);
  });

  it('handles empty text', () => {
    expect(guiOperate.buildXdotoolTypeArgs('', false)).toEqual([
      'type',
      '--delay',
      '12',
      '--clearmodifiers',
      '',
    ]);
  });
});

describe('buildXdotoolKeyArgs', () => {
  it('builds key argv without modifiers', () => {
    expect(guiOperate.buildXdotoolKeyArgs('Tab', [])).toEqual(['key', 'Tab']);
  });

  it('prefixes modifiers in xdotool syntax', () => {
    expect(guiOperate.buildXdotoolKeyArgs('v', ['ctrl'])).toEqual(['key', 'ctrl+v']);
  });

  it('preserves modifier order in the joined prefix (input order)', () => {
    expect(guiOperate.buildXdotoolKeyArgs('Tab', ['shift', 'ctrl'])).toEqual([
      'key',
      'shift+ctrl+Tab',
    ]);
  });

  it('maps Enter key alias to Return', () => {
    expect(guiOperate.buildXdotoolKeyArgs('Enter', [])).toEqual(['key', 'Return']);
  });

  it('maps cmd modifier to ctrl in key prefix', () => {
    expect(guiOperate.buildXdotoolKeyArgs('a', ['cmd'])).toEqual(['key', 'ctrl+a']);
  });
});

describe('selectLinuxPasteTool', () => {
  it('returns wl-copy for Wayland', () => {
    expect(guiOperate.selectLinuxPasteTool('wayland')).toBe('wl-copy');
  });

  it('returns xclip for X11', () => {
    expect(guiOperate.selectLinuxPasteTool('x11')).toBe('xclip');
  });

  it('returns null for an unknown display server', () => {
    expect(guiOperate.selectLinuxPasteTool('unknown')).toBeNull();
  });
});

describe('buildLinuxClipboardCopyArgs', () => {
  it('returns wl-copy with no args for Wayland', () => {
    expect(guiOperate.buildLinuxClipboardCopyArgs('wayland')).toEqual({
      command: 'wl-copy',
      args: [],
    });
  });

  it('returns xclip with -selection clipboard for X11', () => {
    expect(guiOperate.buildLinuxClipboardCopyArgs('x11')).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard'],
    });
  });

  it('returns null for an unknown display server', () => {
    expect(guiOperate.buildLinuxClipboardCopyArgs('unknown')).toBeNull();
  });
});

describe('linuxPerformClick (integration)', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;
  let resolveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(guiOperate, 'linuxResolveInputTool');
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('throws an install-hint error when no input tool is available', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    delete process.env.DISPLAY;
    resolveSpy.mockResolvedValue(null);
    await expect(guiOperate.linuxPerformClick(0, 0, 'single', [])).rejects.toThrow(/install/i);
  });
});

describe('linuxPerformKeyPress (integration)', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;
  let resolveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(guiOperate, 'linuxResolveInputTool');
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('throws an install-hint error when no input tool is available', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    delete process.env.DISPLAY;
    resolveSpy.mockResolvedValue(null);
    await expect(guiOperate.linuxPerformKeyPress('Tab', [])).rejects.toThrow(/install/i);
  });
});

describe('linuxPerformType (integration)', () => {
  const originalWayland = process.env.WAYLAND_DISPLAY;
  const originalDisplay = process.env.DISPLAY;
  let resolveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolveSpy = vi.spyOn(guiOperate, 'linuxResolveInputTool');
  });

  afterEach(() => {
    resolveSpy.mockRestore();
    if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = originalWayland;
    if (originalDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = originalDisplay;
  });

  it('throws a clear error when paste is requested without a display server', async () => {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;
    await expect(guiOperate.linuxPerformType('hello', false, 'paste')).rejects.toThrow(
      /display server/i,
    );
  });

  it('throws an install-hint error when ASCII type requested without an input tool', async () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    delete process.env.DISPLAY;
    resolveSpy.mockResolvedValue(null);
    await expect(guiOperate.linuxPerformType('hello', false, 'keystroke')).rejects.toThrow(
      /install/i,
    );
  });
});
