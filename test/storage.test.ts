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
    it('saves current_task and next_step', () => {
      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: 'implement auth',
        next_step: 'write tests',
      });

      const view = store.load(SESSION);
      expect(view).not.toBeNull();
      expect(view!.current_task).toBe('implement auth');
      expect(view!.next_step).toBe('write tests');
    });

    it('does not add to journey when called without event', () => {
      const result = store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: 'working',
        next_step: 'next',
      });

      expect(result.snapshot_id).toBeNull();
      expect(result.journey_count).toBe(0);
    });

    it('adds to journey and increments sequence when event is provided', () => {
      const result = store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: 'working',
        next_step: 'next',
        event: {
          importance: 'major',
          detail: 'JWT auth implementation complete',
          summary: 'auth complete',
        },
      });

      expect(result.snapshot_id).toBeTruthy();
      expect(result.sequence).toBe(1);
      expect(result.journey_count).toBe(1);
    });

    it('always overwrites current_task and next_step', () => {
      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: 'first',
        next_step: 'first next',
      });

      store.save({
        session_id: SESSION,
        project_dir: PROJECT,
        current_task: 'second',
        next_step: 'second next',
      });

      const view = store.load(SESSION);
      expect(view!.current_task).toBe('second');
      expect(view!.next_step).toBe('second next');
    });
  });

  describe('load', () => {
    it('returns null for nonexistent session', () => {
      expect(store.load('nonexistent')).toBeNull();
    });

    it('returns detail or summary for journey content based on age', () => {
      store = createStore({
        gc: { minor_compress_after: 2, minor_delete_after: 100, major_compress_after: 3, max_entries: 30 },
      });

      // seq 1: minor
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'minor detail', summary: 'minor summary' },
      });
      // seq 2: major
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: 'major detail', summary: 'major summary' },
      });

      // at seq=2: minor(seq1) age=1 < 2 → detail, major(seq2) age=0 < 3 → detail
      let view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('minor detail');
      expect(view.journey[1].content).toBe('major detail');

      // add seq 3, 4 to increase age
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

      // at seq=4: minor(seq1) age=3 >= 2 → summary, major(seq2) age=2 < 3 → detail
      view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('minor summary');
      expect(view.journey[1].content).toBe('major detail');

      // add one more
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'd5', summary: 's5' },
      });

      // at seq=5: major(seq2) age=3 >= 3 → summary
      view = store.load(SESSION)!;
      expect(view.journey[1].content).toBe('major summary');
    });
  });

  describe('GC — minor deletion', () => {
    it('deletes minor entries after minor_delete_after cycles', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 3, major_compress_after: 10, max_entries: 30 },
      });

      // seq 1: minor
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'minor', detail: 'trivial work', summary: 'trivial' },
      });

      // seq 2, 3, 4
      for (let i = 0; i < 3; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'major', detail: `major${i}`, summary: `m${i}` },
        });
      }

      // at seq=4: minor(seq1) age=3 >= 3 → deleted
      const view = store.load(SESSION)!;
      const hasMinor = view.journey.some((e) => e.content === 'trivial');
      expect(hasMinor).toBe(false);
      expect(view.journey.length).toBe(3);
    });
  });

  describe('GC — major entries are never deleted by age', () => {
    it('major entries persist regardless of age', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 3, major_compress_after: 2, max_entries: 30 },
      });

      // seq 1: major
      store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: 'architecture decision', summary: 'decision' },
      });

      // seq 2~20
      for (let i = 0; i < 19; i++) {
        store.save({
          session_id: SESSION, project_dir: PROJECT,
          current_task: 't', next_step: 'n',
          event: { importance: 'major', detail: `major${i}`, summary: `m${i}` },
        });
      }

      // at seq=20: major(seq1) age=19 — still exists
      const view = store.load(SESSION)!;
      expect(view.journey[0].content).toBe('decision');
      expect(view.journey.length).toBe(20);
    });
  });

  describe('GC — capacity limit', () => {
    it('deletes minor entries first when exceeding max_entries', () => {
      store = createStore({
        gc: { minor_compress_after: 1, minor_delete_after: 100, major_compress_after: 1, max_entries: 5 },
      });

      // 3 minor + 3 major = 6 (exceeds max 5)
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

      const minorCount = view.journey.filter((e) => e.importance === 'minor').length;
      const majorCount = view.journey.filter((e) => e.importance === 'major').length;
      expect(majorCount).toBe(3);
      expect(minorCount).toBeLessThanOrEqual(2);
    });
  });

  describe('list', () => {
    it('returns all sessions', () => {
      store.save({ session_id: 'a', project_dir: '/a', current_task: 'ta', next_step: 'na' });
      store.save({ session_id: 'b', project_dir: '/b', current_task: 'tb', next_step: 'nb' });

      const list = store.list();
      expect(list.length).toBe(2);
      expect(list.map((s) => s.session_id).sort()).toEqual(['a', 'b']);
    });

    it('returns only the specified session', () => {
      store.save({ session_id: 'a', project_dir: '/a', current_task: 'ta', next_step: 'na' });
      store.save({ session_id: 'b', project_dir: '/b', current_task: 'tb', next_step: 'nb' });

      const list = store.list('a');
      expect(list.length).toBe(1);
      expect(list[0].session_id).toBe('a');
    });
  });

  describe('delete', () => {
    it('deletes an entire session', () => {
      store.save({ session_id: SESSION, project_dir: PROJECT, current_task: 't', next_step: 'n' });
      expect(store.delete(SESSION)).toBe(true);
      expect(store.load(SESSION)).toBeNull();
    });

    it('deletes a specific entry', () => {
      const result = store.save({
        session_id: SESSION, project_dir: PROJECT,
        current_task: 't', next_step: 'n',
        event: { importance: 'major', detail: 'delete target', summary: 'delete' },
      });

      expect(store.delete(SESSION, result.snapshot_id!)).toBe(true);
      const view = store.load(SESSION)!;
      expect(view.journey.length).toBe(0);
    });

    it('returns false when deleting nonexistent entry', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('session limit', () => {
    it('deletes oldest session when exceeding max_sessions', () => {
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
      expect(list.find((s) => s.session_id === 'session-0')).toBeUndefined();
    });
  });
});
