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

  /** 마일스톤 기록 + 현재 상태 갱신 */
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

    // 세션 수 제한은 상태 갱신 후 실행 (새 세션의 sequence가 반영된 후)
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

  /** 기억 복원 — GC 적용 후 MemoryView 반환 */
  load(sessionId: string): MemoryView | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    this.gc(sessionId);
    this.persist();

    return this.buildView(session);
  }

  /** 세션 목록 조회 */
  list(sessionId?: string): SessionSummary[] {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return [];
      return [this.buildSummary(session)];
    }

    return Array.from(this.sessions.values()).map((s) => this.buildSummary(s));
  }

  /** 특정 항목 삭제 */
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

  /** GC — age 기반 압축 표시 + 삭제 */
  gc(sessionId: string): GCResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { compressed: 0, deleted: 0 };

    const { minor_compress_after, minor_delete_after, major_compress_after, max_entries } =
      this.config.gc;
    const currentSeq = session.sequence;

    let deleted = 0;

    // age 기반 삭제 (minor만)
    session.journey = session.journey.filter((entry) => {
      const age = currentSeq - entry.sequence;
      if (entry.importance === 'minor' && age >= minor_delete_after) {
        deleted++;
        return false;
      }
      return true;
    });

    // 용량 기반 삭제
    while (session.journey.length > max_entries) {
      // minor summary(오래된 것)부터 삭제
      const minorIdx = this.findOldestMinor(session.journey);
      if (minorIdx !== -1) {
        session.journey.splice(minorIdx, 1);
        deleted++;
        continue;
      }
      // minor 없으면 major 중 가장 오래된 것 삭제
      session.journey.shift();
      deleted++;
    }

    // compressed 카운트: 현재 detail→summary 전환 대상 수
    // (실제 전환은 buildView에서 수행, 내부 데이터는 detail/summary 모두 보존)
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

  /** 파일에 저장 (atomic write) */
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

  /** 파일에서 복원 */
  restore(): void {
    if (!this.config.persist) return;

    try {
      const raw = readFileSync(this.config.storage_path, 'utf-8');
      const data: StorageFile = JSON.parse(raw);
      if (data.version === 1) {
        this.sessions = new Map(Object.entries(data.sessions));
      }
    } catch {
      // 파일 없거나 파싱 실패 — 빈 상태로 시작
    }
  }

  /** MemoryView 생성 — age에 따라 detail/summary 선택 */
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

  /** journey에서 가장 오래된 minor 항목의 인덱스 */
  private findOldestMinor(journey: MemoryEntry[]): number {
    for (let i = 0; i < journey.length; i++) {
      if (journey[i].importance === 'minor') return i;
    }
    return -1;
  }

  /** 세션 수 제한 — 가장 오래된 세션 삭제 (현재 세션 제외) */
  private enforceMaxSessions(currentSessionId: string): void {
    while (this.sessions.size > this.config.max_sessions) {
      // Map은 삽입 순서 보장 — 첫 번째부터 순회하여 현재 세션이 아닌 가장 오래된 것 삭제
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
