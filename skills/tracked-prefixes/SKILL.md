---
description: List, add or remove the git remote prefixes of business work (trackedGitRemotePrefixes), for which Timatic asks the user for a customer when a repository has no mapping. Use when the user says repositories of an organisation, account or host (e.g. github.com/acme) are business work that must be tracked, or no longer are.
argument-hint: "[list|add <prefix>|remove <prefix>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" tracked-prefixes*)
---

Tracking runs silently; only a repository whose git remote falls under one of these prefixes, and that Timatic has no mapping for, gets the user asked for a customer.

1. Work out the prefix from what the user said, as `host/owner` (e.g. `github.com/acme`). A remote url works too. If they mean the current repository's organisation and gave none, take it from `git remote get-url origin`.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" tracked-prefixes add <prefix>`, `remove <prefix>`, or `list` without one.
3. Report the outcome in one line. When the organisation rolls out `settings.json` through MDM, mention that a local change may be overwritten by the next rollout.
