import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'prep_for_compact',
    'compact 전에 현재 작업 상태를 save_memory로 저장하도록 안내',
    {
      session_id: z.string().describe('현재 세션 ID'),
      project_dir: z.string().describe('현재 작업 디렉토리'),
    },
    ({ session_id, project_dir }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `컨텍스트 compact가 곧 실행됩니다. save_memory 도구로 현재 작업 상태를 저장하세요.

**필수 항목:**
- current_task: 지금 하고 있는 작업 (한 문장)
- next_step: compact 후 이어서 할 작업 (한 문장)

**마일스톤(event) — 직전에 완료했거나 진행 중인 의미 있는 작업이 아직 기록되지 않았다면:**
- importance: 작업 성격으로 판단
  - major: 기능 구현, 아키텍처 결정, 버그 수정, 다파일 리팩토링
  - minor: 설정 수정, 포맷팅, 단일 파일 소규모 수정
- detail: 상세 기록 (무엇을, 어디에, 어떻게)
- summary: 한 줄 압축 (언제 뭘 했는지만)

**호출 파라미터:**
- session_id: "${session_id}"
- project_dir: "${project_dir}"`,
          },
        },
      ],
    }),
  );

  server.prompt(
    'post_compact_restore',
    'compact 후 load_memory로 작업 상태를 복원하고 작업을 이어가도록 안내',
    {
      session_id: z.string().describe('현재 세션 ID'),
    },
    ({ session_id }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `컨텍스트가 compact되었습니다. load_memory 도구로 이전 작업 상태를 복원하세요.

**호출:** load_memory({ session_id: "${session_id}" })

**복원 후:**
1. current_task로 현재 목표 재확인
2. journey에서 최근 맥락 파악 (이미 결정된 사항 존중)
3. next_step에 따라 작업 재개

사용자에게 한 줄 보고: "[hippocampus] 작업 상태 복원 완료: {current_task 요약}"`,
          },
        },
      ],
    }),
  );
}
