/**
 * Tests for the Linux display-configuration helpers added in U4.1.
 *
 * `linuxGetDisplayConfiguration` had to be patched because `getDisplayConfiguration`
 * (called upstream by `convertToGlobalCoordinates` for every Linux action) used to
 * throw "Display detection is not supported on platform: linux". Without this fix
 * every Linux action that passes a region or displayIndex dies before dispatch.
 *
 * Mirrors the U4 strategy: test the pure parsers + the finalizer directly, then
 * drive the async wrapper with an injected probe + exec to cover the priority
 * ordering and fallback path without booting xrandr on the test host.
 */
import { describe, it, expect, vi } from 'vitest';
import * as guiOperate from '../../main/mcp/gui-operate-server';

describe('parseXrandrOutput', () => {
  it('parses a single connected display', () => {
    const text = [
      'Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384',
      'HDMI-1 connected 1920x1080+0+0 (normal left inverted right x axis y axis) 600mm x 340mm',
    ].join('\n');
    const result = guiOperate.parseXrandrOutput(text);
    expect(result).toEqual([
      {
        name: 'HDMI-1',
        isMain: false,
        width: 1920,
        height: 1080,
        originX: 0,
        originY: 0,
      },
    ]);
  });

  it('marks the display flagged "primary" as the main display', () => {
    const text = [
      'eDP-1 connected primary 1920x1080+0+0 (...) 290mm x 170mm',
      'HDMI-1 connected 1920x1080+1920+0 (...) 600mm x 340mm',
    ].join('\n');
    const result = guiOperate.parseXrandrOutput(text);
    expect(result).not.toBeNull();
    const main = result!.find((d) => d.isMain);
    expect(main?.name).toBe('eDP-1');
  });

  it('parses multiple connected displays with non-zero origins', () => {
    const text = [
      'eDP-1 connected primary 2560x1600+0+0 (...) 290mm x 170mm',
      'HDMI-1 connected 1920x1080+2560+0 (...) 600mm x 340mm',
      'HDMI-2 disconnected (normal left inverted right x axis y axis)',
    ].join('\n');
    const result = guiOperate.parseXrandrOutput(text);
    expect(result).toEqual([
      { name: 'eDP-1', isMain: true, width: 2560, height: 1600, originX: 0, originY: 0 },
      { name: 'HDMI-1', isMain: false, width: 1920, height: 1080, originX: 2560, originY: 0 },
    ]);
  });

  it('parses negative offsets (display arranged left of primary)', () => {
    const text = 'DP-1 connected 1920x1080+-1920+0 (...) 600mm x 340mm';
    const result = guiOperate.parseXrandrOutput(text);
    expect(result![0].originX).toBe(-1920);
  });

  it('returns null when no connected displays are present', () => {
    const text = [
      'Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384',
      'HDMI-1 disconnected (normal left inverted right x axis y axis)',
    ].join('\n');
    expect(guiOperate.parseXrandrOutput(text)).toBeNull();
  });
});

describe('parseWlrRandrOutput', () => {
  it('parses a single Wayland output block', () => {
    const text = [
      'HDMI-A-1 "Philips FTV"',
      '  Position: 0, 0',
      '  Resolution: 1920x1080',
      '  Scale Factor: 1.000000',
      '  Transform: normal',
    ].join('\n');
    expect(guiOperate.parseWlrRandrOutput(text)).toEqual([
      {
        name: 'HDMI-A-1',
        isMain: true,
        width: 1920,
        height: 1080,
        originX: 0,
        originY: 0,
      },
    ]);
  });

  it('parses multiple output blocks and marks the first as main', () => {
    const text = [
      'eDP-1 "Built-in"',
      '  Position: 0, 0',
      '  Resolution: 2560x1600',
      '  Scale Factor: 2.000000',
      '',
      'HDMI-A-1 "External"',
      '  Position: 2560, 0',
      '  Resolution: 1920x1080',
      '  Scale Factor: 1.000000',
    ].join('\n');
    const result = guiOperate.parseWlrRandrOutput(text);
    expect(result).toEqual([
      {
        name: 'eDP-1',
        isMain: true,
        width: 2560,
        height: 1600,
        originX: 0,
        originY: 0,
      },
      {
        name: 'HDMI-A-1',
        isMain: false,
        width: 1920,
        height: 1080,
        originX: 2560,
        originY: 0,
      },
    ]);
  });

  it('returns null when no complete Position+Resolution block is present', () => {
    const text = [
      'HDMI-A-1 "Philips"',
      '  Scale Factor: 1.000000',
      '  Transform: normal',
    ].join('\n');
    expect(guiOperate.parseWlrRandrOutput(text)).toBeNull();
  });
});

describe('finalizeDisplayConfig', () => {
  it('assigns sequential indices and sets totals to the bounding box', () => {
    const raw = [
      { name: 'A', isMain: false, width: 1920, height: 1080, originX: 0, originY: 0 },
      { name: 'B', isMain: false, width: 1920, height: 1080, originX: 1920, originY: 0 },
    ];
    const result = guiOperate.finalizeDisplayConfig(raw);
    expect(result.displays.map((d) => d.index)).toEqual([0, 1]);
    expect(result.totalWidth).toBe(3840);
    expect(result.totalHeight).toBe(1080);
  });

  it('propagates the main-display flag from the raw input', () => {
    const raw = [
      { name: 'A', isMain: true, width: 1920, height: 1080, originX: 0, originY: 0 },
      { name: 'B', isMain: false, width: 1920, height: 1080, originX: 1920, originY: 0 },
    ];
    const result = guiOperate.finalizeDisplayConfig(raw);
    expect(result.mainDisplayIndex).toBe(0);
    expect(result.displays[0].isMain).toBe(true);
  });

  it('marks the first display as main when nothing in the raw list claimed main', () => {
    const raw = [
      { name: 'A', isMain: false, width: 1920, height: 1080, originX: 0, originY: 0 },
    ];
    const result = guiOperate.finalizeDisplayConfig(raw);
    expect(result.mainDisplayIndex).toBe(0);
    expect(result.displays[0].isMain).toBe(true);
  });

  it('returns a synthetic single display when given an empty list', () => {
    const result = guiOperate.finalizeDisplayConfig([]);
    expect(result.displays).toHaveLength(1);
    expect(result.displays[0]).toMatchObject({
      index: 0,
      name: 'Display 0',
      isMain: true,
      width: 1920,
      height: 1080,
      originX: 0,
      originY: 0,
    });
  });

  it('handles negative origins by widening the bounding box to include them', () => {
    const raw = [
      { name: 'A', isMain: true, width: 1920, height: 1080, originX: 0, originY: 0 },
      { name: 'B', isMain: false, width: 1920, height: 1080, originX: -1920, originY: 0 },
    ];
    const result = guiOperate.finalizeDisplayConfig(raw);
    expect(result.totalWidth).toBe(3840);
    expect(result.totalHeight).toBe(1080);
  });
});

describe('linuxGetDisplayConfiguration', () => {
  it('returns xrandr-parsed config when xrandr probe succeeds', async () => {
    const xrandrOut = [
      'Screen 0: minimum 320 x 200, current 2560 x 1440, maximum 16384 x 16384',
      'eDP-1 connected primary 2560x1600+0+0 (...) 290mm x 170mm',
      'HDMI-1 connected 1920x1080+2560+0 (...) 600mm x 340mm',
    ].join('\n');
    const exec = vi.fn().mockResolvedValue({ stdout: xrandrOut, stderr: '' });
    const probe = (tool: string) => tool === 'xrandr';
    const result = await guiOperate.linuxGetDisplayConfiguration(probe, exec);
    expect(result.displays).toHaveLength(2);
    expect(result.displays[0].name).toBe('eDP-1');
    expect(result.mainDisplayIndex).toBe(0);
    expect(result.totalWidth).toBe(4480);
  });

  it('falls back to wlr-randr when xrandr is not installed', async () => {
    const wlrOut = [
      'eDP-1 "Built-in"',
      '  Position: 0, 0',
      '  Resolution: 2560x1600',
      '  Scale Factor: 2.000000',
    ].join('\n');
    const exec = vi.fn().mockResolvedValue({ stdout: wlrOut, stderr: '' });
    const probe = (tool: string) => tool === 'wlr-randr';
    const result = await guiOperate.linuxGetDisplayConfiguration(probe, exec);
    expect(result.displays).toHaveLength(1);
    expect(result.displays[0]).toMatchObject({ name: 'eDP-1', isMain: true });
  });

  it('falls back to the synthetic single-display config when no tool is available', async () => {
    const exec = vi.fn();
    const probe = () => false;
    const result = await guiOperate.linuxGetDisplayConfiguration(probe, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(result.displays).toHaveLength(1);
    expect(result.displays[0]).toMatchObject({
      index: 0,
      isMain: true,
      width: 1920,
      height: 1080,
      originX: 0,
      originY: 0,
    });
    expect(result.totalWidth).toBe(1920);
    expect(result.totalHeight).toBe(1080);
  });

  it('continues to the next probe when xrandr is installed but parsing fails (no connected displays)', async () => {
    const empty = 'Screen 0: minimum 320 x 200, current 0 x 0, maximum 16384 x 16384';
    const wlrOut = [
      'eDP-1 "Built-in"',
      '  Position: 0, 0',
      '  Resolution: 1920x1080',
    ].join('\n');
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ stdout: empty, stderr: '' }) // xrandr returns nothing useful
      .mockResolvedValueOnce({ stdout: wlrOut, stderr: '' });
    const probe = (tool: string) => tool === 'xrandr' || tool === 'wlr-randr';
    const result = await guiOperate.linuxGetDisplayConfiguration(probe, exec);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(result.displays[0].name).toBe('eDP-1');
  });

  it('continues to the next probe when xrandr exec throws', async () => {
    const wlrOut = [
      'eDP-1 "Built-in"',
      '  Position: 0, 0',
      '  Resolution: 1920x1080',
    ].join('\n');
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('xrandr crashed'))
      .mockResolvedValueOnce({ stdout: wlrOut, stderr: '' });
    const probe = (tool: string) => tool === 'xrandr' || tool === 'wlr-randr';
    const result = await guiOperate.linuxGetDisplayConfiguration(probe, exec);
    expect(result.displays[0].name).toBe('eDP-1');
  });
});
