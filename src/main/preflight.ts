/**
 * Runtime preflight check — verifies critical bundled resources exist at startup.
 * Only runs in packaged mode (app.isPackaged === true).
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { log, logWarn } from './utils/logger';
import { linuxCommandExistsSync } from './mcp/gui-operate-server';

export interface PreflightIssue {
  resource: string;
  severity: 'critical' | 'warning';
  message: string;
}

export function runPreflight(): PreflightIssue[] {
  if (!app.isPackaged) return [];

  const issues: PreflightIssue[] = [];
  const resources = process.resourcesPath;
  const platform = process.platform;

  // Check function
  function check(relativePath: string, resource: string, severity: 'critical' | 'warning') {
    const fullPath = path.join(resources, relativePath);
    if (!fs.existsSync(fullPath)) {
      issues.push({ resource, severity, message: `Missing: ${relativePath}` });
    }
  }

  // Critical checks (all platforms)
  check('mcp/gui-operate-server.js', 'MCP Server (GUI)', 'critical');

  // Platform-specific
  if (platform === 'darwin') {
    check('node/bin/node', 'Bundled Node.js', 'critical');
    check('lima-agent/index.js', 'Lima Sandbox Agent', 'warning');
  } else if (platform === 'win32') {
    check('node/node.exe', 'Bundled Node.js', 'critical');
    check('wsl-agent/index.js', 'WSL Sandbox Agent', 'warning');
  } else if (platform === 'linux') {
    check('node/bin/node', 'Bundled Node.js', 'critical');

    // Non-blocking warning when GUI toolchain is missing on Linux. The
    // MCP action dispatch already throws install-hint errors at use time,
    // but surfacing this at startup lets a packaged build discover the gap
    // before the user starts an agent loop. Probed via the same `which`
    // primitive used by the action dispatch (DRY per the plan).
    const linuxIssue = checkLinuxGuiTools(linuxCommandExistsSync);
    if (linuxIssue) issues.push(linuxIssue);
  }

  // Non-critical checks
  check('skills', 'Built-in Skills', 'warning');

  // Log results
  for (const issue of issues) {
    if (issue.severity === 'critical') {
      log(`[Preflight] CRITICAL: ${issue.resource} — ${issue.message}`);
    } else {
      logWarn(`[Preflight] WARNING: ${issue.resource} — ${issue.message}`);
    }
  }

  return issues;
}

/**
 * Pure helper that returns a PreflightIssue when any required Linux GUI tool
 * is missing, or null when the system has the full toolchain installed.
 *
 * Exported so the priority + message-construction logic can be unit-tested
 * without booting the full preflight flow or mocking child_process. The
 * `probe` parameter is the dependency-injection seam — the caller passes the
 * sync `linuxCommandExistsSync` from the MCP server module in production.
 */
export function checkLinuxGuiTools(
  probe: (tool: string) => boolean
): PreflightIssue | null {
  const missing: string[] = [];
  if (!probe('xdotool')) missing.push('xdotool');
  if (!probe('grim')) missing.push('grim');
  if (missing.length === 0) return null;
  return {
    resource: 'Linux GUI Tools',
    severity: 'warning',
    message:
      `Missing system tools: ${missing.join(', ')}. ` +
      `Run \`npm run setup:linux-gui\` (or \`sudo apt install ${missing.join(' ')}\`) to fix.`,
  };
}
