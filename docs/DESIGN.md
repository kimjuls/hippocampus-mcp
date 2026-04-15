# mcp-hippocampus 설계서

## 무엇을 해결하는가

Claude Code의 `/compact`는 대화를 요약하여 컨텍스트를 확보한다.
그러나 이 과정에서 **세부 작업 맥락** — 지금 뭘 하고 있었는지, 어디까지 했는지, 다음에 뭘 해야 하는지 — 이 자주 소실된다.

compact 후 Claude가 엉뚱한 방향으로 작업하거나, 이미 결정한 것을 다시 묻거나, 진행 상태를 잊어버리는 문제가 반복된다.

**hippocampus**는 이 문제를 해결하는 경량 MCP 서버다.

---

## 설계 철학: 해마(Hippocampus) 모델

이름 그대로, 사람 뇌의 **해마**를 모방한다.

### 사람의 기억은 이렇게 작동한다

```
큰 사건 (첫 출근, 프로젝트 론칭)  → 오래 기억, 천천히 희미해짐
사소한 사건 (점심 뭐 먹었는지)    → 빨리 잊음
모든 기억                        → 시간이 지나면 핵심만 남고 세부사항은 사라짐
```

hippocampus도 동일하게 작동한다:

- **큰 작업**(기능 구현, 아키텍처 결정)은 오래 기억하고, 천천히 압축한다
- **사소한 작업**(설정 파일 수정)은 빨리 압축되고, 빨리 사라진다
- 모든 기억은 **생성 → 압축 → 삭제**의 라이프사이클을 거친다
- 더 이상 압축할 수 없는 사소한 기억은 자연스럽게 삭제된다

### compact를 보완한다. 대체하지 않는다.

이것이 가장 중요한 원칙이다.

| | compact | hippocampus |
|---|---------|-------------|
| **역할** | 전체 대화 흐름을 요약 | 지금 이 순간의 작업 맥락을 보존 |
| **범위** | 넓고 얕은 | 좁고 정확한 |
| **비유** | 책 전체의 줄거리 요약 | 책갈피 한 장 |

hippocampus가 저장하는 데이터는 **책갈피** 수준이다.
compact로 확보한 컨텍스트를 다시 잡아먹는 순간, 이 설계는 실패한 것이다.

---

## 기억의 3요소

hippocampus는 세 가지만 기억한다:

### 1. `current_task` — 지금 뭘 하고 있는지
- 항상 최신 상태로 덮어쓰기
- 예: "auth 미들웨어에 JWT 검증 로직 구현 중"

### 2. `next_step` — 다음에 뭘 해야 하는지
- 항상 최신 상태로 덮어쓰기
- 예: "토큰 만료 시 리프레시 로직 구현"

### 3. `journey` — 어디까지 했는지
- 세션 시작부터 현재까지의 **살아있는 여정**
- 채팅 순서대로 나열된 마일스톤 로그
- **기억 라이프사이클이 적용**되어 오래된 기억은 자동으로 압축/삭제

```
journey 예시:
  [seq 42] ★ major: "auth 모듈에 JWT 인증 구현 완료"
  [seq 45]   minor: ".env 설정 추가"               ← 곧 압축될 예정
  [seq 48] ★ major: "API 에러 핸들링 리팩토링 중"   ← 최근, 상세 유지
```

---

## 기억 라이프사이클

이것이 hippocampus의 핵심 메커니즘이다.

### 원리

Claude가 마일스톤을 저장할 때 **상세 버전(detail)과 압축 버전(summary)을 동시에 작성**한다:

```
detail:  "JWT 토큰 방식으로 auth.module.ts에 RS256 알고리즘을 사용하고,
          리프레시 토큰 로테이션을 적용하여 인증 구현 완료"

summary: "auth 모듈에 JWT 인증 구현 완료"
```

MCP는 AI 모델 없이 **기계적으로** 라이프사이클을 관리한다:

```
  ┌──────────┐   age ≥ 임계값   ┌──────────┐   age ≥ 임계값   ┌─────────┐
  │  DETAIL  │ ─────────────→  │ SUMMARY  │ ─────────────→  │ DELETED │
  │ (상세)   │                  │ (압축)   │  (minor만)      │         │
  └──────────┘                  └──────────┘                  └─────────┘
                                      │
                              major는 여기서 유지
                             (용량 초과 시에만 삭제)
```

### 시간 단위: 채팅 사이클

Wall-clock 시간이 아닌 **채팅 사이클**(질문-답변 쌍)을 기준으로 한다.

세션을 열어두고 일주일 뒤에 돌아와도, 그 사이 채팅이 없었다면 마지막 기억은 여전히 "최신"이다. 반대로, 30분 안에 20번 대화했다면 초반 기억은 이미 오래된 것이다.

사람도 마찬가지다. 시간이 아니라 **그 사이에 얼마나 많은 일이 있었는가**가 기억의 선명도를 결정한다.

MCP 내부의 시퀀스 카운터가 이를 추적한다.

### 중요도별 차등 수명

| 단계 | minor (사소한 작업) | major (핵심 작업) |
|------|-------------------|------------------|
| detail → summary | 5 사이클 후 | 10 사이클 후 |
| summary → 삭제 | 15 사이클 후 | 용량 초과 시에만 |

### 중요도 분류 기준

토큰 수(= 투입한 노력)가 아닌 **결과의 성격**으로 분류한다.
2시간 디버깅 끝에 오타 한 글자 수정은 토큰은 많지만 결과는 minor다.
한 마디로 내린 아키텍처 결정은 토큰은 적지만 결과는 major다.

**major** — 하나라도 해당하면:
- 새로운 기능이나 모듈 구현
- 아키텍처/설계 결정
- 버그 수정 (원인 분석 포함)
- 여러 파일에 걸친 리팩토링

**minor**:
- 설정 파일 수정
- 포맷팅, 린트 수정
- 단일 파일 소규모 수정
- 문서/주석 수정

Claude가 `save_memory` 호출 시 스스로 판단하여 태깅한다.

### 용량 제한과 자동 정리 (GC)

전체 journey 항목에 최대 개수 제한(`MAX_ENTRIES`, 기본 30)을 둔다.

초과 시 삭제 우선순위:
1. minor + summary 상태 (가장 먼저 삭제)
2. major + summary 상태 (오래된 것부터)

GC는 `save_memory`와 `load_memory` 호출 시 자동 실행된다.
별도의 AI 호출이나 외부 트리거가 필요 없다.

### 삭제 불가능한 압축의 예

".gitignore에 CLAUDE.md 추가" → 압축하면 → ".gitignore 수정"

이 시점에서 이 기억은 **더 이상 의미 있는 정보를 담고 있지 않다**. 이런 기억은 삭제해도 작업 재개에 아무 영향이 없다. 이것이 minor 기억이 자연스럽게 소멸하는 이유다.

---

## 마일스톤 기록 방식: 점진적 기록

compact 직전에 한 번에 몰아서 저장하는 것이 **아니다**.

작업 중 마일스톤이 발생할 때마다 `save_memory`를 호출하여 점진적으로 기록한다. 이렇게 하면:

- compact가 갑자기 와도 이미 기록이 있다
- 각 마일스톤이 발생한 시점의 맥락이 정확하다
- Claude가 "지금까지 뭘 했는지" 회고할 필요 없이, 이미 기록되어 있다

마일스톤 기준: **plan-execute 수준의 작업 단위**. 사람도 큰 사건은 기억하고 사소한 건 잊듯이, 의미 있는 작업이 완료되었을 때 기록한다.

---

## 데이터 구조

### MemoryEntry (마일스톤 항목)

```typescript
interface MemoryEntry {
  id: string;                    // 고유 식별자
  sequence: number;              // 생성 시점의 시퀀스 번호
  importance: 'major' | 'minor';
  detail: string;                // 상세 기록
  summary: string;               // 압축 기록
}
```

### SessionMemory (세션별 저장 구조)

```typescript
interface SessionMemory {
  session_id: string;
  project_dir: string;
  current_task: string;
  next_step: string;
  journey: MemoryEntry[];        // 시간순
  sequence: number;              // 현재 시퀀스 카운터
}
```

### MemoryView (load_memory 반환 형태)

```typescript
interface MemoryView {
  current_task: string;
  next_step: string;
  journey: Array<{
    id: string;
    content: string;             // age에 따라 detail 또는 summary
    importance: 'major' | 'minor';
    age: number;
  }>;
}
```

GC가 적용된 후의 **읽기 전용 뷰**다. 내부 저장소에는 detail과 summary가 모두 보존되지만, 외부에는 age에 맞는 한 쪽만 노출한다.

---

## MCP 도구

### `save_memory` — 기록

마일스톤 기록 + current_task/next_step 갱신. event가 없으면 상태만 갱신.

```
입력: { session_id, project_dir, current_task, next_step, event? }
event: { importance, detail, summary }
```

### `load_memory` — 복원

GC 적용 후 MemoryView 반환. compact 후 작업 재개 시 사용.

```
입력: { session_id }
```

### `list_memories` — 조회

세션 목록 또는 특정 세션의 마일스톤 목록.

```
입력: { session_id? }
```

### `delete_memory` — 수동 정리

특정 항목 또는 세션 전체 삭제.

```
입력: { session_id, entry_id? }
```

---

## MCP 프롬프트

### `prep_for_compact`
compact 전 Claude에게 현재 상태를 save_memory로 저장하도록 안내하는 프롬프트 템플릿.

### `post_compact_restore`
compact 후 Claude에게 load_memory로 상태를 복원하고 작업을 이어가도록 안내하는 프롬프트 템플릿.

---

## 아키텍처

```
Claude Code Session
  │
  │  작업 중 마일스톤 ─→ save_memory(event) ──┐
  │  상태만 갱신 ──────→ save_memory()  ──────┤
  │                                            ▼
  │                                  ┌──────────────────┐
  │  PreCompact Hook → save_memory ─→│  hippocampus     │
  │                                  │  MCP Server      │
  │  /compact 실행                   │                  │
  │                                  │  MemoryStore     │
  │  PostCompact Hook → load_memory ←│  ├── GC Engine   │
  │                                  │  ├── In-Memory   │
  │  작업 재개 ←── MemoryView ──────│  └── File Sync   │
  │                                  └──────────────────┘
```

### Storage 엔진

- **인메모리 Map** + 선택적 **JSON 파일 동기화**
- 파일 저장: atomic write (임시 파일 → rename)로 crash 안전
- 기본 경로: `~/.hippocampus/memory.json`
- 세션 격리: session_id 기반, 세션 간 간섭 없음

---

## Claude Code 연동

### MCP 서버 등록 — 이것만 하면 끝

```bash
claude mcp add hippocampus -- npx -y mcp-hippocampus
```

서버가 연결되면 MCP `instructions`가 Claude 시스템 프롬프트에 자동 포함된다.
Claude는 instructions를 통해 save_memory/load_memory 호출 타이밍을 인지하고, 추가 설정 없이 자동으로 동작한다.

### 동작 원리: Instructions + Tool Description

hippocampus는 두 계층으로 Claude에게 행동 규칙을 전달한다:

1. **Server Instructions** (`src/instructions.ts`): 서버 연결 시 시스템 프롬프트에 포함. 전체 워크플로우(언제 save, 언제 load)를 간결하게 기술.
2. **Tool Description** (`src/tools.ts`): 각 도구의 호출 조건을 구체적으로 명시. "무엇을 하는지"뿐 아니라 "언제 써야 하는지"도 포함.

이 조합으로 hook 설정, CLAUDE.md 수정 등 **추가 설정 없이** `claude mcp add`만으로 완전히 동작한다.

### Hook (선택적 보강)

instructions만으로 충분하지만, compact 전후 호출을 더 확실히 보장하고 싶다면 hook을 추가할 수 있다:

```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "prompt",
        "prompt": "컨텍스트가 compact됩니다. hippocampus save_memory로 현재 작업 상태를 저장하세요.",
        "timeout": 30
      }]
    }],
    "PostCompact": [{
      "hooks": [{
        "type": "prompt",
        "prompt": "컨텍스트가 compact되었습니다. hippocampus load_memory로 작업 상태를 복원하세요.",
        "timeout": 30
      }]
    }]
  }
}
```

---

## 설정 (환경변수)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `HIPPOCAMPUS_PERSIST` | `true` | 파일 저장 활성화 |
| `HIPPOCAMPUS_STORAGE_PATH` | `~/.hippocampus/memory.json` | 저장 경로 |
| `HIPPOCAMPUS_MAX_ENTRIES` | `30` | 세션당 journey 최대 항목 |
| `HIPPOCAMPUS_MAX_SESSIONS` | `20` | 최대 세션 수 |
| `HIPPOCAMPUS_MINOR_COMPRESS` | `5` | minor detail→summary 사이클 |
| `HIPPOCAMPUS_MINOR_DELETE` | `15` | minor summary→삭제 사이클 |
| `HIPPOCAMPUS_MAJOR_COMPRESS` | `10` | major detail→summary 사이클 |

---

## 설계 결정 근거

| 결정 | 이유 |
|------|------|
| 채팅 사이클 기반 (시간 X) | 세션 방치 후 재개해도 3사이클 전은 "최신" |
| Claude가 detail + summary 동시 작성 | MCP에 AI 불필요, 기계적 전환만 수행 |
| 점진적 마일스톤 기록 | compact가 갑자기 와도 이미 기록이 존재 |
| 중요도별 차등 수명 | 사람처럼 큰 기억은 오래, 사소한 건 빨리 소멸 |
| 작업 성격으로 중요도 분류 (토큰 X) | 토큰 수 = 노력이지 중요도가 아님 |
| MCP 자체 GC | 자율적 메모리 관리, Claude 개입 불필요 |
| JSON 파일 (SQLite X) | 네이티브 모듈 불필요, 데이터 소량 |
| Atomic write | 파일 쓰기 중 crash 시 데이터 손상 방지 |
| 용량 제한 (max_entries) | 무한 증가 방지, 컨텍스트 낭비 방지 |
