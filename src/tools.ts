import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MemoryStore } from './storage.js';

export function registerTools(server: McpServer, store: MemoryStore): void {
  server.tool(
    'save_memory',
    'Call after completing a meaningful milestone (feature, bug fix, architecture decision, multi-file refactor) or before /compact. Records current_task/next_step and optionally appends a milestone event to the journey. GC runs automatically.',
    {
      session_id: z.string().describe('Claude Code 세션 ID'),
      project_dir: z.string().describe('현재 작업 디렉토리'),
      current_task: z.string().describe('지금 하고 있는 작업'),
      next_step: z.string().describe('다음에 해야 할 작업'),
      event: z
        .object({
          importance: z.enum(['major', 'minor']).describe(
            'major: 기능 구현, 아키텍처 결정, 버그 수정, 다파일 리팩토링. minor: 설정 수정, 포맷팅, 단일 파일 소규모 수정',
          ),
          detail: z.string().describe('상세 기록 (압축 전 원문)'),
          summary: z.string().describe('압축 기록 (한 줄 요약)'),
        })
        .optional()
        .describe('마일스톤이 있을 때만 전달'),
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
      session_id: z.string().describe('Claude Code 세션 ID'),
    },
    async ({ session_id }) => {
      const view = store.load(session_id);
      if (!view) {
        return {
          content: [{ type: 'text' as const, text: '저장된 기억이 없습니다.' }],
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
    '저장된 세션 목록 조회. session_id 미지정 시 전체 세션 요약.',
    {
      session_id: z.string().optional().describe('특정 세션 ID (미지정 시 전체)'),
    },
    async ({ session_id }) => {
      const list = store.list(session_id);
      return {
        content: [
          {
            type: 'text' as const,
            text: list.length > 0
              ? JSON.stringify(list, null, 2)
              : '저장된 세션이 없습니다.',
          },
        ],
      };
    },
  );

  server.tool(
    'delete_memory',
    '기억 삭제. entry_id 미지정 시 세션 전체 삭제.',
    {
      session_id: z.string().describe('세션 ID'),
      entry_id: z.string().optional().describe('삭제할 항목 ID (미지정 시 세션 전체 삭제)'),
    },
    async ({ session_id, entry_id }) => {
      const deleted = store.delete(session_id, entry_id);
      return {
        content: [
          {
            type: 'text' as const,
            text: deleted ? '삭제 완료.' : '해당 항목을 찾을 수 없습니다.',
          },
        ],
      };
    },
  );
}
