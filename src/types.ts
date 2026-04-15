export interface MemoryEntry {
  id: string;
  sequence: number;
  importance: 'major' | 'minor';
  detail: string;
  summary: string;
}

export interface SessionMemory {
  session_id: string;
  project_dir: string;
  current_task: string;
  next_step: string;
  journey: MemoryEntry[];
  sequence: number;
}

export interface MemoryView {
  current_task: string;
  next_step: string;
  journey: MemoryViewEntry[];
}

export interface MemoryViewEntry {
  id: string;
  content: string;
  importance: 'major' | 'minor';
  age: number;
}

export interface GCConfig {
  minor_compress_after: number;
  minor_delete_after: number;
  major_compress_after: number;
  max_entries: number;
}

export interface StorageConfig {
  persist: boolean;
  storage_path: string;
  max_sessions: number;
  gc: GCConfig;
}

export interface StorageFile {
  version: 1;
  sessions: Record<string, SessionMemory>;
}

export interface GCResult {
  compressed: number;
  deleted: number;
}

export interface SaveMemoryInput {
  session_id: string;
  project_dir: string;
  current_task: string;
  next_step: string;
  event?: {
    importance: 'major' | 'minor';
    detail: string;
    summary: string;
  };
}

export interface SaveResult {
  snapshot_id: string | null;
  sequence: number;
  journey_count: number;
  gc_result: GCResult;
}

export interface SessionSummary {
  session_id: string;
  project_dir: string;
  current_task: string;
  journey_count: number;
  sequence: number;
}
