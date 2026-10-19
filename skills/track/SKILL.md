---
description: Turn Timatic time tracking on or off for the folder Claude Code runs in. Use when the user says this folder or project should (not) be tracked in Timatic.
argument-hint: "<on|off>"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track $ARGUMENTS`. If the user gave neither `on` nor `off`, ask them first. Report the outcome in one line. After `on`, offer `/timatic:customer` when no customer is set yet.

Whether to track is saved per folder in the plugin's own data, not in the repository. A choice applies to every folder below this one, unless a subfolder has a choice of its own.
