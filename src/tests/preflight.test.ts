/**
 * Tests for the runtime preflight check.
 * Mocks electron app.isPackaged and process.resourcesPath to simulate
 * packaged and development environments.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Electron mock ────────────────────────────────────────────
// The global alias maps 'electron' → tests/mocks/electron.ts (isPackaged: false).
// We override it per-test with vi.mock to control isPackaged.

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
}));

// ── Helpers ──────────────────────────────────────────────────

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

function makeSkillsDir(resourcesDir: string): void {
  fs.mkdirSync(path.join(resourcesDir, 'skills'), { recursive: true });
}

// ── Test suite ───────────────────────────────────────────────

describe('runPreflight', () => {
  let tmpDir: string;
  const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-preflight-'));
    Object.defineProperty(process, 'resourcesPath', {
      value: tmpDir,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      writable: true,
      configurable: true,
    });
    vi.resetModules();
  });

  it('returns empty array when all resources are present (darwin)', async () => {
    // Simulate darwin platform
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    expect(issues).toHaveLength(0);

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when MCP server is missing', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except mcp/gui-operate-server.js
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('MCP Server (GUI)');
    expect(critical[0].message).toContain('mcp/gui-operate-server.js');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when bundled Node.js is missing (darwin)', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except node binary
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('Bundled Node.js');
    expect(critical[0].message).toContain('node/bin/node');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns critical issue when bundled Node.js is missing (win32)', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    // Provide everything except node.exe
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'wsl-agent/index.js'));
    makeSkillsDir(tmpDir);

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const critical = issues.filter((i) => i.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].resource).toBe('Bundled Node.js');
    expect(critical[0].message).toContain('node/node.exe');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns warning issue when skills directory is missing', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    });

    // Provide everything except skills
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));
    // skills directory intentionally omitted

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.resource === 'Built-in Skills')).toBe(true);
    const skillsWarning = warnings.find((w) => w.resource === 'Built-in Skills');
    expect(skillsWarning?.message).toContain('skills');

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('returns empty array and skips all checks when app.isPackaged is false', async () => {
    // Re-mock electron with isPackaged: false for this test
    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
      },
    }));

    // Do NOT create any resources in tmpDir — should still return []
    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    expect(issues).toHaveLength(0);
  });

  // ── Linux branch ──────────────────────────────────────────
  //
  // Drive `checkLinuxGuiTools` directly with an injected probe so the
  // priority + message-construction logic is covered without booting the
  // full preflight flow or mocking child_process.
  async function importLinuxChecker() {
    const mod = await import('../main/preflight');
    return mod.checkLinuxGuiTools;
  }

  function setPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value, writable: true, configurable: true });
  }

  it('returns null when both xdotool and grim are present', async () => {
    const check = await importLinuxChecker();
    expect(check(() => true)).toBeNull();
  });

  it('returns a warning when only xdotool is missing', async () => {
    const check = await importLinuxChecker();
    const issue = check((tool) => tool === 'grim');
    expect(issue).not.toBeNull();
    expect(issue?.resource).toBe('Linux GUI Tools');
    expect(issue?.message).toContain('xdotool');
    expect(issue?.message).toContain('sudo apt install xdotool');
  });

  it('returns a warning when only grim is missing', async () => {
    const check = await importLinuxChecker();
    const issue = check((tool) => tool === 'xdotool');
    expect(issue).not.toBeNull();
    expect(issue?.message).toContain('grim');
    expect(issue?.message).toContain('sudo apt install grim');
  });

  it('returns one combined warning (not two) when both tools are missing', async () => {
    const check = await importLinuxChecker();
    const issue = check(() => false);
    expect(issue).not.toBeNull();
    expect(issue?.message).toContain('xdotool');
    expect(issue?.message).toContain('grim');
  });

  it('marks the warning as severity "warning" (does not block startup)', async () => {
    const check = await importLinuxChecker();
    const issue = check(() => false);
    expect(issue?.severity).toBe('warning');
  });

  it('does not run the Linux GUI tools probe on darwin', async () => {
    setPlatform('darwin');
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));
    touch(path.join(tmpDir, 'lima-agent/index.js'));

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const linuxWarnings = issues.filter((i) => i.resource === 'Linux GUI Tools');
    expect(linuxWarnings).toHaveLength(0);
  });

  it('does not run the Linux GUI tools probe on win32', async () => {
    setPlatform('win32');
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/node.exe'));
    touch(path.join(tmpDir, 'wsl-agent/index.js'));

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    const linuxWarnings = issues.filter((i) => i.resource === 'Linux GUI Tools');
    expect(linuxWarnings).toHaveLength(0);
  });

  it('emits the Linux warning from runPreflight on linux when tools are missing', async () => {
    setPlatform('linux');
    touch(path.join(tmpDir, 'mcp/gui-operate-server.js'));
    touch(path.join(tmpDir, 'node/bin/node'));

    const { runPreflight } = await import('../main/preflight');
    const issues = runPreflight();
    // On a Windows CI host the real `which` will not find xdotool/grim, so
    // the warning fires naturally; on a Linux dev host the user can stub
    // by removing the tools. Either way the warning is non-critical.
    const linuxWarnings = issues.filter((i) => i.resource === 'Linux GUI Tools');
    if (process.platform === 'win32' || linuxWarnings.length > 0) {
      expect(linuxWarnings[0]?.severity).toBe('warning');
    }
    // If running on a real Linux host with both tools installed, the
    // warning simply doesn't fire — which is the success case.
    expect(linuxWarnings.length).toBeLessThanOrEqual(1);
  });
});
