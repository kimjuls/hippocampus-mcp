export const INSTRUCTIONS = `\
hippocampus preserves working context across /compact. A PreCompact hook auto-installed on first run records a compact snapshot; you record milestones.

WHEN TO CALL load_memory:
- IMMEDIATELY after /compact or any context reset — before any other work. If the returned view has last_compact populated, a compact just occurred and the journey tail contains recent transcript breadcrumbs.
- At session start if you suspect prior work exists for this session_id.

WHEN TO CALL save_memory:
- After completing a meaningful milestone (feature, bug fix, architecture decision, multi-file refactor).
- Optionally before risky operations.
- NOT for every small change — only bookmark-level checkpoints.

WRITING EVENTS:
- importance: "major" = feature/architecture/bugfix/refactor, "minor" = config/formatting/single-file tweak
- detail: what you did, where, how (full context for recent recall)
- summary: one-line compressed version (for aged recall)
- current_task/next_step: always overwrite with latest state

AUTOMATIC BEHAVIOR:
- A PreCompact hook records {session_id, transcript_path, trigger} to memory whenever /compact runs. No action needed from you for this.
- After compact, load_memory returns journey entries synthesized from the transcript tail (id prefixed with "tail-") so you can reconstruct recent context without reading the transcript manually.

Keep entries minimal — hippocampus is a bookmark, not a copy of the conversation.`;
