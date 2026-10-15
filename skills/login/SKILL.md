---
description: Log in to Timatic with your own account so your Claude Code prompts and answers are logged as time events. Use when the user wants to connect, log in to or re-authenticate with Timatic.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" login*)
---

Log the user in to Timatic.

1. Run this command with a Bash timeout of 300000 ms, because it waits for the user to finish logging in in the browser:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" login $ARGUMENTS
   ```

2. If it answers that no Timatic url is known, ask the user for the url of their Timatic backend and run it again with `--url <url>`.
3. While it waits, tell the user a browser window opened (and show the printed url in case it did not).
4. Report the outcome in one line. If no customer is set for this project yet, suggest `/timatic:customer`.
