---
description: Choose the Timatic customer that time in this folder is booked on. Use when the user wants to set, change or check which Timatic customer (klant) this project or folder belongs to.
argument-hint: "[customer name]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" customers*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-customer*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget*)
---

Link the folder Claude Code runs in to a Timatic customer. This also turns tracking on for the folder. The choice is saved per folder in the plugin's own data, not in the repository.

1. List the customers, filtered on the user's search text if given:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" customers $ARGUMENTS
   ```

   Each line is `<id><TAB><name>`. If it answers that the user is not logged in, suggest `/timatic:login` and stop.
2. If exactly one customer matches what the user asked for, use it. Otherwise ask the user to pick one, with the AskUserQuestion tool when there are four or fewer candidates, or by name from a short list.
3. Save the choice:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-customer <id>
   ```

4. Ask about a budget, which is optional:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets
   ```

   If it lists budgets (`<id><TAB><title>`), ask the user whether all work in this folder is for one of them, and always offer "No specific budget" as an option. On a budget, run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget <id>
   ```

5. Report the outcome in one line.
