import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { handle } from '../src/precompact.js';

let tmpDir: string;
let storagePath: string;
let transcriptPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hippocampus-precompact-'));
  storagePath = resolve(tmpDir, 'memory.json');
  transcriptPath = resolve(tmpDir, 'transcript.jsonl');
  process.env.HIPPOCAMPUS_STORAGE_PATH = storagePath;
});

afterEach(() => {
  delete process.env.HIPPOCAMPUS_STORAGE_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeStdin(obj: unknown): Readable {
  return Readable.from([JSON.stringify(obj)]);
}

function writeTranscript(lines: unknown[]): void {
  writeFileSync(
    transcriptPath,
    lines.map((l) => JSON.stringify(l)).join('\n'),
    'utf-8',
  );
}

describe('precompact handle', () => {
  it('records last_compact snapshot with transcript line count', async () => {
    writeTranscript([
      { type: 'user', message: { content: 'hello' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', message: { content: 'do work' } },
    ]);

    await handle(
      makeStdin({
        session_id: 'sess-1',
        transcript_path: transcriptPath,
        cwd: '/tmp/proj',
        trigger: 'manual',
        hook_event_name: 'PreCompact',
      }),
    );

    const raw = readFileSync(storagePath, 'utf-8');
    const data = JSON.parse(raw);
    const snap = data.sessions['sess-1'].last_compact;

    expect(snap).toBeDefined();
    expect(snap.session_id).toBe('sess-1');
    expect(snap.transcript_path).toBe(transcriptPath);
    expect(snap.trigger).toBe('manual');
    expect(snap.message_count).toBe(3);
    expect(typeof snap.timestamp).toBe('number');
  });

  it('defaults trigger to "auto" when absent', async () => {
    writeTranscript([{ type: 'user', message: { content: 'x' } }]);

    await handle(
      makeStdin({
        session_id: 'sess-2',
        transcript_path: transcriptPath,
      }),
    );

    const data = JSON.parse(readFileSync(storagePath, 'utf-8'));
    expect(data.sessions['sess-2'].last_compact.trigger).toBe('auto');
  });

  it('handles missing transcript file gracefully', async () => {
    await handle(
      makeStdin({
        session_id: 'sess-3',
        transcript_path: resolve(tmpDir, 'nonexistent.jsonl'),
        trigger: 'auto',
      }),
    );

    const data = JSON.parse(readFileSync(storagePath, 'utf-8'));
    expect(data.sessions['sess-3'].last_compact.message_count).toBe(0);
  });

  it('preserves existing session data (journey untouched)', async () => {
    const initial = {
      version: 1,
      sessions: {
        'sess-4': {
          session_id: 'sess-4',
          project_dir: '/existing',
          current_task: 'existing task',
          next_step: 'existing next',
          journey: [
            { id: 'e1', sequence: 1, importance: 'major', detail: 'd', summary: 's' },
          ],
          sequence: 1,
        },
      },
    };
    writeFileSync(storagePath, JSON.stringify(initial), 'utf-8');
    writeTranscript([{ type: 'user', message: { content: 'x' } }]);

    await handle(
      makeStdin({
        session_id: 'sess-4',
        transcript_path: transcriptPath,
        trigger: 'auto',
      }),
    );

    const data = JSON.parse(readFileSync(storagePath, 'utf-8'));
    const session = data.sessions['sess-4'];
    expect(session.current_task).toBe('existing task');
    expect(session.next_step).toBe('existing next');
    expect(session.journey).toHaveLength(1);
    expect(session.last_compact).toBeDefined();
  });

  it('ignores invalid stdin without throwing', async () => {
    await handle(Readable.from(['not json at all']));
    // If no throw, test passes; file may not exist
  });
});
