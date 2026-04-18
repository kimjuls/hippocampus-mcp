import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildHookCommand,
  install,
  isHippocampusHook,
  mergeHook,
} from '../src/installer.js';

let tmpDir: string;
const FIXTURE_ENTRYPOINT = '/fake/path/to/dist/index.js';
const FIXTURE_CMD = buildHookCommand(FIXTURE_ENTRYPOINT);

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

describe('buildHookCommand', () => {
  it('produces node absolute-path invocation with quoted paths', () => {
    const cmd = buildHookCommand('/opt/app/dist/index.js');
    expect(cmd).toContain(`"${process.execPath}"`);
    expect(cmd).toContain('"/opt/app/dist/index.js"');
    expect(cmd.endsWith(' --precompact')).toBe(true);
  });
});

describe('isHippocampusHook', () => {
  it('matches legacy npx command', () => {
    expect(isHippocampusHook('npx -y @julskim/hippocampus-mcp --precompact')).toBe(true);
  });

  it('matches node absolute-path command', () => {
    expect(
      isHippocampusHook('"/usr/bin/node" "/opt/hippocampus-mcp/dist/index.js" --precompact'),
    ).toBe(true);
  });

  it('rejects unrelated commands', () => {
    expect(isHippocampusHook('npx other --precompact')).toBe(false);
    expect(isHippocampusHook('hippocampus-mcp serve')).toBe(false);
  });
});

describe('mergeHook', () => {
  it('installs into empty settings', () => {
    const { settings, outcome } = mergeHook({}, FIXTURE_CMD);
    expect(outcome).toBe('installed');
    expect(settings.hooks?.PreCompact).toHaveLength(1);
    expect(settings.hooks!.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('preserves unrelated top-level keys', () => {
    const { settings } = mergeHook({ theme: 'dark', model: 'opus' }, FIXTURE_CMD);
    expect(settings.theme).toBe('dark');
    expect(settings.model).toBe('opus');
  });

  it('upgrades legacy npx command to node absolute-path command', () => {
    const legacy = {
      hooks: {
        PreCompact: [
          {
            matcher: '*',
            hooks: [
              { type: 'command' as const, command: 'npx -y @julskim/hippocampus-mcp --precompact' },
            ],
          },
        ],
      },
    };
    const { settings, outcome } = mergeHook(legacy, FIXTURE_CMD);
    expect(outcome).toBe('updated');
    expect(settings.hooks!.PreCompact).toHaveLength(1);
    expect(settings.hooks!.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('returns skipped when desired command already present alone', () => {
    const current = {
      hooks: {
        PreCompact: [
          { matcher: '*', hooks: [{ type: 'command' as const, command: FIXTURE_CMD }] },
        ],
      },
    };
    const { outcome } = mergeHook(current, FIXTURE_CMD);
    expect(outcome).toBe('skipped');
  });

  it('converges duplicate hippocampus entries into one', () => {
    const dup = {
      hooks: {
        PreCompact: [
          {
            matcher: '*',
            hooks: [
              { type: 'command' as const, command: 'npx -y @julskim/hippocampus-mcp --precompact' },
            ],
          },
          {
            matcher: 'auto',
            hooks: [
              {
                type: 'command' as const,
                command:
                  '"/old/node" "/old/node_modules/@julskim/hippocampus-mcp/dist/index.js" --precompact',
              },
            ],
          },
        ],
      },
    };
    const { settings, outcome } = mergeHook(dup, FIXTURE_CMD);
    expect(outcome).toBe('updated');
    expect(settings.hooks!.PreCompact).toHaveLength(1);
    expect(settings.hooks!.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('preserves foreign PreCompact entries alongside hippocampus entry', () => {
    const mixed = {
      hooks: {
        PreCompact: [
          {
            matcher: 'auto',
            hooks: [{ type: 'command' as const, command: 'other-tool --flag' }],
          },
        ],
      },
    };
    const { settings, outcome } = mergeHook(mixed, FIXTURE_CMD);
    expect(outcome).toBe('installed');
    expect(settings.hooks!.PreCompact).toHaveLength(2);
    const commands = settings.hooks!.PreCompact.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toContain('other-tool --flag');
    expect(commands).toContain(FIXTURE_CMD);
  });

  it('strips hippocampus entry from mixed-hook group without touching siblings', () => {
    const mixed = {
      hooks: {
        PreCompact: [
          {
            matcher: '*',
            hooks: [
              { type: 'command' as const, command: 'sibling-tool' },
              { type: 'command' as const, command: 'npx -y @julskim/hippocampus-mcp --precompact' },
            ],
          },
        ],
      },
    };
    const { settings, outcome } = mergeHook(mixed, FIXTURE_CMD);
    expect(outcome).toBe('updated');
    const all = settings.hooks!.PreCompact.flatMap((e) => e.hooks.map((h) => h.command));
    expect(all).toContain('sibling-tool');
    expect(all).toContain(FIXTURE_CMD);
    expect(all.filter((c) => c === 'sibling-tool')).toHaveLength(1);
  });

  it('preserves other hook categories', () => {
    const existing = {
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command' as const, command: 'lint' }] }],
      },
    };
    const { settings } = mergeHook(existing, FIXTURE_CMD);
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
    expect(settings.hooks!.PreCompact).toHaveLength(1);
  });
});

describe('install', () => {
  it('creates settings.json and marker on first run', () => {
    const p = paths();
    const result = install(p, FIXTURE_ENTRYPOINT);

    expect(result).toBe('installed');
    expect(existsSync(p.settings_path)).toBe(true);
    expect(existsSync(p.marker_path)).toBe(true);

    const settings = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('returns updated when prior hippocampus command differs', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'claude'), { recursive: true });
    writeFileSync(
      p.settings_path,
      JSON.stringify({
        hooks: {
          PreCompact: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'npx -y @julskim/hippocampus-mcp --precompact',
                },
              ],
            },
          ],
        },
      }),
    );

    const result = install(p, FIXTURE_ENTRYPOINT);
    expect(result).toBe('updated');
    const settings = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('skips when hook already points to current entrypoint', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'claude'), { recursive: true });
    const settingsBefore = {
      hooks: {
        PreCompact: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: FIXTURE_CMD }],
          },
        ],
      },
    };
    writeFileSync(p.settings_path, JSON.stringify(settingsBefore));

    const result = install(p, FIXTURE_ENTRYPOINT);
    expect(result).toBe('skipped');
    expect(existsSync(p.marker_path)).toBe(true);

    const settingsAfter = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settingsAfter).toEqual(settingsBefore);
  });

  it('merges into existing settings.json without overwriting other keys', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'claude'), { recursive: true });
    writeFileSync(
      p.settings_path,
      JSON.stringify({ theme: 'dark', env: { DEBUG: 'true' } }),
    );

    install(p, FIXTURE_ENTRYPOINT);

    const settings = JSON.parse(readFileSync(p.settings_path, 'utf-8'));
    expect(settings.theme).toBe('dark');
    expect(settings.env.DEBUG).toBe('true');
    expect(settings.hooks.PreCompact[0].hooks[0].command).toBe(FIXTURE_CMD);
  });

  it('writes marker even when skipped so startup breadcrumb stays fresh', () => {
    const p = paths();
    mkdirSync(resolve(tmpDir, 'claude'), { recursive: true });
    writeFileSync(
      p.settings_path,
      JSON.stringify({
        hooks: {
          PreCompact: [
            { matcher: '*', hooks: [{ type: 'command', command: FIXTURE_CMD }] },
          ],
        },
      }),
    );

    install(p, FIXTURE_ENTRYPOINT);
    expect(existsSync(p.marker_path)).toBe(true);
  });
});
