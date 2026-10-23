---
description: Turn Timatic time tracking on or off for the folder Claude Code runs in, and choose the customer and optional budget it is booked on. Use when the user says this folder or project should (not) be tracked in Timatic, or wants to set, change or check its customer (klant) or budget.
argument-hint: "[off|customer name]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" suggest*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" customers*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-customer*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-budget*)
---

Set up tracking for the folder Claude Code runs in. The choices apply to every folder below this one, unless a subfolder has its own. Whether to track is saved in the plugin's own data, not in the repository.

Whenever an event names a ticket that is mapped in Timatic (for Jira: the project is mapped to a customer), Timatic books it on that ticket's customer and budget, whatever is chosen here. The choice here covers everything else.

1. If the user asked for `off`, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" track off`, report the outcome in one line and stop.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" suggest`. When the ticket in the git branch is mapped, it names that customer and budget: offer them first, as the recommended option.
3. List the customers, filtered on the user's search text if given (leave out `on`):

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" customers <search>
   ```

   Each line is `<id><TAB><name>`. If it answers that the user is not logged in, suggest `/timatic:login` and stop.
4. If exactly one customer matches what the user asked for, use it. Otherwise ask the user to pick one, with the AskUserQuestion tool when there are four or fewer candidates, or by name from a short list.
5. Save it, which also turns tracking on: `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" set-customer <id>`. For the suggested customer with a budget, also run `set-budget <id>` with that budget and skip the next step.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs" budgets`. If it lists budgets (`<id><TAB><title>`), ask whether all work in this folder is for one of them, and always offer "No specific budget" as an option. Then run `set-budget <id>`, or `set-budget none` for no specific budget.
7. Report the outcome in one line. If the output says the mapping was saved in a file to commit, pass that on.
