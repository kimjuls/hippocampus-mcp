import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { MemoryStore } from './storage.js';
import type { CompactSnapshot } from './types.js';

interface PreCompactInput {
  session_id: string;
  transcript_path: string;
  cwd?: string;
  trigger?: 'auto' | 'manual';
  hook_event_name?: string;
  permission_mode?: string;
}

export async function handle(stdin: NodeJS.ReadableStream = process.stdin): Promise<void> {
  const raw = await readAll(stdin);

  let input: PreCompactInput;
  try {
    input = JSON.parse(raw) as PreCompactInput;
  } catch (err) {
    process.stderr.write(
      `[hippocampus-mcp] --precompact: invalid stdin JSON (${(err as Error).message})\n`,
    );
    return;
  }

  if (!input.session_id || !input.transcript_path) {
    process.stderr.write(
      '[hippocampus-mcp] --precompact: missing session_id or transcript_path\n',
    );
    return;
  }

  const snapshot: CompactSnapshot = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    timestamp: Date.now(),
    trigger: input.trigger === 'manual' ? 'manual' : 'auto',
    message_count: countLines(input.transcript_path),
  };

  const store = new MemoryStore({
    persist: process.env.HIPPOCAMPUS_PERSIST !== 'false',
    storage_path:
      process.env.HIPPOCAMPUS_STORAGE_PATH ||
      resolve(homedir(), '.hippocampus', 'memory.json'),
  });

  store.recordCompactSnapshot(snapshot);

  process.stderr.write(
    `[hippocampus-mcp] precompact recorded: session=${input.session_id} trigger=${snapshot.trigger} messages=${snapshot.message_count}\n`,
  );
}

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => resolvePromise(data));
    stream.on('error', reject);
  });
}

function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const raw = readFileSync(path, 'utf-8');
    return raw.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}
