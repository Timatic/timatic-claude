---
description: Show whether Timatic logging works here - who is logged in, which customer this project is booked on, the ticket from the git branch and how many events wait to be sent.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" status)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" status` and show the result to the user as is.
