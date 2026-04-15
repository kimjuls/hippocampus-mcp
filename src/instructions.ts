export const INSTRUCTIONS = `\
hippocampus preserves working context across /compact. It auto-compresses old memories and deletes trivial ones — you just record milestones.

WHEN TO CALL save_memory:
- After completing a meaningful milestone (feature, bug fix, architecture decision, multi-file refactor)
- Before /compact runs (save current_task + next_step so you can resume)
- NOT for every small change — only bookmark-level checkpoints

WHEN TO CALL load_memory:
- After /compact or context summary — to restore where you left off
- At session start if prior memory exists

WRITING EVENTS:
- importance: "major" = feature/architecture/bugfix/refactor, "minor" = config/formatting/single-file tweak
- detail: what you did, where, how (full context for recent recall)
- summary: one-line compressed version (for aged recall)
- current_task/next_step: always overwrite with latest state

Keep entries minimal — hippocampus is a bookmark, not a copy of the conversation.`;
