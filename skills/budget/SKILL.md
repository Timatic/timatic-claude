---
description: Choose the Timatic budget that all work in this folder is booked on, or clear it. Use when the user wants to set, change or remove the budget for this project or folder in Timatic.
argument-hint: "[budget title|none]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget*)
---

Choose the budget for the folder Claude Code runs in. A budget is optional: without one, Timatic suggests where the time goes.

1. If the user asked for `none`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget none`, report the outcome and stop.
2. List the open budgets of this folder's customer:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets
   ```

   Each line is `<id><TAB><title>`. If it says no customer is chosen yet, follow `/timatic:customer` instead.
3. If exactly one budget matches what the user asked for, use it. Otherwise ask the user to pick one, and always offer "No specific budget" as an option.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget <id>`, or `set-budget none` for no specific budget, and report the outcome in one line. If the output says the mapping was saved in a file to commit, pass that on.
