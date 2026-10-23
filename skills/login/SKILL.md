---
description: Set up Timatic - ask for the Timatic url, log in with your own account so your Claude Code prompts and answers are logged as time events, then set up this folder. Use when the user wants to set up, connect, log in to or re-authenticate with Timatic.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" *)
---

Set up Timatic for the user.

1. Run this command with a Bash timeout of 300000 ms, because it waits for the user to finish logging in in the browser:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" login $ARGUMENTS
   ```

2. If it answers that no Timatic url is known, ask the user for the url they open Timatic at (for example `https://acme.timatic.app`), wait for their answer and run it again with `--url <url>`.
3. While it waits, tell the user a browser window opened (and show the printed url in case it did not).
4. Report the outcome in one line. If the output ends with a `Timatic plugin:` notice, follow its instructions now.
