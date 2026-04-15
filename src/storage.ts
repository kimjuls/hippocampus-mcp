import { writeFileSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
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
};

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

    return {
      current_task: session.current_task,
      next_step: session.next_step,
      journey,
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
