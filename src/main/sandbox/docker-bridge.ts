/**
 * Docker Bridge - Communication bridge between Linux host and the Open Cowork
 * sandbox container.
 *
 * Architecture:
 *   ┌─ Host Linux ────────────────┐    ┌─ Container (long-lived) ────────┐
 *   │  Open Cowork Electron main  │    │  json-rpc agent (this script    │
 *   │       │                     │    │  running under `node agent.js`) │
 *   │       ▼                     │    │       ▲                         │
 *   │  DockerBridge               │───▶│  docker exec -i <ctr> node ...  │
 *   │  (sendRequest) ────────────▶│    │  (stdin/stdout JSON-RPC)        │
 *   └─────────────────────────────┘    └─────────────────────────────────┘
 *
 * Lifecycle:
 *   1. checkDockerStatus()   — detect `docker` or `podman`, whether the
 *                              daemon is reachable, and whether the
 *                              opencowork/sandbox image is present (or
 *                              pullable from Docker Hub).
 *   2. ensureImage()         — `docker pull` the image if missing.
 *   3. ensureContainer()     — `docker run -d ...` the agent container, or
 *                              `docker start` an existing stopped one.
 *   4. startAgent()          — `docker exec -i <ctr> node /agent/index.js`
 *                              attach to stdin/stdout to talk JSON-RPC.
 *   5. sendRequest()         — pipe a request, await matching id response.
 *   6. shutdown()            — graceful agent.stop + leave container
 *                              running for next session.
 */

import { spawn, exec, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { log, logError } from '../utils/logger';
import type {
  DockerStatus,
  SandboxConfig,
  SandboxExecutor,
  ExecutionResult,
  DirectoryEntry,
  JSONRPCRequest,
  JSONRPCResponse,
} from './types';

// ===== Static configuration =====

const DEFAULT_IMAGE = 'opencowork/sandbox:latest';
const CONTAINER_NAME = 'opencowork-sandbox';
const CONTAINER_WORKSPACE_MOUNT = '/workspace';
const CONTAINER_AGENT_PATH = '/agent/index.js';

/** Maximum time to wait for `docker pull` to finish on first run. */
const PULL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Maximum time to wait for container start (image already present). */
const START_TIMEOUT_MS = 60 * 1000; // 1 minute

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Docker Bridge - Manages communication with the Open Cowork container.
 */
export class DockerBridge implements SandboxExecutor {
  private dockerProcess: ChildProcess | null = null;
  private readonly pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();
  private buffer: string = '';
  private config: SandboxConfig | null = null;
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private engine: 'docker' | 'podman' = 'docker';
  private containerId: string | null = null;

  // ===== Status detection =====

  static async checkDockerStatus(): Promise<DockerStatus> {
    try {
      // 1. Probe for docker first
      let engine: 'docker' | 'podman' | null = null;
      let version = '';
      try {
        const { stdout } = await execAsync('docker --version', { timeout: 5000 });
        version = stdout.trim();
        engine = 'docker';
      } catch {
        try {
          const { stdout } = await execAsync('podman --version', { timeout: 5000 });
          version = stdout.trim();
          engine = 'podman';
        } catch {
          return { available: false };
        }
      }

      // 2. Make sure the daemon is reachable (`docker info` / `podman info`)
      try {
        await execAsync(`${engine} info`, { timeout: 5000 });
      } catch (error) {
        log('[Docker] Container engine present but daemon unreachable');
        return { available: false, engine, version };
      }

      // 3. Inspect whether our container exists / is running
      let containerExists = false;
      let containerRunning = false;
      try {
        const { stdout } = await execAsync(
          `${engine} inspect --type=container --format '{{.State.Running}}' ${CONTAINER_NAME}`,
          { timeout: 5000 }
        );
        containerExists = true;
        containerRunning = stdout.trim() === 'true';
      } catch {
        // No container with that name yet — that's fine.
        containerExists = false;
      }

      // 4. Check whether the default image is already pulled
      let imageAvailable = false;
      try {
        await execAsync(
          `${engine} image inspect ${DEFAULT_IMAGE}`,
          { timeout: 5000 }
        );
        imageAvailable = true;
      } catch {
        imageAvailable = false;
      }

      return {
        available: true,
        engine,
        version,
        containerExists,
        containerRunning,
        containerName: CONTAINER_NAME,
        imageAvailable,
        imageName: DEFAULT_IMAGE,
      };
    } catch (error) {
      log('[Docker] Error checking status:', error);
      return { available: false };
    }
  }

  // ===== Image lifecycle =====

  /**
   * Pull the sandbox image from Docker Hub (no-op if already present).
   */
  static async ensureImage(
    engine: 'docker' | 'podman',
    image: string = DEFAULT_IMAGE,
    onProgress?: (chunk: string) => void
  ): Promise<boolean> {
    log(`[Docker] Ensuring image present: ${image}`);

    return new Promise<boolean>((resolve) => {
      const proc = spawn(engine, ['pull', image], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        logError('[Docker] Image pull timed out — killing process');
        proc.kill();
        resolve(false);
      }, PULL_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (onProgress) onProgress(text);
        log(`[Docker Pull] ${text.trim()}`);
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (onProgress) onProgress(text);
        log(`[Docker Pull] ${text.trim()}`);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          log('[Docker] Image pull complete');
          resolve(true);
        } else {
          logError('[Docker] Image pull failed, exit code:', code);
          resolve(false);
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timer);
        logError('[Docker] Failed to spawn pull process:', error);
        resolve(false);
      });
    });
  }

  // ===== Container lifecycle =====

  /**
   * Make sure the sandbox container exists and is running. Idempotent.
   */
  static async ensureContainer(
    engine: 'docker' | 'podman',
    hostWorkspacePath: string,
    image: string = DEFAULT_IMAGE,
    containerName: string = CONTAINER_NAME,
    mountTarget: string = CONTAINER_WORKSPACE_MOUNT
  ): Promise<boolean> {
    // 1) Inspect first
    try {
      const { stdout } = await execAsync(
        `${engine} inspect --type=container --format '{{.State.Running}}' ${containerName}`,
        { timeout: 5000 }
      );
      if (stdout.trim() === 'true') {
        log('[Docker] Container already running:', containerName);
        return true;
      }
      // Exists but not running — start it.
      log('[Docker] Container exists but not running, starting...');
      await execAsync(`${engine} start ${containerName}`, { timeout: START_TIMEOUT_MS });
      return true;
    } catch {
      // Not present — create it.
    }

    log('[Docker] Creating container from image:', image);
    try {
      await execFileAsync(
        engine,
        [
          'run',
          '-d',
          '--name',
          containerName,
          '--restart',
          'unless-stopped',
          '-v',
          `${hostWorkspacePath}:${mountTarget}:rw`,
          '-w',
          mountTarget,
          '-e',
          `WORKSPACE=${mountTarget}`,
          '--network',
          'host',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          image,
          'sleep',
          'infinity',
        ],
        { timeout: START_TIMEOUT_MS, encoding: 'utf-8' }
      );
      log('[Docker] Container created and running');
      return true;
    } catch (error) {
      logError('[Docker] Failed to create container:', error);
      return false;
    }
  }

  // ===== Agent path resolution =====
  // (intentionally unused — kept here as a reference for future host-side
  // helpers that need to locate the bundled agent script. The current
  // implementation inlines the agent path via CONTAINER_AGENT_PATH.)

  // ===== Initialization =====

  async initialize(config: SandboxConfig): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize(config);
    return this.initPromise;
  }

  private async _initialize(config: SandboxConfig): Promise<void> {
    this.config = config;

    const status = await DockerBridge.checkDockerStatus();
    if (!status.available || !status.engine) {
      throw new Error(
        'Docker/Podman not available. Install Docker (https://docs.docker.com/engine/install/) or Podman.'
      );
    }
    this.engine = status.engine;

    // Pull image if missing
    if (!status.imageAvailable) {
      log('[Docker] Image not present locally — pulling from Docker Hub...');
      const pulled = await DockerBridge.ensureImage(this.engine);
      if (!pulled) {
        throw new Error(
          `Failed to pull Open Cowork sandbox image (${DEFAULT_IMAGE}). Check your network and Docker Hub credentials.`
        );
      }
    }

    // Make sure the container is running, with the workspace mounted.
    const ok = await DockerBridge.ensureContainer(
      this.engine,
      config.workspacePath
    );
    if (!ok) {
      throw new Error(`Failed to start Open Cowork sandbox container.`);
    }

    // Capture the container id (we already know it's `CONTAINER_NAME` but
    // resolve to id for clarity in logs).
    try {
      const { stdout } = await execAsync(
        `${this.engine} inspect --type=container --format '{{.Id}}' ${CONTAINER_NAME}`,
        { timeout: 5000 }
      );
      this.containerId = stdout.trim();
    } catch {
      this.containerId = CONTAINER_NAME;
    }

    // Boot the JSON-RPC agent inside the container via `docker exec -i`.
    await this.startAgent();

    // Configure workspace.
    await this.sendRequest('setWorkspace', {
      path: CONTAINER_WORKSPACE_MOUNT,
    });

    this.isInitialized = true;
    log('[Docker] Bridge initialized successfully');
  }

  private async startAgent(): Promise<void> {
    if (this.containerId === null) {
      throw new Error('Container not started before agent attach');
    }

    log('[Docker] Spawning JSON-RPC agent inside container:', this.containerId);

    // docker exec -i <container> node /agent/index.js
    // -i keeps stdin open for JSON-RPC; -t is intentionally omitted so this
    // works in CI / non-tty contexts.
    this.dockerProcess = spawn(
      this.engine,
      ['exec', '-i', this.containerId, 'node', CONTAINER_AGENT_PATH],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    this.dockerProcess.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.dockerProcess.stderr?.on('data', (data: Buffer) => {
      log('[Docker Agent]', data.toString().trim());
    });

    this.dockerProcess.on('exit', (code, signal) => {
      log('[Docker] Agent process exited:', { code, signal });
      this.dockerProcess = null;
      this.isInitialized = false;

      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error('Docker agent process exited'));
        clearTimeout(pending.timeout);
      }
      this.pendingRequests.clear();
    });

    this.dockerProcess.on('error', (error) => {
      logError('[Docker] Agent process error:', error);
    });

    // Wait for the agent to be ready. We treat any successful ping as ready.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Docker agent startup timeout'));
      }, 30000);

      const checkReady = async (): Promise<void> => {
        try {
          await this.sendRequest('ping', {}, 5000);
          clearTimeout(timeout);
          resolve();
        } catch {
          await delay(500);
          await checkReady();
        }
      };

      setTimeout(checkReady, 500);
    });

    log('[Docker] Agent is ready');
  }

  // ===== JSON-RPC plumbing =====

  private processBuffer(): void {
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as JSONRPCResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        logError('[Docker] Failed to parse response:', line, error);
      }
    }
  }

  private async sendRequest<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 60000
  ): Promise<T> {
    if (!this.dockerProcess?.stdin) {
      throw new Error('Docker agent not running');
    }

    const id = uuidv4();
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.dockerProcess!.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  // ===== Public SandboxExecutor interface =====

  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');

    // Translate host cwd into container path. Because we mount the workspace
    // at /workspace, paths passed by callers are typically absolute host
    // paths — we substitute them transparently.
    const containerCwd = this.toContainerPath(cwd || this.config?.workspacePath || '');

    const result = await this.sendRequest<{
      code: number;
      stdout: string;
      stderr: string;
    }>(
      'executeCommand',
      { command, cwd: containerCwd, env },
      this.config?.timeout || 60000
    );

    return {
      success: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    };
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    const result = await this.sendRequest<{ content: string }>('readFile', {
      path: this.toContainerPath(filePath),
    });
    return result.content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    await this.sendRequest('writeFile', {
      path: this.toContainerPath(filePath),
      content,
    });
  }

  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    const result = await this.sendRequest<{ entries: DirectoryEntry[] }>('listDirectory', {
      path: this.toContainerPath(dirPath),
    });
    return result.entries;
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    const result = await this.sendRequest<{ exists: boolean }>('fileExists', {
      path: this.toContainerPath(filePath),
    });
    return result.exists;
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    await this.sendRequest('deleteFile', {
      path: this.toContainerPath(filePath),
    });
  }

  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    await this.sendRequest('createDirectory', {
      path: this.toContainerPath(dirPath),
    });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    if (!this.isInitialized) throw new Error('Docker bridge not initialized');
    await this.sendRequest('copyFile', {
      src: this.toContainerPath(src),
      dest: this.toContainerPath(dest),
    });
  }

  async shutdown(): Promise<void> {
    if (this.dockerProcess) {
      try {
        await this.sendRequest('shutdown', {}, 5000);
      } catch {
        // ignore — process is exiting anyway
      }
      this.dockerProcess.kill();
      this.dockerProcess = null;
    }
    this.isInitialized = false;
    this.pendingRequests.clear();
    log('[Docker] Bridge shutdown complete (container left running)');
  }

  // ===== Path translation =====

  /**
   * Translate a host path to its in-container equivalent.
   *
   * We bind-mount the workspace at /workspace, so any path under the
   * configured workspace root maps onto the same suffix under /workspace.
   * Anything else is returned unchanged so commands can reference standard
   * container paths (/tmp, /usr/bin, etc.).
   */
  private toContainerPath(hostPath: string): string {
    if (!hostPath) return hostPath;

    const hostWorkspace = this.config?.workspacePath;
    if (hostWorkspace && hostPath.startsWith(hostWorkspace)) {
      const suffix = hostPath.slice(hostWorkspace.length);
      if (suffix === '' || suffix === '/') return CONTAINER_WORKSPACE_MOUNT;
      return `${CONTAINER_WORKSPACE_MOUNT}${suffix.startsWith('/') ? '' : '/'}${suffix}`;
    }
    // Anything not under the configured workspace is treated as a
    // container-native path (e.g. /tmp, /usr/bin) and returned unchanged.
    return hostPath;
  }
}

// Export singleton bridge so the rest of the app can share one container
// attachment (mirrors `WSLBridge` / `LimaBridge` exports).
let globalDockerBridge: DockerBridge | null = null;

export function getDockerBridge(): DockerBridge {
  if (!globalDockerBridge) {
    globalDockerBridge = new DockerBridge();
  }
  return globalDockerBridge;
}
