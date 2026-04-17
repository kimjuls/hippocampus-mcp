import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HOOK_COMMAND, install, isInstalled, mergeHook } from '../src/installer.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hippocampus-installer-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function paths() {
  return {
    settings_path: resolve(tmpDir, 'claude', 'settings.json'),
    marker_path: resolve(tmpDir, 'hippocampus', '.installed'),
  };
}

describe('mergeHook', () => {
  it('adds PreCompact hook to empty settings', () => {
    const result = mergeHook({});
    expect(result.hooks?.PreCompact).toHaveLength(1);
    expect(result.hooks!.PreCompact[0].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('preserves existing unrelated keys', () => {
    const result = mergeHook({ theme: 'dark', model: 'opus' });
    expect(result.theme).toBe('dark');
    expect(result.model).toBe('opus');
    expect(result.hooks?.PreCompact).toBeDefined();
  });

  it('preserves existing PreCompact entries', () => {
    const existing = {
      hooks: {
        PreCompact: [
          { matcher: 'auto', hooks: [{ type: 'command' as const, command: 'custom-tool' }] },
        ],
      },
    };
    const result = mergeHook(existing);
    expect(result.hooks!.PreCompact).toHaveLength(2);
    expect(result.hooks!.PreCompact[0].hooks[0].command).toBe('custom-tool');
    expect(result.hooks!.PreCompact[1].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('preserves other hook categories', () => {
    const existing = {
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command' as const, command: 'lint' }] }],
      },
    };
    const result = mergeHook(existing);
    expect(result.hooks!.PostToolUse).toHaveLength(1);
    expect(result.hooks!.PreCompact).toHaveLength(1);
  });

  it('does not duplicate when hippocampus hook already present', () => {
    const existing = {
      hooks: {
        PreCompact: [
          { matcher: '*', hooks: [{ type: 'command' as const, command: HOOK_COMMAND }] },
        ],
      },
    };
    const result = mergeHook(existing);
    expect(result.hooks!.PreCompact).toHaveLength(1);
  });
});

describe('install', () => {
  it('creates settings.json and marker on first run', () => {
    const p = paths();
    const result = install(p);

    expect(result).toBe('installed');
    expect(existsSync(p.settings_path)).toBe(true);
    expect(existsSync(p.marker_path)).toBe(true);

    const settings = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('skips when marker exists', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'hippocampus'), { recursive: true });
    writeFileSync(p.marker_path, 'already installed');

    const result = install(p);
    expect(result).toBe('skipped');
    expect(existsSync(p.settings_path)).toBe(false);
  });

  it('merges into existing settings.json without overwriting', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'claude'), { recursive: true });
    writeFileSync(
      p.settings_path,
      JSON.stringify({ theme: 'dark', env: { DEBUG: 'true' } }),
    );

    install(p);

    const settings = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.env.DEBUG).toBe('true');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(HOOK_COMMAND);
  });
});

describe('isInstalled', () => {
  it('returns false when marker absent', () => {
    expect(isInstalled(paths())).toBe(false);
  });

  it('returns true when marker present', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'hippocampus'), { recursive: true });
    writeFileSync(p.marker_path, '');
    expect(isInstalled(p)).toBe(true);
  });
});
