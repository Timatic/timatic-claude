---
description: Turn Timatic time tracking on, off or per ticket for the folder Claude Code runs in. Use when the user says this folder or project should (not) be tracked in Timatic, or that its customer follows the ticket.
argument-hint: "<on|off|per-ticket>"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track $ARGUMENTS`. If the user gave none of `on`, `off` or `per-ticket`, ask them first. `per-ticket` tracks the folder without a fixed customer: each event goes to the customer and budget its ticket is mapped to in Timatic, which suits a folder with work for several customers. Report the outcome in one line. After `on`, offer `/timatic:customer` when no customer is set yet.

The choice is saved per folder in the plugin's own data, not in the repository. It applies to every folder below this one, unless a subfolder has a choice of its own.
