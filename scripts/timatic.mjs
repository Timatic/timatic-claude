#!/usr/bin/env node
import { basename } from 'node:path';
import { fetchBudget, fetchBudgets, fetchCustomer, fetchCustomers, fetchTicket } from './lib/api.mjs';
import {
  findProject, forgetCredentials, loadCredentials, resolveBaseUrl, saveCredentials, saveProject, workingDir,
} from './lib/config.mjs';
import { buildEvent, EVENT_TYPES, keepQueuedEventsOf, queuedCount, sendEvents } from './lib/events.mjs';
import { login, logout } from './lib/oauth.mjs';
import { loadSession, pruneSessions, saveSession } from './lib/session.mjs';
import { recentPrompts, rememberPrompt, summarize, SUMMARIZING_ENV, summaryKey } from './lib/summary.mjs';
import { resolveTicket, ticketFromBranch } from './lib/ticket.mjs';

async function readStdin() {
  if (process.stdin.isTTY) {
    return {};
  }

  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    return JSON.parse(input || '{}');
  } catch {
    return {};
  }
}

function requireCredentials() {
  const credentials = loadCredentials();

  if (!credentials) {
    throw new Error('Not logged in to Timatic. Run /timatic:login first.');
  }

  return credentials;
}

/**
 * Events from before the user decided whether to track a folder are held in the session, so the
 * first prompt (the one Claude answers with that question) is not lost once they say yes.
 */
const MAX_HELD_EVENTS = 20;

/**
 * Turns one hook payload into the Timatic events to send now, keeping track of the session along
 * the way. Exported for the tests; hooks reach it through `timatic.mjs hook <name>`.
 *
 * @returns {Array<object>}
 */
export function handleHook(name, input, { now = new Date(), branchTicket } = {}) {
  const sessionId = input.session_id;
  const session = loadSession(sessionId);
  const { directory, config } = findProject(input.cwd);
  const project = config ?? {};

  if (typeof input.session_title === 'string' && input.session_title.trim() !== '') {
    session.title = input.session_title.trim();
  }

  const { ticket, ticketSource } = resolveTicket(session, {
    prompt: name === 'prompt-submitted' ? input.prompt : null,
    branchTicket: branchTicket === undefined ? ticketFromBranch(input.cwd || directory, project.ticketPattern) : branchTicket,
    pattern: project.ticketPattern,
  });

  session.ticket = ticket;
  session.ticketSource = ticketSource;

  let eventTypeId = null;
  let startedAt = null;

  switch (name) {
    case 'session-start':
      break;
    case 'prompt-submitted':
      // No start: Timatic estimates the time spent writing the prompt itself.
      eventTypeId = EVENT_TYPES.promptSubmitted;
      session.recentPrompts = rememberPrompt(session.recentPrompts, input.prompt, now);
      break;
    case 'question-asked':
      session.questionsAskedAt = { ...session.questionsAskedAt, [input.tool_use_id]: now.toISOString() };
      break;
    case 'question-answered':
      eventTypeId = EVENT_TYPES.questionAnswered;
      startedAt = session.questionsAskedAt?.[input.tool_use_id] ?? null;
      delete session.questionsAskedAt?.[input.tool_use_id];
      break;
    default:
      throw new Error(`Unknown hook ${name}`);
  }

  const events = session.heldEvents ?? [];

  if (eventTypeId !== null) {
    events.push({
      eventTypeId,
      startedAt,
      endedAt: now.toISOString(),
      ticket,
      title: `Claude Code: ${basename(directory)}`,
    });
  }

  if (config === null) {
    session.heldEvents = events.slice(-MAX_HELD_EVENTS);
    saveSession(sessionId, session);

    return [];
  }

  delete session.heldEvents;
  saveSession(sessionId, session);

  if (!config.tracked) {
    return [];
  }

  // The title may only have become known after an event was held, so it is filled in on sending.
  // Without one, describe() fills in a summary of the recent prompts just before sending.
  return events.map((event) => ({
    ...event,
    startedAt: event.startedAt ? new Date(event.startedAt) : null,
    endedAt: new Date(event.endedAt),
    project,
    description: session.title ?? null,
  }));
}

/**
 * Tells Claude, once per session, what is still to be settled, so it can ask the user or point them
 * to the right command. Anything printed here ends up in Claude's context; once all is settled it
 * stays silent.
 */
export function sessionStartNotice(input, command = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/timatic.mjs"') {
  const credentials = loadCredentials();
  const { directory, config } = findProject(input.cwd);

  if (config && !config.tracked) {
    return '';
  }

  // Choosing a customer needs Timatic, so the folder waits until the login works.
  if (!credentials) {
    return 'Timatic plugin: The user has not set up Timatic yet, so nothing is sent. Suggest running /timatic:login, which asks for their Timatic url and logs them in.';
  }

  if (credentials.rejectedAt) {
    return 'Timatic plugin: Timatic no longer accepts the login (it expired or was revoked). Events are kept and sent once the user runs /timatic:login; suggest doing so.';
  }

  const notices = [];

  if (config === null) {
    notices.push(
      `The user has not yet decided whether Timatic should track time spent in ${workingDir(input.cwd)}.`,
      'Before anything else in your first reply, ask them with the AskUserQuestion tool:',
      '"Should Timatic track your time in this folder?" with the options "Yes" and "No".',
      `On "No", run \`${command} track off\` and carry on with their request.`,
      `On "Yes", first run \`${command} suggest\`: when the ticket in the git branch is mapped in Timatic, it names that customer and budget.`,
      `Then run \`${command} customers\` (lines of id<TAB>name) and ask which customer this folder is for.`,
      'Offer the suggested customer (with its budget) first, marked as recommended.',
      `On a customer, run \`${command} set-customer <id>\`; for the suggested one with a budget, also \`${command} set-budget <id>\` and carry on.`,
      `Then run \`${command} budgets\` and, if it lists any, ask whether all work in this folder is for one specific budget;`,
      'this is optional, so always offer "No specific budget" as an option.',
      `On a budget, run \`${command} set-budget <id>\`. Then carry on with their request.`,
    );
  } else if (!Number.isInteger(config.customerId)) {
    notices.push(`No Timatic customer is set for ${directory}, so time arrives without one. Suggest running /timatic:customer.`);
  }

  return notices.length ? `Timatic plugin: ${notices.join(' ')}` : '';
}

/**
 * The session's own name when the user gave it one, and otherwise what the prompts of the last
 * quarter of an hour were about. A summary is remembered, so the next event with the same prompts
 * does not ask for it again.
 */
async function describe(sessionId, now = new Date()) {
  const session = loadSession(sessionId);

  if (session.title) {
    return session.title;
  }

  const prompts = recentPrompts(session.recentPrompts, now);

  if (prompts.length === 0) {
    return session.summary ?? null;
  }

  const key = summaryKey(prompts);

  if (session.summaryKey === key) {
    return session.summary;
  }

  const summary = await summarize(prompts);

  if (summary) {
    // Read again: another hook of this session may have written in the meantime.
    saveSession(sessionId, { ...loadSession(sessionId), summary, summaryKey: key });
  }

  return summary ?? session.summary ?? null;
}

async function runHook(name) {
  // The headless Claude Code that writes a summary runs this plugin's hooks too.
  if (process.env[SUMMARIZING_ENV]) {
    return;
  }

  const input = await readStdin();

  // A hook must never break the session it runs in, so every failure ends here, silently.
  try {
    const events = handleHook(name, input);

    if (name === 'session-start') {
      pruneSessions();
      const notice = sessionStartNotice(input, `node "${process.env.CLAUDE_PLUGIN_ROOT ?? '${CLAUDE_PLUGIN_ROOT}'}/scripts/timatic.mjs"`);

      if (notice) {
        process.stdout.write(`${notice}\n`);
      }

      return;
    }

    const credentials = loadCredentials();

    if (events.length === 0 || !credentials) {
      return;
    }

    const description = await describe(input.session_id);

    const { unauthorized } = await sendEvents(credentials, events.map((event) => buildEvent({
      ...event,
      description: event.description ?? description,
      userId: credentials.user.id,
    })));

    if (unauthorized && !credentials.rejectedAt) {
      saveCredentials({ ...credentials, rejectedAt: new Date().toISOString() });
    }
  } catch (error) {
    if (process.env.TIMATIC_DEBUG) {
      process.stderr.write(`timatic: ${error.stack ?? error.message}\n`);
    }
  }
}

function argument(args, flag) {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

const commands = {
  async login(args) {
    const baseUrl = resolveBaseUrl(argument(args, '--url'));

    if (!baseUrl) {
      throw new Error('No Timatic url known. Ask the user for it and pass it with --url https://your-timatic-backend');
    }

    const credentials = await login(baseUrl);
    saveCredentials(credentials);
    console.log(`Logged in to ${baseUrl} as ${credentials.user.fullName} <${credentials.user.email}>.`);

    keepQueuedEventsOf(credentials.user.id);
    const { sent } = await sendEvents(credentials, []);

    if (sent > 0) {
      console.log(`Delivered ${sent} event(s) that were waiting.`);
    }

    const notice = sessionStartNotice({}, `node "${process.argv[1]}"`);

    if (notice) {
      console.log(notice);
    }
  },

  async logout() {
    const credentials = loadCredentials();

    if (credentials) {
      await logout(credentials).catch(() => {});
    }

    forgetCredentials();
    console.log('Logged out of Timatic.');
  },

  async status() {
    const credentials = loadCredentials();
    const { directory, config } = findProject();
    const branchTicket = ticketFromBranch(workingDir(), config?.ticketPattern);

    console.log(credentials
      ? `Logged in to ${credentials.baseUrl} as ${credentials.user.fullName} <${credentials.user.email}>${credentials.rejectedAt ? ', but Timatic no longer accepts that login: run /timatic:login' : ''}.`
      : 'Not logged in to Timatic.');
    console.log(config === null
      ? `Not decided yet whether ${directory} is tracked.`
      : !config.tracked
        ? `${directory} is not tracked.`
        : Number.isInteger(config.customerId)
          ? `${directory} is tracked on ${config.customerName ?? '?'} (#${config.customerId})${Number.isInteger(config.budgetId) ? `, budget ${config.budgetTitle ?? '?'} (#${config.budgetId})` : ', no specific budget'}.`
          : `${directory} is tracked, without a customer.`);
    console.log(`Ticket from the git branch: ${branchTicket ?? 'none'}.`);
    console.log(`Events waiting to be sent: ${queuedCount()}.`);
  },

  async customers(args) {
    const credentials = requireCredentials();
    const search = args.join(' ').trim().toLowerCase();
    const customers = (await fetchCustomers(credentials.baseUrl, credentials.token))
      .filter((customer) => customer.name.toLowerCase().includes(search));

    if (customers.length === 0) {
      console.log(search ? `No customer matches "${search}".` : 'No customers found.');

      return;
    }

    for (const customer of customers) {
      console.log(`${customer.id}\t${customer.name}`);
    }
  },

  async 'set-customer'(args) {
    const credentials = requireCredentials();
    const customerId = Number(args[0]);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new Error('Usage: set-customer <customer id>');
    }

    const customer = await fetchCustomer(credentials.baseUrl, credentials.token, customerId);
    const directory = workingDir();

    const previous = findProject(directory).config;
    // A budget belongs to one customer, so it does not survive a change of customer.
    const budget = previous?.customerId === customer.id
      ? { budgetId: previous.budgetId ?? null, budgetTitle: previous.budgetTitle ?? null }
      : { budgetId: null, budgetTitle: null };

    saveProject(directory, { tracked: true, customerId: customer.id, customerName: customer.name, ...budget });
    console.log(`Timatic now tracks ${directory} on ${customer.name} (#${customer.id}).`);
  },

  /**
   * What the ticket of the git branch (or the one given) is mapped to in Timatic, so Claude can
   * propose it when the user sets up a folder.
   */
  async suggest(args) {
    const credentials = requireCredentials();
    const key = args[0]?.toUpperCase() ?? ticketFromBranch(workingDir(), findProject().config?.ticketPattern);

    if (!key) {
      console.log('No ticket in the git branch, so there is nothing to suggest.');

      return;
    }

    const ticket = await fetchTicket(credentials.baseUrl, credentials.token, key);

    if (ticket === null) {
      console.log(`Timatic does not know ticket ${key}.`);

      return;
    }

    if (!Number.isInteger(ticket.customerId)) {
      console.log(`Ticket ${key} (${ticket.title}) is not mapped to a customer in Timatic.`);

      return;
    }

    const customer = await fetchCustomer(credentials.baseUrl, credentials.token, ticket.customerId);
    const budget = Number.isInteger(ticket.budgetId)
      ? await fetchBudget(credentials.baseUrl, credentials.token, ticket.budgetId)
      : null;

    console.log(`Ticket ${key} (${ticket.title}) is mapped to customer ${customer.name} (#${customer.id})${
      budget ? ` and budget ${budget.title} (#${budget.id})` : ', without a budget'}.`);
  },

  async budgets() {
    const credentials = requireCredentials();
    const { config } = findProject();

    if (!Number.isInteger(config?.customerId)) {
      throw new Error('Choose a customer for this folder first, with /timatic:customer.');
    }

    const budgets = await fetchBudgets(credentials.baseUrl, credentials.token, config.customerId);

    if (budgets.length === 0) {
      console.log(`${config.customerName ?? 'This customer'} has no open budgets.`);

      return;
    }

    for (const budget of budgets) {
      console.log(`${budget.id}\t${budget.title}`);
    }
  },

  async 'set-budget'(args) {
    const credentials = requireCredentials();
    const directory = workingDir();
    const { config } = findProject(directory);

    if (!Number.isInteger(config?.customerId)) {
      throw new Error('Choose a customer for this folder first, with /timatic:customer.');
    }

    if (args[0] === 'none') {
      saveProject(directory, { ...config, budgetId: null, budgetTitle: null });
      console.log(`Work in ${directory} is no longer booked on a specific budget.`);

      return;
    }

    const budgetId = Number(args[0]);

    if (!Number.isInteger(budgetId) || budgetId <= 0) {
      throw new Error('Usage: set-budget <budget id|none>');
    }

    const budget = await fetchBudget(credentials.baseUrl, credentials.token, budgetId);

    if (budget.customerId !== config.customerId) {
      throw new Error(`Budget #${budget.id} does not belong to ${config.customerName ?? `customer #${config.customerId}`}.`);
    }

    saveProject(directory, { ...config, budgetId: budget.id, budgetTitle: budget.title });
    console.log(`Work in ${directory} is now booked on budget ${budget.title} (#${budget.id}).`);
  },

  async track(args) {
    const directory = workingDir();

    if (!['on', 'off'].includes(args[0])) {
      throw new Error('Usage: track <on|off>');
    }

    saveProject(directory, { tracked: args[0] === 'on' });
    console.log(args[0] === 'on'
      ? `Timatic tracks ${directory}. Choose its customer with /timatic:customer.`
      : `Timatic no longer tracks ${directory}; nothing from here is sent. Undo with /timatic:track on.`);
  },

  async ticket(args) {
    const sessionId = argument(args, '--session');
    const key = args.filter((arg, index) => arg !== '--session' && args[index - 1] !== '--session')[0];

    if (!sessionId) {
      throw new Error('Usage: ticket <KEY|clear> --session <session id>');
    }

    const session = loadSession(sessionId);

    if (!key || key === 'clear') {
      delete session.ticket;
      delete session.ticketSource;
      saveSession(sessionId, session);
      console.log('Ticket cleared; it is detected from prompts and the git branch again.');

      return;
    }

    session.ticket = key.toUpperCase();
    session.ticketSource = 'explicit';
    saveSession(sessionId, session);
    console.log(`This session is now logged on ticket ${session.ticket}.`);
  },
};

async function main([command, ...args]) {
  if (command === 'hook') {
    await runHook(args[0]);

    return;
  }

  if (!commands[command]) {
    console.error(`Usage: timatic.mjs <${Object.keys(commands).join('|')}>`);
    process.exitCode = 2;

    return;
  }

  try {
    await commands[command](args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('timatic.mjs')) {
  await main(process.argv.slice(2));
}
