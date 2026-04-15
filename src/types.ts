/** 마일스톤 항목 — journey 내 개별 기억 */
export interface MemoryEntry {
  id: string;
  sequence: number;
  importance: 'major' | 'minor';
  /** 상세 기록 (Claude 작성, 신선한 상태에서 노출) */
  detail: string;
  /** 압축 기록 (Claude 작성, 오래되면 이쪽이 노출) */
  summary: string;
}

/** 세션 메모리 — MCP 내부 저장 구조 */
export interface SessionMemory {
  session_id: string;
  project_dir: string;
  current_task: string;
  next_step: string;
  journey: MemoryEntry[];
  /** 마일스톤 추가 시마다 증가하는 시퀀스 카운터 */
  sequence: number;
}

/** load_memory 반환 — GC 적용 후 읽기 전용 뷰 */
export interface MemoryView {
  current_task: string;
  next_step: string;
  journey: MemoryViewEntry[];
}

export interface MemoryViewEntry {
  id: string;
  /** age에 따라 detail 또는 summary */
  content: string;
  importance: 'major' | 'minor';
  /** 현재 시퀀스 - 생성 시퀀스 */
  age: number;
}

/** GC 설정 */
export interface GCConfig {
  /** minor detail→summary 전환 사이클 */
  minor_compress_after: number;
  /** minor summary→삭제 사이클 */
  minor_delete_after: number;
  /** major detail→summary 전환 사이클 */
  major_compress_after: number;
  /** 세션당 journey 최대 항목 */
  max_entries: number;
}

/** Storage 설정 */
export interface StorageConfig {
  persist: boolean;
  storage_path: string;
  max_sessions: number;
  gc: GCConfig;
}

/** 파일 저장 형식 */
export interface StorageFile {
  version: 1;
  sessions: Record<string, SessionMemory>;
}

/** GC 실행 결과 */
export interface GCResult {
  compressed: number;
  deleted: number;
}

/** save_memory 입력 */
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

/** save_memory 반환 */
export interface SaveResult {
  snapshot_id: string | null;
  sequence: number;
  journey_count: number;
  gc_result: GCResult;
}

/** 세션 요약 (list용) */
export interface SessionSummary {
  session_id: string;
  project_dir: string;
  current_task: string;
  journey_count: number;
  sequence: number;
}
