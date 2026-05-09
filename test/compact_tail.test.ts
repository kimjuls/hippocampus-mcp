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

  it('filters out malformed JSON lines instead of surfacing raw text', () => {
    writeFileSync(
      transcriptPath,
      `not valid json here\n${JSON.stringify({ type: 'user', message: { content: 'real turn' } })}\n`,
    );
    const result = readTranscriptTail(transcriptPath, 5);
    // Malformed lines are not substantive turns and must not occupy a tail slot.
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('real turn');
    expect(result[0]).not.toContain('not valid json');
  });

  it('skips meta-type lines so tail slots reflect substantive turns only', () => {
    writeTranscript([
      { type: 'custom-title', title: 'My title' },
      { type: 'user', message: { content: 'a' } },
      { type: 'last-prompt', prompt: 'something' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'b' }] } },
      { type: 'file-history-snapshot', files: [] },
      { type: 'user', message: { content: 'c' } },
    ]);
    const result = readTranscriptTail(transcriptPath, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('a');
    expect(result[1]).toContain('b');
    expect(result[2]).toContain('c');
    for (const line of result) {
      expect(line).not.toContain('[custom-title]');
      expect(line).not.toContain('[last-prompt]');
      expect(line).not.toContain('[file-history-snapshot]');
    }
  });

  it('extracts tool_result string content on user lines', () => {
    writeTranscript([
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', content: 'tests passed (87)' }],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[user]');
    expect(result[0]).toContain('[tool_result]');
    expect(result[0]).toContain('tests passed (87)');
  });

  it('extracts tool_result array text blocks on user lines', () => {
    writeTranscript([
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              content: [
                { type: 'text', text: 'line1' },
                { type: 'text', text: 'line2' },
              ],
            },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[tool_result]');
    expect(result[0]).toContain('line1');
    expect(result[0]).toContain('line2');
  });

  it('marks empty tool_result without an excerpt', () => {
    writeTranscript([
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: [] }] },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[tool_result]');
    expect(result[0]).not.toContain('"');
  });

  it('includes Bash command excerpt on assistant tool_use', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[tool_use:Bash');
    expect(result[0]).toContain('command=');
    expect(result[0]).toContain('npm test');
  });

  it('includes file_path excerpt for Read/Edit/Write tool_use', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/abs/src/storage.ts' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/abs/test/x.test.ts' } },
            { type: 'tool_use', name: 'Write', input: { file_path: '/abs/new.ts' } },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('file_path=');
    expect(result[0]).toContain('/abs/src/storage.ts');
    expect(result[0]).toContain('/abs/test/x.test.ts');
    expect(result[0]).toContain('/abs/new.ts');
  });

  it('includes pattern excerpt for Grep / Glob tool_use', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO\\b' } },
            { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('pattern=');
    expect(result[0]).toContain('TODO');
    expect(result[0]).toContain('**/*.ts');
  });

  it('falls back to JSON excerpt for unknown tool_use names', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'CustomTool', input: { foo: 'bar', baz: 1 } },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[tool_use:CustomTool');
    expect(result[0]).toContain('foo');
    expect(result[0]).toContain('bar');
  });

  it('omits the input excerpt entirely when input is empty', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: {} }],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    // Back-compat with the legacy shape: bare [tool_use:Read] when no input.
    expect(result[0]).toContain('[tool_use:Read]');
    expect(result[0]).not.toContain('file_path=');
  });

  it('surfaces thinking-only assistant turns', () => {
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'why is this empty?' }],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    expect(result[0]).toContain('[thinking]');
    expect(result[0]).toContain('why is this empty?');
  });

  it('caps each tail line at the configured ceiling', () => {
    const big = 'x'.repeat(300);
    writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: big },
            { type: 'text', text: big },
            { type: 'text', text: big },
          ],
        },
      },
    ]);
    const result = readTranscriptTail(transcriptPath, 1);
    // 480-char ceiling enforced by capLine; allow +1 for the ellipsis char.
    expect(result[0].length).toBeLessThanOrEqual(481);
    expect(result[0]).toContain('…');
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
