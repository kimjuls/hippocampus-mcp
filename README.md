# hippocampus-mcp

**Working memory for Claude Code.** Preserves task context across `/compact` so Claude never loses track of what it was doing.

## The Problem

Claude Code's `/compact` summarizes the conversation to free up context — but it often loses the details that matter:

- What you were working on right now
- What was already decided and done
- What the next step was supposed to be

After compaction, Claude drifts, re-asks settled questions, or forgets progress entirely.

## The Solution

hippocampus works like the brain structure it's named after — it manages a **memory lifecycle**:

- **Recent memories** stay detailed
- **Older memories** auto-compress to summaries
- **Trivial memories** eventually disappear

Claude records milestones as it works. hippocampus handles the rest — compression, cleanup, and restoration — without any AI involvement.

## Quick Start

```bash
claude mcp add hippocampus -- npx -y @julskim/hippocampus-mcp
```

**That's it.** No hooks, no config files, no CLAUDE.md edits. hippocampus injects its own instructions into Claude's system prompt via the MCP protocol. Claude automatically knows when to save and restore.

## How It Works

### Three Components of Memory

| Component      | Purpose                           | Behavior                       |
| -------------- | --------------------------------- | ------------------------------ |
| `current_task` | What you're doing right now       | Always overwritten with latest |
| `next_step`    | What to do next after resuming    | Always overwritten with latest |
| `journey`      | Milestone log of what's been done | Auto-managed lifecycle         |

### Memory Lifecycle

Every milestone has both a `detail` (full context) and `summary` (one-liner), written by Claude at save time. hippocampus mechanically transitions between them based on age:

```
DETAIL ──age──→ SUMMARY ──age──→ DELETED (minor only)
                   │
                major stays here
               (deleted only on capacity overflow)
```

### Differential Lifespan by Importance

Time is measured in **chat cycles** (question-answer pairs), not wall-clock time. A week of inactivity doesn't age memories — only actual interactions do.

| Stage            | minor     | major                  |
| ---------------- | --------- | ---------------------- |
| detail → summary | 5 cycles  | 10 cycles              |
| summary → delete | 15 cycles | capacity overflow only |

**major** = feature implementation, architecture decision, bug fix, multi-file refactor
**minor** = config change, formatting, single-file tweak, docs

## Tools

### `save_memory`

Call after completing a meaningful milestone, or before `/compact`.

```
session_id     — Claude Code session ID
project_dir    — current working directory
current_task   — what you're doing now (one sentence)
next_step      — what to do next (one sentence)
event?         — milestone to record
  importance   — "major" or "minor"
  detail       — full context (what, where, how)
  summary      — one-line compressed version
```

### `load_memory`

Call after `/compact` or context summary to restore working context.

```
session_id     — Claude Code session ID
→ Returns: MemoryView (current_task + next_step + age-compressed journey)
```

### `list_memories`

List all sessions or inspect a specific one.

### `delete_memory`

Remove a specific entry or an entire session.

## Configuration

All settings are optional. Defaults work well for most use cases.

| Variable                     | Default                      | Description                          |
| ---------------------------- | ---------------------------- | ------------------------------------ |
| `HIPPOCAMPUS_PERSIST`        | `true`                       | Enable file persistence              |
| `HIPPOCAMPUS_STORAGE_PATH`   | `~/.hippocampus/memory.json` | Storage file location                |
| `HIPPOCAMPUS_MAX_ENTRIES`    | `30`                         | Max journey entries per session      |
| `HIPPOCAMPUS_MAX_SESSIONS`   | `20`                         | Max concurrent sessions              |
| `HIPPOCAMPUS_MINOR_COMPRESS` | `5`                          | Cycles before minor detail → summary |
| `HIPPOCAMPUS_MINOR_DELETE`   | `15`                         | Cycles before minor summary → delete |
| `HIPPOCAMPUS_MAJOR_COMPRESS` | `10`                         | Cycles before major detail → summary |

Pass via MCP server config:

```json
{
  "mcpServers": {
    "hippocampus": {
      "command": "npx",
      "args": ["-y", "@julskim/hippocampus-mcp"],
      "env": {
        "HIPPOCAMPUS_MAX_ENTRIES": "50"
      }
    }
  }
}
```

## Optional: Hooks

The MCP instructions handle everything automatically. But if you want to **guarantee** saves before every compact:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Context is about to be compacted. Use hippocampus save_memory to preserve your current working state.",
            "timeout": 30
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Context was compacted. Use hippocampus load_memory to restore your working state.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Security & Trust

This MCP server handles **working memory** — what Claude is doing, where, and how. That makes security non-negotiable.

**This project is maintained by a single developer.** Every line of code is reviewed and shipped by one person. External pull requests are **NOT** accepted — not because contributions aren't valued, but because a single chain of trust is the strongest defense against supply chain attacks.

You're free to fork, modify, and build your own version under the MIT license. But the official `@julskim/hippocampus-mcp` package on npm will always trace back to one verified author.

**Bug reports and feature requests are welcome.** Open a [GitHub Issue](https://github.com/kimjuls/hippocampus-mcp/issues) — every report is reviewed and addressed promptly. No PR needed; just describe the problem or idea, and it will be handled.

## Support This Project

Running a solo-maintained security-conscious project takes time. If hippocampus saved your context (and your sanity), consider supporting its development:

- Crypto: `0xe5C8742E13F1c007978eb08C848e39CE16CCE4E2` (ETH / Polygon / Base)

## License

[MIT](./LICENSE)
