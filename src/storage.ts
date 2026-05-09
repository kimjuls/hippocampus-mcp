import { writeFileSync, readFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import type {
  StorageConfig,
  SessionMemory,
  MemoryEntry,
  MemoryView,
  MemoryViewEntry,
  GCResult,
  SaveMemoryInput,
  SaveResult,
  SessionSummary,
  StorageFile,
  CompactSnapshot,
} from './types.js';

const DEFAULT_CONFIG: StorageConfig = {
  persist: true,
  storage_path: resolve(homedir(), '.hippocampus', 'memory.json'),
  max_sessions: 20,
  gc: {
    minor_compress_after: 5,
    minor_delete_after: 15,
    major_compress_after: 10,
    max_entries: 30,
  },
  compact_tail_n: 20,
};

// Per-line ceiling for a synthesized tail entry. Sized to fit roughly 2-3
// substantive blocks per turn (~200 chars each) plus small markers, so the
// post-compact journey view stays bounded even on chatty turns.
const MAX_TAIL_LINE_CHARS = 480;
const MAX_BLOCK_TEXT_CHARS = 200;
const MAX_TOOL_USE_INPUT_CHARS = 120;
const MAX_THINKING_CHARS = 160;

// Whitelist of substantive transcript turn types. Meta JSONL entries
// (custom-title, last-prompt, file-history-snapshot, etc.) are excluded so
// they cannot consume tail slots and push real turns out of the window.
const SUBSTANTIVE_TYPES = new Set(['user', 'assistant']);

interface TranscriptEntry {
  type?: string;
  message?: {
    content?: unknown;
  };
}

export function readTranscriptTail(path: string, n: number): string[] {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const entries: TranscriptEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const parsed = tryParseTranscriptLine(trimmed);
      if (!parsed) continue;
      if (typeof parsed.type !== 'string') continue;
      if (!SUBSTANTIVE_TYPES.has(parsed.type)) continue;
      entries.push(parsed);
    }
    return entries.slice(-n).map(summarizeTranscriptEntry);
  } catch {
    return [];
  }
}

function tryParseTranscriptLine(line: string): TranscriptEntry | null {
  try {
    const obj = JSON.parse(line);
    return obj && typeof obj === 'object' ? (obj as TranscriptEntry) : null;
  } catch {
    return null;
  }
}

function summarizeTranscriptEntry(entry: TranscriptEntry): string {
  if (entry.type === 'user') {
    return capLine(`[user] ${summarizeUserContent(entry.message?.content)}`);
  }
  if (entry.type === 'assistant') {
    return capLine(`[assistant] ${summarizeAssistantContent(entry.message?.content)}`);
  }
  // Unreachable in practice: readTranscriptTail filters on type. Kept as a
  // clear marker if the whitelist ever broadens.
  return capLine(`[${entry.type ?? 'unknown'}]`);
}

function summarizeUserContent(content: unknown): string {
  // Plain-string content (legacy / simple fixtures).
  if (typeof content === 'string') return truncate(content, MAX_BLOCK_TEXT_CHARS);
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: unknown; content?: unknown };
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(truncate(b.text, MAX_BLOCK_TEXT_CHARS));
    } else if (b.type === 'tool_result') {
      const excerpt = extractToolResultText(b.content);
      parts.push(
        excerpt
          ? `[tool_result] "${truncate(excerpt, MAX_BLOCK_TEXT_CHARS)}"`
          : '[tool_result]',
      );
    }
  }
  return parts.join(' ');
}

function summarizeAssistantContent(content: unknown): string {
  if (typeof content === 'string') return truncate(content, MAX_BLOCK_TEXT_CHARS);
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as {
      type?: string;
      text?: unknown;
      thinking?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(truncate(b.text, MAX_BLOCK_TEXT_CHARS));
    } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
      parts.push(`[thinking] ${truncate(b.thinking, MAX_THINKING_CHARS)}`);
    } else if (b.type === 'tool_use') {
      const name = typeof b.name === 'string' ? b.name : '?';
      const inputExcerpt = formatToolUseInput(name, b.input);
      parts.push(inputExcerpt ? `[tool_use:${name} ${inputExcerpt}]` : `[tool_use:${name}]`);
    }
  }
  return parts.join(' ');
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: unknown };
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    }
    return texts.join(' ');
  }
  return '';
}

function formatToolUseInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;

  // Prefer a known descriptive field per tool so the breadcrumb is readable.
  for (const field of preferredFieldsFor(toolName)) {
    const value = obj[field];
    if (typeof value === 'string' && value.length > 0) {
      return `${field}=${JSON.stringify(truncate(value, MAX_TOOL_USE_INPUT_CHARS))}`;
    }
  }

  // Fallback: single-line JSON excerpt of the whole input.
  const json = JSON.stringify(obj);
  if (!json || json === '{}') return '';
  return truncate(json.replace(/\s+/g, ' '), MAX_TOOL_USE_INPUT_CHARS);
}

function preferredFieldsFor(toolName: string): readonly string[] {
  switch (toolName) {
    case 'Bash':
      return ['command'];
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return ['file_path'];
    case 'Grep':
    case 'Glob':
      return ['pattern'];
    case 'WebFetch':
      return ['url'];
    case 'WebSearch':
      return ['query'];
    default:
      return [];
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function capLine(line: string): string {
  return truncate(line, MAX_TAIL_LINE_CHARS);
}

export class MemoryStore {
  private sessions = new Map<string, SessionMemory>();
  readonly config: StorageConfig;

  constructor(config?: Partial<StorageConfig> & { gc?: Partial<StorageConfig['gc']> }) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      gc: { ...DEFAULT_CONFIG.gc, ...config?.gc },
    };
    this.restore();
  }

  save(input: SaveMemoryInput): SaveResult {
    let session = this.sessions.get(input.session_id);
    if (!session) {
      session = {
        session_id: input.session_id,
        project_dir: input.project_dir,
        current_task: input.current_task,
        next_step: input.next_step,
        journey: [],
        sequence: 0,
      };
      this.sessions.set(input.session_id, session);
    }

    session.current_task = input.current_task;
    session.next_step = input.next_step;
    session.project_dir = input.project_dir;

    let snapshotId: string | null = null;

    if (input.event) {
      session.sequence++;
      const entry: MemoryEntry = {
        id: nanoid(8),
        sequence: session.sequence,
        importance: input.event.importance,
        detail: input.event.detail,
        summary: input.event.summary,
      };
      session.journey.push(entry);
      snapshotId = entry.id;
    }

    this.enforceMaxSessions(input.session_id);
    const gcResult = this.gc(input.session_id);
    this.persist();

    return {
      snapshot_id: snapshotId,
      sequence: session.sequence,
      journey_count: session.journey.length,
      gc_result: gcResult,
    };
  }

  load(sessionId: string): MemoryView | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    this.gc(sessionId);
    this.persist();

    return this.buildView(session);
  }

  list(sessionId?: string): SessionSummary[] {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return [];
      return [this.buildSummary(session)];
    }

    return Array.from(this.sessions.values()).map((s) => this.buildSummary(s));
  }

  recordCompactSnapshot(snapshot: CompactSnapshot): void {
    let session = this.sessions.get(snapshot.session_id);
    if (!session) {
      session = {
        session_id: snapshot.session_id,
        project_dir: '',
        current_task: '',
        next_step: '',
        journey: [],
        sequence: 0,
      };
      this.sessions.set(snapshot.session_id, session);
    }
    session.last_compact = snapshot;
    this.enforceMaxSessions(snapshot.session_id);
    this.persist();
  }

  delete(sessionId: string, entryId?: string): boolean {
    if (!entryId) {
      const existed = this.sessions.delete(sessionId);
      if (existed) this.persist();
      return existed;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const idx = session.journey.findIndex((e) => e.id === entryId);
    if (idx === -1) return false;

    session.journey.splice(idx, 1);
    this.persist();
    return true;
  }

  gc(sessionId: string): GCResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { compressed: 0, deleted: 0 };

    const { minor_compress_after, minor_delete_after, major_compress_after, max_entries } =
      this.config.gc;
    const currentSeq = session.sequence;

    let deleted = 0;

    session.journey = session.journey.filter((entry) => {
      const age = currentSeq - entry.sequence;
      if (entry.importance === 'minor' && age >= minor_delete_after) {
        deleted++;
        return false;
      }
      return true;
    });

    while (session.journey.length > max_entries) {
      const minorIdx = this.findOldestMinor(session.journey);
      if (minorIdx !== -1) {
        session.journey.splice(minorIdx, 1);
        deleted++;
        continue;
      }
      session.journey.shift();
      deleted++;
    }

    let compressed = 0;
    for (const entry of session.journey) {
      const age = currentSeq - entry.sequence;
      const threshold =
        entry.importance === 'minor' ? minor_compress_after : major_compress_after;
      if (age >= threshold) {
        compressed++;
      }
    }

    return { compressed, deleted };
  }

  persist(): void {
    if (!this.config.persist) return;

    const data: StorageFile = {
      version: 1,
      sessions: Object.fromEntries(this.sessions),
    };

    const filePath = this.config.storage_path;
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  restore(): void {
    if (!this.config.persist) return;

    try {
      const raw = readFileSync(this.config.storage_path, 'utf-8');
      const data: StorageFile = JSON.parse(raw);
      if (data.version === 1) {
        this.sessions = new Map(Object.entries(data.sessions));
      }
    } catch {
      // No file or parse error — start fresh
    }
  }

  private buildView(session: SessionMemory): MemoryView {
    const { minor_compress_after, major_compress_after } = this.config.gc;
    const currentSeq = session.sequence;

    const journey: MemoryViewEntry[] = session.journey.map((entry) => {
      const age = currentSeq - entry.sequence;
      const threshold =
        entry.importance === 'minor' ? minor_compress_after : major_compress_after;

      return {
        id: entry.id,
        content: age >= threshold ? entry.summary : entry.detail,
        importance: entry.importance,
        age,
      };
    });

    if (session.last_compact) {
      const tail = readTranscriptTail(session.last_compact.transcript_path, this.config.compact_tail_n);
      for (let i = 0; i < tail.length; i++) {
        journey.push({
          id: `tail-${i}`,
          content: tail[i],
          importance: 'minor',
          age: 0,
        });
      }
    }

    return {
      current_task: session.current_task,
      next_step: session.next_step,
      journey,
      last_compact: session.last_compact,
    };
  }

  private buildSummary(session: SessionMemory): SessionSummary {
    return {
      session_id: session.session_id,
      project_dir: session.project_dir,
      current_task: session.current_task,
      journey_count: session.journey.length,
      sequence: session.sequence,
    };
  }

  private findOldestMinor(journey: MemoryEntry[]): number {
    for (let i = 0; i < journey.length; i++) {
      if (journey[i].importance === 'minor') return i;
    }
    return -1;
  }

  private enforceMaxSessions(currentSessionId: string): void {
    while (this.sessions.size > this.config.max_sessions) {
      let targetKey: string | null = null;
      for (const key of this.sessions.keys()) {
        if (key !== currentSessionId) {
          targetKey = key;
          break;
        }
      }
      if (targetKey) {
        this.sessions.delete(targetKey);
      } else {
        break;
      }
    }
  }
}
