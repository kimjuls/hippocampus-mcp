import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MemoryStore, readTranscriptTail } from '../src/storage.js';

let tmpDir: string;
let transcriptPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hippocampus-tail-'));
  transcriptPath = resolve(tmpDir, 'transcript.jsonl');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTranscript(lines: unknown[]): void {
  writeFileSync(
    transcriptPath,
    lines.map((l) => JSON.stringify(l)).join('\n'),
    'utf-8',
  );
}

describe('readTranscriptTail', () => {
  it('returns empty array for missing file', () => {
    const result = readTranscriptTail(resolve(tmpDir, 'nope.jsonl'), 10);
    expect(result).toEqual([]);
  });

  it('extracts last N lines in order', () => {
    writeTranscript([
      { type: 'user', message: { content: 'a' } },
      { type: 'user', message: { content: 'b' } },
      { type: 'user', message: { content: 'c' } },
      { type: 'user', message: { content: 'd' } },
    ]);
    const result = readTranscriptTail(transcriptPath, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('c');
    expect(result[1]).toContain('d');
  });

  it('summarizes user text message', () => {
    writeTranscript([{ type: 'user', message: { content: 'hello world' } }]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[user]');
    expect(result[0]).toContain('hello world');
  });

  it('summarizes assistant message with text and tool_use blocks', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me read the file' },
            { type: 'tool_use', name: 'Read', input: {} },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[assistant]');
    expect(result[0]).toContain('Let me read the file');
    expect(result[0]).toContain('[tool_use:Read]');
  });

  it('truncates long text', () => {
    const longText = 'x'.repeat(500);
    writeTranscript([{ type: 'user', message: { content: longText } }]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0].length).toBeLessThan(longText.length);
    expect(result[0]).toContain('…');
  });

  it('falls back to raw line for malformed JSON', () => {
    writeFileSync(transcriptPath, 'not valid json here\n');
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('not valid json');
  });
});

describe('MemoryStore.load with last_compact', () => {
  it('synthesizes tail entries when last_compact is present', () => {
    writeTranscript([
      { type: 'user', message: { content: 'first' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } },
      { type: 'user', message: { content: 'second' } },
    ]);

    const store = new MemoryStore({ persist: false, compact_tail_n: 3 });
    store.recordCompactSnapshot({
      session_id: 'sess',
      transcript_path: transcriptPath,
      timestamp: Date.now(),
      trigger: 'manual',
      message_count: 3,
    });

    const view = store.load('sess')!;
    expect(view).not.toBeNull();
    expect(view.last_compact).toBeDefined();
    expect(view.last_compact!.trigger).toBe('manual');
    expect(view.journey).toHaveLength(3);
    expect(view.journey[0].id).toBe('tail-0');
    expect(view.journey[0].content).toContain('first');
    expect(view.journey[2].content).toContain('second');
  });

  it('preserves original journey and appends tail entries', () => {
    writeTranscript([{ type: 'user', message: { content: 'recent' } }]);

    const store = new MemoryStore({ persist: false, compact_tail_n: 5 });
    store.save({
      session_id: 'sess',
      project_dir: '/p',
      current_task: 't',
      next_step: 'n',
      event: { importance: 'major', detail: 'saved work', summary: 'saved' },
    });
    store.recordCompactSnapshot({
      session_id: 'sess',
      transcript_path: transcriptPath,
      timestamp: Date.now(),
      trigger: 'auto',
      message_count: 1,
    });

    const view = store.load('sess')!;
    expect(view.journey).toHaveLength(2);
    expect(view.journey[0].content).toBe('saved work');
    expect(view.journey[1].id).toBe('tail-0');
    expect(view.journey[1].content).toContain('recent');
  });

  it('returns view without tail entries when last_compact absent', () => {
    const store = new MemoryStore({ persist: false });
    store.save({
      session_id: 'sess',
      project_dir: '/p',
      current_task: 't',
      next_step: 'n',
    });

    const view = store.load('sess')!;
    expect(view.last_compact).toBeUndefined();
    expect(view.journey).toHaveLength(0);
  });

  it('creates session stub when recordCompactSnapshot called on new session', () => {
    const store = new MemoryStore({ persist: false });
    store.recordCompactSnapshot({
      session_id: 'new-sess',
      transcript_path: '/nonexistent',
      timestamp: Date.now(),
      trigger: 'auto',
      message_count: 0,
    });

    const view = store.load('new-sess')!;
    expect(view).not.toBeNull();
    expect(view.current_task).toBe('');
    expect(view.last_compact).toBeDefined();
  });
});
