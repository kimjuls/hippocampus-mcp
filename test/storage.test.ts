import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../src/storage.js';

function createStore(gcOverrides?: Partial<ConstructorParameters<typeof MemoryStore>[0] & { gc?: Record<string, number> }>) {
  return new MemoryStore({
    persist: false,
    ...gcOverrides,
  });
}

const SESSION = 'test-session';
const PROJECT = '/tmp/test-project';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = createStore();
  });

  describe('save', () => {
    it('current_task와 next_step을 저장한다', () => {
      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: '인증 구현',
        next_step: '테스트 작성',
      });

      const view = store.load(SESSION);
      expect(view).not.toBeNull();
      expect(view!.current_task).toBe('인증 구현');
      expect(view!.next_step).toBe('테스트 작성');
    });

    it('event 없이 호출하면 journey에 추가하지 않는다', () => {
      const result = store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: '작업 중',
        next_step: '다음',
      });

      expect(result.snapshot_id).toBeNull();
      expect(result.journey_count).toBe(0);
    });

    it('event가 있으면 journey에 추가하고 시퀀스를 증가시킨다', () => {
      const result = store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: '작업 중',
        next_step: '다음',
        event: {
          importance: 'major',
          detail: 'JWT 인증 구현 완료',
          summary: '인증 완료',
        },
      });

      expect(result.snapshot_id).toBeTruthy();
      expect(result.sequence).toBe(1);
      expect(result.journey_count).toBe(1);
    });

    it('current_task와 next_step은 항상 덮어쓴다', () => {
      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: '첫 번째',
        next_step: '첫 번째 다음',
      });

      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: '두 번째',
        next_step: '두 번째 다음',
      });

      const view = store.load(SESSION);
      expect(view!.current_task).toBe('두 번째');
      expect(view!.next_step).toBe('두 번째 다음');
    });
  });

  describe('load', () => {
    it('존재하지 않는 세션은 null을 반환한다', () => {
      expect(store.load('nonexistent')).toBeNull();
    });

    it('journey의 content는 age에 따라 detail 또는 summary를 반환한다', () => {
      // minor_compress_after 기본값 5, major_compress_after 기본값 10
      store = createStore({
        gc: { minor_compress_after: 2, minor_delete_after: 100, major_compress_after: 3, max_entries: 30 },
      });

      // seq 1: minor
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'minor 상세', summary: 'minor 요약' },
      });
      // seq 2: major
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: 'major 상세', summary: 'major 요약' },
      });

      // seq=2 시점: minor(seq1) age=1 < 2 → detail, major(seq2) age=0 < 3 → detail
      let view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('minor 상세');
      expect(view.journey[1].content).toBe('major 상세');

      // seq 3, 4 추가해서 age를 올린다
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'd3', summary: 's3' },
      });
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'd4', summary: 's4' },
      });

      // seq=4: minor(seq1) age=3 ≥ 2 → summary, major(seq2) age=2 < 3 → detail
      view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('minor 요약');
      expect(view.journey[1].content).toBe('major 상세');

      // 1개 더 추가
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'd5', summary: 's5' },
      });

      // seq=5: major(seq2) age=3 ≥ 3 → summary
      view = store.load(SESSION)!;
      expect(view.journey[1].content).toBe('major 요약');
    });
  });

  describe('GC — minor 삭제', () => {
    it('minor는 minor_delete_after 사이클 후 삭제된다', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 3, major_compress_after: 10, max_entries: 30 },
      });

      // seq 1: minor
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: '사소한 작업', summary: '사소' },
      });

      // seq 2, 3, 4 추가
      for (let i = 0; i < 3; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'major', detail: `major${i}`, summary: `m${i}` },
        });
      }

      // seq=4: minor(seq1) age=3 ≥ 3 → 삭제
      const view = store.load(SESSION)!;
      const hasMinor = view.journey.some((e) => e.content === '사소');
      expect(hasMinor).toBe(false);
      expect(view.journey.length).toBe(3); // major 3개만
    });
  });

  describe('GC — major는 age로 삭제되지 않는다', () => {
    it('major는 아무리 오래되어도 age 기반으로는 삭제되지 않는다', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 3, major_compress_after: 2, max_entries: 30 },
      });

      // seq 1: major
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: '아키텍처 결정', summary: '결정' },
      });

      // seq 2~20 추가
      for (let i = 0; i < 19; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'major', detail: `major${i}`, summary: `m${i}` },
        });
      }

      // seq=20: major(seq1) age=19 — 여전히 존재
      const view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('결정'); // summary로 표시
      expect(view.journey.length).toBe(20);
    });
  });

  describe('GC — 용량 제한', () => {
    it('max_entries 초과 시 minor를 먼저 삭제한다', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 100, major_compress_after: 1, max_entries: 5 },
      });

      // minor 3개 + major 3개 = 6개 (max 5 초과)
      for (let i = 0; i < 3; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'minor', detail: `minor${i}`, summary: `m${i}` },
        });
      }
      for (let i = 0; i < 3; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'major', detail: `major${i}`, summary: `M${i}` },
        });
      }

      const view = store.load(SESSION)!;
      expect(view.journey.length).toBeLessThanOrEqual(5);

      // minor가 먼저 삭제되었는지 확인
      const minorCount = view.journey.filter((e) => e.importance === 'minor').length;
      const majorCount = view.journey.filter((e) => e.importance === 'major').length;
      expect(majorCount).toBe(3); // major는 모두 유지
      expect(minorCount).toBeLessThanOrEqual(2); // minor 중 일부 삭제
    });
  });

  describe('list', () => {
    it('전체 세션 목록을 반환한다', () => {
      store.save({ session_id: 'a', project_dir: '/a', current_task: 'ta', next_step: 'na' });
      store.save({ session_id: 'b', project_dir: '/b', current_task: 'tb', next_step: 'nb' });

      const list = store.list();
      expect(list.length).toBe(2);
      expect(list.map((s) => s.session_id).sort()).toEqual(['a', 'b']);
    });

    it('특정 세션만 조회한다', () => {
      store.save({ session_id: 'a', project_dir: '/a', current_task: 'ta', next_step: 'na' });
      store.save({ session_id: 'b', project_dir: '/b', current_task: 'tb', next_step: 'nb' });

      const list = store.list('a');
      expect(list.length).toBe(1);
      expect(list[0].session_id).toBe('a');
    });
  });

  describe('delete', () => {
    it('세션 전체를 삭제한다', () => {
      store.save({ session_id: SESSION, project_dir: PROJECT, current_task: 't', next_step: 'n' });
      expect(store.delete(SESSION)).toBe(true);
      expect(store.load(SESSION)).toBeNull();
    });

    it('특정 항목을 삭제한다', () => {
      const result = store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: '삭제 대상', summary: '삭제' },
      });

      expect(store.delete(SESSION, result.snapshot_id!)).toBe(true);
      const view = store.load(SESSION)!;
      expect(view.journey.length).toBe(0);
    });

    it('존재하지 않는 항목 삭제 시 false를 반환한다', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('세션 수 제한', () => {
    it('max_sessions 초과 시 가장 오래된 세션이 삭제된다', () => {
      store = createStore({ max_sessions: 3 });

      for (let i = 0; i < 4; i++) {
        store.save({
          session_id: `session-${i}`, project_dir: PROJECT,
          current_task: `task-${i}`, next_step: 'n',
          event: { importance: 'major', detail: `d${i}`, summary: `s${i}` },
        });
      }

      const list = store.list();
      expect(list.length).toBe(3);
      // session-0 (가장 오래된)이 삭제됨
      expect(list.find((s) => s.session_id === 'session-0')).toBeUndefined();
    });
  });
});
