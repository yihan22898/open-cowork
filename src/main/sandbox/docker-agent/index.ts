#!/usr/bin/env node
/**
 * Docker Sandbox Agent
 *
 * Long-lived JSON-RPC agent that runs INSIDE the Open Cowork sandbox container.
 * The host side uses `docker exec -i <container> node /agent/index.js` to pipe
 * requests through stdin and receive responses via stdout.
 *
 * This script is bundled by `npm run build:docker-agent` into
 * `dist-docker-agent/index.js`, which is then COPYed into the container image by
 * the `docker/sandbox/Dockerfile`.
 *
 * Handles:
 * - Command execution in the isolated Linux container
 * - File operations with path validation against the workspace root
 * - Shutdown handshake
 *
 * Mirrors `wsl-agent/index.ts` for behavioral parity.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { isPathWithinRoot } from './path-containment';

// ===== JSON-RPC types =====

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

// ===== Logging (stderr — stdout is reserved for JSON-RPC) =====

function log(...args: unknown[]): void {
  console.error('[Docker-Agent]', ...args);
}

function logError(...args: unknown[]): void {
  console.error('[Docker-Agent ERROR]', ...args);
}

// ===== Sandbox Agent =====

class SandboxAgent {
  private workspacePath: string = '';
  private isShuttingDown: boolean = false;

  setWorkspace(p: string): void {
    this.workspacePath = path.resolve(p);
    log('Workspace set to:', this.workspacePath);
  }

  private validatePath(targetPath: string): string {
    if (!this.workspacePath) {
      throw new Error('Workspace not configured');
    }

    const resolved = path.resolve(targetPath);

    if (!isPathWithinRoot(resolved, this.workspacePath)) {
      throw new Error(`Path is outside workspace: ${resolved}`);
    }

    // Resolve symlinks to prevent symlink escape attacks
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // For paths that don't exist yet (e.g. write targets), walk up to the
        // nearest existing ancestor and verify containment there.
        let ancestor = resolved;
        while (ancestor !== path.dirname(ancestor)) {
          ancestor = path.dirname(ancestor);
          try {
            const realAncestor = fs.realpathSync(ancestor);
            if (!isPathWithinRoot(realAncestor, this.workspacePath)) {
              throw new Error(`Resolved ancestor path is outside workspace: ${realAncestor}`);
            }
            return resolved;
          } catch (ancestorErr: unknown) {
            if ((ancestorErr as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw ancestorErr;
            }
          }
        }
        return resolved;
      }
      throw err;
    }

    if (!isPathWithinRoot(realPath, this.workspacePath)) {
      throw new Error(`Resolved path is outside workspace: ${realPath}`);
    }

    return realPath;
  }

  private validateCommand(command: string, cwd: string): void {
    this.validatePath(cwd);

    if (command.includes('../') || command.includes('..\\')) {
      throw new Error('Path traversal detected in command');
    }

    const dangerousPatterns = [
      /rm\s+-rf?\s+[/~]/i,
      /dd\s+if=/i,
      /mkfs/i,
      />\s*\/dev\//i,
      /curl.*\|\s*(?:ba)?sh/i,
      /wget.*\|\s*(?:ba)?sh/i,
      /sudo\s+rm/i,
      /chmod\s+777\s+\//i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error('Potentially dangerous command blocked');
      }
    }

    const pathMatches = command.match(/\/[\w./-]+/g) || [];
    for (const p of pathMatches) {
      if (
        p.startsWith('/usr/') ||
        p.startsWith('/bin/') ||
        p.startsWith('/tmp/') ||
        p.startsWith('/dev/null') ||
        p.startsWith('/workspace/')
      ) {
        continue;
      }
      const resolved = path.resolve(p);
      if (!isPathWithinRoot(resolved, this.workspacePath)) {
        throw new Error(`Command references path outside workspace: ${p}`);
      }
    }
  }

  async executeCommand(params: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<{ code: number; stdout: string; stderr: string }> {
    const cwd = params.cwd || this.workspacePath;
    const timeout = params.timeout || 60000;

    this.validateCommand(params.command, cwd);

    log('Executing:', params.command, 'in', cwd);

    return new Promise((resolve, reject) => {
      const proc = spawn('/bin/bash', ['-c', params.command], {
        cwd,
        env: {
          ...process.env,
          ...params.env,
          WORKSPACE: this.workspacePath,
        },
        timeout,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error: Error) => reject(error));

      proc.on('close', (code: number | null) => {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }

  async readFile(params: { path: string }): Promise<{ content: string }> {
    const validPath = this.validatePath(params.path);

    if (!fs.existsSync(validPath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    return { content: fs.readFileSync(validPath, 'utf-8') };
  }

  async writeFile(params: { path: string; content: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);

    const dir = path.dirname(validPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(validPath, params.content, 'utf-8');
    return { success: true };
  }

  async listDirectory(params: { path: string }): Promise<{ entries: DirectoryEntry[] }> {
    const validPath = this.validatePath(params.path);

    if (!fs.existsSync(validPath)) {
      throw new Error(`Directory not found: ${params.path}`);
    }

    const entries = fs.readdirSync(validPath, { withFileTypes: true });
    return {
      entries: entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: entry.isFile()
          ? fs.statSync(path.join(validPath, entry.name)).size
          : undefined,
      })),
    };
  }

  async fileExists(params: { path: string }): Promise<{ exists: boolean }> {
    try {
      this.validatePath(params.path);
      return { exists: fs.existsSync(params.path) };
    } catch {
      return { exists: false };
    }
  }

  async deleteFile(params: { path: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);
    if (fs.existsSync(validPath)) {
      fs.unlinkSync(validPath);
    }
    return { success: true };
  }

  async createDirectory(params: { path: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);
    fs.mkdirSync(validPath, { recursive: true });
    return { success: true };
  }

  async copyFile(params: { src: string; dest: string }): Promise<{ success: boolean }> {
    const srcPath = this.validatePath(params.src);
    const destPath = this.validatePath(params.dest);

    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(srcPath, destPath);
    return { success: true };
  }

  async shutdown(): Promise<{ ok: true }> {
    log('Shutdown requested');
    this.isShuttingDown = true;
    return { ok: true };
  }
}

// ===== JSON-RPC dispatcher =====

const agent = new SandboxAgent();
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function send(response: JSONRPCResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

interface AgentMethodMap {
  ping: () => Promise<{ pong: true }>;
  shutdown: () => Promise<{ ok: true }>;
  setWorkspace: (p: { path: string }) => Promise<{ ok: true }>;
  executeCommand: (p: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }) => Promise<{ code: number; stdout: string; stderr: string }>;
  readFile: (p: { path: string }) => Promise<{ content: string }>;
  writeFile: (p: { path: string; content: string }) => Promise<{ success: boolean }>;
  listDirectory: (p: { path: string }) => Promise<{ entries: DirectoryEntry[] }>;
  fileExists: (p: { path: string }) => Promise<{ exists: boolean }>;
  deleteFile: (p: { path: string }) => Promise<{ success: boolean }>;
  createDirectory: (p: { path: string }) => Promise<{ success: boolean }>;
  copyFile: (p: { src: string; dest: string }) => Promise<{ success: boolean }>;
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request: JSONRPCRequest;
  try {
    request = JSON.parse(trimmed) as JSONRPCRequest;
  } catch (error) {
    logError('Failed to parse request:', error, trimmed);
    return;
  }

  try {
    const method = request.method as keyof AgentMethodMap;
    let result: unknown;

    switch (method) {
      case 'ping':
        result = { pong: true };
        break;
      case 'shutdown':
        result = await agent.shutdown();
        send({ jsonrpc: '2.0', id: request.id, result });
        process.exit(0);
        return;
      case 'setWorkspace':
        agent.setWorkspace((request.params as { path: string }).path);
        result = { ok: true };
        break;
      case 'executeCommand':
        result = await agent.executeCommand(
          request.params as {
            command: string;
            cwd?: string;
            env?: Record<string, string>;
            timeout?: number;
          }
        );
        break;
      case 'readFile':
        result = await agent.readFile(request.params as { path: string });
        break;
      case 'writeFile':
        result = await agent.writeFile(
          request.params as { path: string; content: string }
        );
        break;
      case 'listDirectory':
        result = await agent.listDirectory(request.params as { path: string });
        break;
      case 'fileExists':
        result = await agent.fileExists(request.params as { path: string });
        break;
      case 'deleteFile':
        result = await agent.deleteFile(request.params as { path: string });
        break;
      case 'createDirectory':
        result = await agent.createDirectory(request.params as { path: string });
        break;
      case 'copyFile':
        result = await agent.copyFile(
          request.params as { src: string; dest: string }
        );
        break;
      default:
        throw new Error(`Unknown method: ${request.method}`);
    }

    send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32000, message },
    });
    if (agent['isShuttingDown']) {
      process.exit(0);
    }
  }
});

log('Docker sandbox agent ready (workspace unset)');
