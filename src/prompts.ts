import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'prep_for_compact',
    'Guide to save current working state via save_memory before compact',
    {
      session_id: z.string().describe('Current session ID'),
      project_dir: z.string().describe('Current working directory'),
    },
    ({ session_id, project_dir }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Context compact is about to run. Save your current working state using the save_memory tool.

**Required:**
- current_task: What you are working on now (one sentence)
- next_step: What to do after compact (one sentence)

**Milestone (event) — if you just completed or are in the middle of meaningful work not yet recorded:**
- importance: Judge by nature of work
  - major: feature implementation, architecture decision, bug fix, multi-file refactor
  - minor: config change, formatting, single-file tweak
- detail: Full context (what, where, how)
- summary: One-line compressed version

**Call parameters:**
- session_id: "${session_id}"
- project_dir: "${project_dir}"`,
          },
        },
      ],
    }),
  );

  server.prompt(
    'post_compact_restore',
    'Guide to restore working state via load_memory after compact',
    {
      session_id: z.string().describe('Current session ID'),
    },
    ({ session_id }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Context has been compacted. Restore your previous working state using the load_memory tool.

**Call:** load_memory({ session_id: "${session_id}" })

**After restoring:**
1. Re-confirm current goal from current_task
2. Review recent context from journey (respect already-made decisions)
3. Resume work according to next_step

Report to user: "[hippocampus-mcp] Working state restored: {current_task summary}"`,
          },
        },
      ],
    }),
  );
}
