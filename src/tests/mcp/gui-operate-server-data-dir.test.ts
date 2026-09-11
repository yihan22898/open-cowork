/**
 * Tests for resolveLinuxDataDir (U1 — fix Linux data dir to XDG path).
 *
 * The helper resolves Open Cowork's persistent data directory on Linux to an
 * XDG-compliant path. The previous code branched only on win32 vs everything-
 * else, which silently resolved Linux to the macOS Application Support path.
 *
 * The helper enforces three guards on $XDG_DATA_HOME (security P2 finding):
 *   1. Reject relative paths.
 *   2. Reject values containing '..' segments.
 *   3. Reject values that resolve outside the user's HOME.
 *
 * On any guard failure or unset env, fall back to ~/.local/share/open-cowork.
 */
import { describe, it, expect } from 'vitest';
import { resolveLinuxDataDir } from '../../main/mcp/gui-operate-server';

describe('resolveLinuxDataDir', () => {
  it('uses XDG_DATA_HOME when set to an absolute path', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: '/tmp/custom-xdg' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/tmp/custom-xdg/open-cowork');
  });

  it('falls back to ~/.local/share/open-cowork when XDG_DATA_HOME is unset', () => {
    const result = resolveLinuxDataDir({} as NodeJS.ProcessEnv, '/home/user');
    expect(result).toBe('/home/user/.local/share/open-cowork');
  });

  it('falls back to default when XDG_DATA_HOME is empty string', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: '' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/home/user/.local/share/open-cowork');
  });

  it('falls back to default when XDG_DATA_HOME contains .. segments', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: '../../etc' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/home/user/.local/share/open-cowork');
  });

  it('falls back to default when XDG_DATA_HOME is a relative path', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: 'relative/path' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/home/user/.local/share/open-cowork');
  });

  it('accepts a nested absolute path under HOME', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: '/home/user/.local/share' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/home/user/.local/share/open-cowork');
  });

  it('accepts an absolute path outside HOME (XDG spec allows arbitrary absolute paths)', () => {
    const result = resolveLinuxDataDir(
      { XDG_DATA_HOME: '/mnt/data/xdg' } as NodeJS.ProcessEnv,
      '/home/user',
    );
    expect(result).toBe('/mnt/data/xdg/open-cowork');
  });
});
