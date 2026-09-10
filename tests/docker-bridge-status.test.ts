/**
 * Tests for DockerBridge detection + path translation logic.
 *
 * These tests cover the parts that don't require a running Docker daemon:
 *   - `toContainerPath` host ↔ container path translation
 *   - `DockerStatus` shape returned by `checkDockerStatus`
 *
 * End-to-end tests against a real `docker` daemon are out of scope for unit
 * tests; they would require docker-in-docker and are exercised by the
 * `publish-sandbox-image.yml` smoke-test step instead.
 */
import { describe, it, expect } from 'vitest';
import { DockerBridge } from '../src/main/sandbox/docker-bridge';
import type { DockerStatus } from '../src/main/sandbox/types';

describe('DockerBridge.checkDockerStatus', () => {
  it('returns a well-typed DockerStatus shape', async () => {
    const status: DockerStatus = await DockerBridge.checkDockerStatus();
    expect(typeof status.available).toBe('boolean');
    if (status.available) {
      expect(['docker', 'podman']).toContain(status.engine);
      expect(typeof status.version).toBe('string');
    }
  });

  it('never throws even when docker is missing', async () => {
    // `docker` is not on PATH in CI, but checkDockerStatus() must swallow
    // errors and return { available: false }.
    const status = await DockerBridge.checkDockerStatus();
    expect(status).toBeDefined();
  });
});

describe('Docker path translation', () => {
  // We test toContainerPath through a static helper. Since the method is
  // private, we exercise it via the public bridge by injecting a config and
  // inspecting the request the bridge would send.
  //
  // Approach: create a bridge, manually set the private `config` field via
  // any-cast, then use reflection-light access through `as unknown as ...`.
  // This is acceptable because toContainerPath has no side-effects.

  function makeBridge() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = new DockerBridge() as any;
    b.config = { workspacePath: '/home/alice/project' };
    return b;
  }

  it('rewrites workspace-prefixed paths to /workspace/...', () => {
    const b = makeBridge();
    expect(b.toContainerPath('/home/alice/project')).toBe('/workspace');
    expect(b.toContainerPath('/home/alice/project/src')).toBe('/workspace/src');
    expect(b.toContainerPath('/home/alice/project/notes.md')).toBe('/workspace/notes.md');
  });

  it('leaves container-native paths untouched', () => {
    const b = makeBridge();
    expect(b.toContainerPath('/tmp/scratch')).toBe('/tmp/scratch');
    expect(b.toContainerPath('/usr/bin/node')).toBe('/usr/bin/node');
  });

  it('returns the input as-is when it does not match the workspace root', () => {
    const b = makeBridge();
    expect(b.toContainerPath('/etc/hosts')).toBe('/etc/hosts');
    expect(b.toContainerPath('')).toBe('');
  });
});
