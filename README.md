# Timatic for Claude Code

A Claude Code plugin that logs your work in [Timatic](https://github.com/timatic/timatic-backend).
Every prompt you send, every question of Claude's you answer and every response Claude completes
becomes an event on Timatic's `/events` api. Timatic turns those events into activities and entry
suggestions per customer and ticket.

## Install

```
/plugin marketplace add tomasvanrijsse/timatic-claude
/plugin install timatic@timatic
```

Claude Code asks for your Timatic url when you enable the plugin, for example
`https://api.timatic.example`. You can also leave it empty and pass it on first login. The plugin
needs `node` 18 or later on your `PATH`.

## First use

1. `/timatic:login` opens your browser. You log in to Timatic with your own account and approve
   "Claude Code plugin". The plugin gets a token of its own, valid for 90 days.
2. In every folder you have not decided on yet, Claude asks at the start of the session whether
   Timatic should track your time there. If so, it asks for which customer and, optionally, whether
   all work there is for one budget of that customer. Your answers are remembered for that folder
   and every folder below it.

## Commands

| Command | What it does |
|---|---|
| `/timatic:login [--url <url>]` | Log in, or log in again after the token expired |
| `/timatic:logout` | Revoke this installation's token |
| `/timatic:customer [search]` | Choose the customer for the current folder (turns tracking on) |
| `/timatic:budget [search\|none]` | Book all work in the current folder on one budget of its customer, or on none |
| `/timatic:track on\|off` | Turn tracking on or off for the current folder |
| `/timatic:ticket <KEY\|clear>` | Set the ticket for the rest of this session |
| `/timatic:status` | Show login, folder, customer, budget, ticket from the git branch and the outgoing queue |

## What is sent

| Moment | Hook | Event type | Time span |
|---|---|---|---|
| You send a prompt | `UserPromptSubmit` | `claude_prompt_submitted` | Ends when you send it; Timatic estimates the time spent writing |
| You answer a question from Claude | `PostToolUse` on `AskUserQuestion` | `claude_question_answered` | From the question to your answer |
| Claude finishes responding | `Stop` | `claude_response_completed` | From your prompt to the end of the response |

Each event carries:

- `sourceId`: `claude_code`
- `userId`: the user you logged in as
- `customerId`: the customer chosen for the folder
- `budgetId`: the budget chosen for the folder, if any
- `ticketNumber`: the ticket, when one is known (see below)
- `title`: `Claude Code: <folder name>`
- `description`: the session name, as set with `/rename`

Your prompt text and Claude's responses are **not** sent. They are only searched locally for a
ticket key.

Nothing is sent from a folder you declined. Before you decide on a folder, events are held for the
current session and sent once you say yes. When Timatic cannot be reached they are queued and sent
with the next event.

## Ticket detection

The plugin looks for a Jira style key such as `ABC-123`. When several sources have one, the first
in this order wins:

1. A ticket set with `/timatic:ticket`
2. The last key mentioned in one of your prompts in this session
3. The git branch of the folder Claude Code runs in, for example `feature/abc-123-login-form`
4. A key in Claude's response, when nothing else was found

Common look-alikes such as `UTF-8`, `SHA-256` and `ISO-8601` are ignored. For another key format,
set `ticketPattern` (a JavaScript regular expression) on the folder in `projects.json`, see below.

## Where things are stored

In `~/.config/timatic-claude/` (or `$XDG_CONFIG_HOME/timatic-claude`, or `$TIMATIC_HOME`):

- `credentials.json`: your token, readable by you only
- `projects.json`: per folder, whether it is tracked and on which customer and budget. You can
  also add `isInternal` and `ticketPattern` to a folder here.
- `sessions/`: per session, its title, ticket and the start of the current turn. Pruned after 14 days.
- `queue.json`: events waiting for Timatic to be reachable

Set `TIMATIC_DEBUG=1` to see hook errors on stderr.

## Development

```
npm test
claude --plugin-dir .
```

The plugin has no dependencies. Everything runs through `scripts/timatic.mjs`.
