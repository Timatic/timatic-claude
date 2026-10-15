---
description: Log out of Timatic and revoke the token of this Claude Code installation.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" logout)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" logout` and report the outcome in one line.
