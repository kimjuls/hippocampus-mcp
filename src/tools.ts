import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MemoryStore } from './storage.js';

export function registerTools(server: McpServer, store: MemoryStore): void {
  server.tool(
    'save_memory',
    'Call after completing a meaningful milestone (feature, bug fix, architecture decision, multi-file refactor) or before /compact. Records current_task/next_step and optionally appends a milestone event to the journey. GC runs automatically.',
    {
      session_id: z.string().describe('Claude Code session ID'),
      project_dir: z.string().describe('Current working directory'),
      current_task: z.string().describe('What you are working on now'),
      next_step: z.string().describe('What to do next'),
      event: z
        .object({
          importance: z.enum(['major', 'minor']).describe(
            'major: feature impl, architecture decision, bug fix, multi-file refactor. minor: config change, formatting, single-file tweak',
          ),
          detail: z.string().describe('Full context (pre-compression original)'),
          summary: z.string().describe('One-line compressed version'),
        })
        .optional()
        .describe('Only pass when there is a milestone to record'),
    },
    async (args) => {
      const result = store.save(args);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'load_memory',
    'Call after /compact, context summary, or at session start to restore working context. Returns a MemoryView with auto-compressed/pruned journey entries.',
    {
      session_id: z.string().describe('Claude Code session ID'),
    },
    async ({ session_id }) => {
      const view = store.load(session_id);
      if (!view) {
        return {
          content: [{ type: 'text' as const, text: 'No saved memory found.' }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(view, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'list_memories',
    'List saved sessions. Returns all session summaries if session_id is omitted.',
    {
      session_id: z.string().optional().describe('Specific session ID (omit for all)'),
    },
    async ({ session_id }) => {
      const list = store.list(session_id);
      return {
        content: [
          {
            type: 'text' as const,
            text: list.length > 0
              ? JSON.stringify(list, null, 2)
              : 'No saved sessions found.',
          },
        ],
      };
    },
  );

  server.tool(
    'delete_memory',
    'Delete memory. Deletes entire session if entry_id is omitted.',
    {
      session_id: z.string().describe('Session ID'),
      entry_id: z.string().optional().describe('Entry ID to delete (omit to delete entire session)'),
    },
    async ({ session_id, entry_id }) => {
      const deleted = store.delete(session_id, entry_id);
      return {
        content: [
          {
            type: 'text' as const,
            text: deleted ? 'Deleted.' : 'Entry not found.',
          },
        ],
      };
    },
  );
}
