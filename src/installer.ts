import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface InstallerPaths {
  settings_path: string;
  marker_path: string;
}

const HOOK_MATCHER = '*';

export function defaultPaths(): InstallerPaths {
  return {
    settings_path: resolve(homedir(), '.claude', 'settings.json'),
    marker_path: resolve(homedir(), '.hippocampus', '.installed'),
  };
}

export const HOOK_SENTINEL = 'HIPPOCAMPUS_MCP_HOOK=1';

export function buildHookCommand(scriptPath: string): string {
  return `${HOOK_SENTINEL} "${process.execPath}" "${scriptPath}" --precompact`;
}

export function resolveEntrypoint(): string {
  const raw = process.argv[1];
  if (!raw) throw new Error('cannot resolve entrypoint (process.argv[1] empty)');
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

export function isHippocampusHook(cmd: string): boolean {
  if (!cmd.includes('--precompact')) return false;
  return (
    cmd.includes(HOOK_SENTINEL) ||
    cmd.includes('hippocampus-mcp') ||
    cmd.includes('@julskim/hippocampus-mcp')
  );
}

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

export type InstallResult = 'installed' | 'updated' | 'skipped';

export function install(
  paths: InstallerPaths = defaultPaths(),
  entrypoint: string = resolveEntrypoint(),
): InstallResult {
  const desiredCommand = buildHookCommand(entrypoint);
  const settings = readSettings(paths.settings_path);
  const { settings: updated, outcome } = mergeHook(settings, desiredCommand);

  if (outcome === 'skipped') {
    writeMarker(paths.marker_path);
    return 'skipped';
  }

  writeSettingsAtomic(paths.settings_path, updated);
  writeMarker(paths.marker_path);
  return outcome;
}

export function run(paths: InstallerPaths = defaultPaths()): void {
  let entrypoint: string;
  try {
    entrypoint = resolveEntrypoint();
  } catch (err) {
    process.stderr.write(
      `[hippocampus-mcp] ✗ Install skipped: ${(err as Error).message}\n`,
    );
    return;
  }

  try {
    const result = install(paths, entrypoint);
    if (result === 'installed') {
      process.stderr.write(
        `[hippocampus-mcp] ✓ PreCompact hook installed at ${paths.settings_path}\n`,
      );
    } else if (result === 'updated') {
      process.stderr.write(
        `[hippocampus-mcp] ✓ PreCompact hook updated (entrypoint path refreshed)\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[hippocampus-mcp] ✗ Install failed: ${(err as Error).message}\n`,
    );
  }
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

export function mergeHook(
  settings: Settings,
  desiredCommand: string,
): { settings: Settings; outcome: InstallResult } {
  const next: Settings = { ...settings };
  const hooks = { ...(next.hooks ?? {}) };
  const existing = hooks.PreCompact ?? [];

  const foreign: HookMatcher[] = [];
  const hippocampusCommands: string[] = [];

  for (const entry of existing) {
    const ownHooks = entry.hooks ?? [];
    const retainedHooks: HookCommand[] = [];
    for (const h of ownHooks) {
      if (isHippocampusHook(h.command)) {
        hippocampusCommands.push(h.command);
      } else {
        retainedHooks.push(h);
      }
    }
    if (retainedHooks.length > 0) {
      foreign.push({ ...entry, hooks: retainedHooks });
    }
  }

  const alreadyCorrect =
    hippocampusCommands.length === 1 && hippocampusCommands[0] === desiredCommand;

  if (alreadyCorrect) {
    return { settings, outcome: 'skipped' };
  }

  const preCompact: HookMatcher[] = [
    ...foreign,
    {
      matcher: HOOK_MATCHER,
      hooks: [{ type: 'command', command: desiredCommand }],
    },
  ];

  hooks.PreCompact = preCompact;
  next.hooks = hooks;

  const outcome: InstallResult = hippocampusCommands.length === 0 ? 'installed' : 'updated';
  return { settings: next, outcome };
}

function writeSettingsAtomic(path: string, data: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmp, path);
}

function writeMarker(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date().toISOString(), 'utf-8');
}
