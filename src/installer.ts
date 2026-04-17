import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface InstallerPaths {
  settings_path: string;
  marker_path: string;
}

export const HOOK_COMMAND = 'npx -y @julskim/hippocampus-mcp --precompact';
const HOOK_MATCHER = '*';

export function defaultPaths(): InstallerPaths {
  return {
    settings_path: resolve(homedir(), '.claude', 'settings.json'),
    marker_path: resolve(homedir(), '.hippocampus', '.installed'),
  };
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

export function isInstalled(paths: InstallerPaths = defaultPaths()): boolean {
  return existsSync(paths.marker_path);
}

export function install(paths: InstallerPaths = defaultPaths()): 'installed' | 'skipped' {
  if (isInstalled(paths)) return 'skipped';

  const settings = readSettings(paths.settings_path);
  const updated = mergeHook(settings);

  writeSettingsAtomic(paths.settings_path, updated);
  writeMarker(paths.marker_path);

  return 'installed';
}

export function run(paths: InstallerPaths = defaultPaths()): void {
  if (isInstalled(paths)) return;

  process.stderr.write(
    `[hippocampus-mcp] ⚠️  First-run: installing PreCompact hook to ${paths.settings_path}\n`,
  );

  try {
    const result = install(paths);
    if (result === 'installed') {
      process.stderr.write(
        `[hippocampus-mcp] ✓ Installed (delete ${paths.marker_path} to re-run setup)\n`,
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

export function mergeHook(settings: Settings): Settings {
  const next: Settings = { ...settings };
  const hooks = { ...(next.hooks ?? {}) };
  const preCompact = [...(hooks.PreCompact ?? [])];

  const alreadyPresent = preCompact.some((entry) =>
    entry.hooks?.some((h) => h.command === HOOK_COMMAND),
  );

  if (!alreadyPresent) {
    preCompact.push({
      matcher: HOOK_MATCHER,
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
  }

  hooks.PreCompact = preCompact;
  next.hooks = hooks;
  return next;
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
