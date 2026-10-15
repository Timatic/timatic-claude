---
description: Set the ticket (for example a Jira key like ABC-123) that the rest of this Claude Code session is logged on in Timatic. Use when the user says which ticket they are working on, or when you learn it and the user agrees.
argument-hint: "<TICKET-KEY|clear>"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" ticket*)
---

Set the ticket for this session. Without it, the plugin takes the last ticket key mentioned in a prompt, and otherwise the key in the git branch name.

If no key was given and none is clear from the conversation, ask the user for it. Then run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" ticket <KEY> --session ${CLAUDE_SESSION_ID}
```

Use `clear` as the key to go back to automatic detection. Report the outcome in one line.
