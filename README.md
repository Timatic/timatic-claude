# Timatic for Claude Code

A Claude Code plugin that logs your work in [Timatic](https://github.com/timatic/timatic-backend).
Every prompt you send and every question of Claude's you answer becomes an event on Timatic's
`/events` api. Timatic turns those events into activities and entry suggestions per customer and
ticket.

## Install

This repository is its own plugin marketplace (`.claude-plugin/marketplace.json`), so Claude Code
installs it straight from GitHub. Nothing has to be uploaded anywhere. In Claude Code, run these
one at a time:

```
/plugin marketplace add Timatic/timatic-claude
```

```
/plugin install timatic@timatic
```

Or from a terminal:

```
claude plugin marketplace add Timatic/timatic-claude
claude plugin install timatic@timatic
```

Claude Code reads the repository's default branch, and needs access to it: for a private
repository, your own git credentials must be able to clone it. Run `/plugin marketplace update
timatic` to pick up a new version.

To roll it out to a whole team, add the marketplace and plugin to a project's
`.claude/settings.json`; Claude Code then offers to install it to everyone who trusts that folder:

```json
{
  "extraKnownMarketplaces": {
    "timatic": { "source": { "source": "github", "repo": "Timatic/timatic-claude" } }
  },
  "enabledPlugins": { "timatic@timatic": true }
}
```

The plugin needs `node` 18 or later on your `PATH`.

## First use

1. Run `/timatic:login`. It asks for your Timatic url (for example `https://api.timatic.example`;
   set `TIMATIC_URL` to skip the question) and opens your browser. You log in to Timatic with your own account and approve
   "Claude Code plugin". The plugin gets a token of its own. It expires only after 90 days without
   use: every use pushes the expiry forward, so while you keep using Claude Code you never have to
   log in again.
2. That's it. Tracking runs silently: a repository Timatic maps in its Bitbucket or GitHub
   integration is tracked on that customer, everything else is not tracked. Use `/timatic:track`
   to track a folder yourself, or to stop tracking one.

## Business work without a mapping

To make sure business work is never silently lost, an organisation lists the git remotes that
hold it in the plugin's `settings.json` (see "Where things are stored"), for example rolled out to
everyone through MDM:

```json
{
  "trackedGitRemotePrefixes": ["github.com/acme", "bitbucket.org/acme"]
}
```

Or let Claude add one with `/timatic:tracked-prefixes add github.com/acme`. Prefixes are in `host/owner` form, whether you clone over ssh or https. When
Claude Code starts in a repository under one of them that Timatic has no mapping for, Claude says so
and asks for the customer and budget.

## Sharing a repository's mapping with your team

Map the repository in Timatic's Bitbucket or GitHub integration. The first time someone starts
Claude Code in a clone of it, the plugin finds that mapping by the git remote and saves it for them,
without asking anything.

For a repository Timatic does not know, `/timatic:track` asks where to save the customer and budget.
Saved for yourself (the default), they stay in the plugin's own data, keyed by the git remote so
every clone of it finds them. Saved in the repository, they go to `.claude/timatic.json`
at its root; commit it and a teammate with the plugin is tracked on the same customer and budget.
A personal mapping beats the repository's file.
Whether to track stays personal, so `/timatic:track off` still opts a teammate out. Add
`ticketPattern` to this file for a repository whose tickets use another key format.

```json
{
  "customerId": 8,
  "customerName": "Globex",
  "budgetId": null,
  "budgetTitle": null
}
```

## Commands

| Command | What it does |
|---|---|
| `/timatic:login [--url <url>]` | Set up: ask for the url and log in, or log in again after the token expired |
| `/timatic:logout` | Revoke this installation's token |
| `/timatic:tracked-prefixes [list\|add\|remove <prefix>]` | Manage the git remote prefixes of business work |
| `/timatic:track [off\|customer]` | Track the current folder and choose its customer and optional budget, or stop tracking it |

## What is sent

| Moment | Hook | Event type | Time span |
|---|---|---|---|
| You send a prompt | `UserPromptSubmit` | `claude_prompt_submitted` | Ends when you send it; Timatic estimates the time spent writing |
| You answer a question from Claude | `PostToolUse` on `AskUserQuestion` | `claude_question_answered` | From the question to your answer |

Each event carries:

- `sourceId`: `claude_code`
- `userId`: the user you logged in as
- `customerId`: the customer chosen for the folder (Timatic overrides it for a mapped ticket, see below)
- `budgetId`: the budget chosen for the folder, if any
- `ticketNumber`: the ticket, when one is known (see below)
- `title`: `Claude Code: <folder name>`
- `description`: the session name, as set with `/rename`, or else a summary of your prompts of the
  last 15 minutes

Your prompt text and Claude's responses are **not** sent to Timatic. Prompts are searched locally
for a ticket key. When the session has no name, the plugin asks Claude Code itself
(`claude -p --model haiku`, without tools) to summarise the prompts of the last quarter of an hour
in at most ten words, and sends only that summary. This runs in the background and only for folders
you track. Set `TIMATIC_CLAUDE_BIN` if `claude` is not on the `PATH` of your hooks.

Nothing is sent from a folder that is not tracked. Before a folder is set up, events of the current
session are held and sent once you choose a customer for it. When Timatic cannot be reached, or no longer accepts your
login, events are queued (up to 500, for at most 30 days) and sent with the next event or right after
`/timatic:login`. Events queued under another Timatic user are dropped when you log in.

## Ticket detection

The plugin looks for a Jira style key such as `ABC-123`. When several sources have one, the first
in this order wins:

1. The last key mentioned in one of your prompts in this session
2. The git branch of the folder Claude Code runs in, for example `feature/abc-123-login-form`

Common look-alikes such as `UTF-8`, `SHA-256` and `ISO-8601` are ignored. For another key format,
set `ticketPattern` (a JavaScript regular expression) in the repository's `.claude/timatic.json`, or
on the folder in `projects.json` (see below).

## Customer and budget from the ticket

A ticket is the best evidence of where work belongs: one repository can hold work for several
customers, but a ticket belongs to one. When an event names a ticket whose project is mapped in
Timatic (for Jira: the project mapping in the Jira integration), Timatic books the event on that
customer and budget, whatever the folder says. The folder's customer and budget cover everything
else.

When you set up a folder, Claude first looks up the ticket in the git branch and proposes its
customer and budget.

## Where things are stored

In `~/.config/timatic-claude/` (or `$XDG_CONFIG_HOME/timatic-claude`, or `$TIMATIC_HOME`):

- `credentials.json`: your token, readable by you only
- `settings.json`: the `trackedGitRemotePrefixes` of business work, see above
- `projects.json`: per git remote (or per folder outside git repositories), whether it is tracked
  and, unless the repository's `.claude/timatic.json` covers it, on which customer and budget. You can also add `isInternal` and `ticketPattern` to a folder here.
- `sessions/`: per session, its title, ticket, the prompts of the last 15 minutes and their
  summary. Pruned after 14 days.
- `queue.json`: events waiting for Timatic to be reachable

Set `TIMATIC_DEBUG=1` to see hook errors on stderr.

## Development

```
npm test
claude --plugin-dir .
```

The plugin has no dependencies. Everything runs through `scripts/timatic.mjs`.
