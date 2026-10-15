#!/usr/bin/env node
import { basename } from 'node:path';
import { fetchCustomer, fetchCustomers } from './lib/api.mjs';
import {
  findProject, forgetCredentials, isExpired, loadCredentials, resolveBaseUrl, saveCredentials, saveProject, workingDir,
} from './lib/config.mjs';
import { buildEvent, EVENT_TYPES, queuedCount, sendEvents } from './lib/events.mjs';
import { login, logout } from './lib/oauth.mjs';
import { loadSession, pruneSessions, saveSession } from './lib/session.mjs';
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
    assistantMessage: name === 'response-completed' ? input.last_assistant_message : null,
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
      session.turnStartedAt = now.toISOString();
      break;
    case 'question-asked':
      session.questionsAskedAt = { ...session.questionsAskedAt, [input.tool_use_id]: now.toISOString() };
      break;
    case 'question-answered':
      eventTypeId = EVENT_TYPES.questionAnswered;
      startedAt = session.questionsAskedAt?.[input.tool_use_id] ?? null;
      delete session.questionsAskedAt?.[input.tool_use_id];
      break;
    case 'response-completed':
      // The whole turn, from the prompt to the end of the answer.
      eventTypeId = EVENT_TYPES.responseCompleted;
      startedAt = session.turnStartedAt ?? null;
      delete session.turnStartedAt;
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

  const notices = [];

  if (config === null) {
    notices.push(
      `The user has not yet decided whether Timatic should track time spent in ${workingDir(input.cwd)}.`,
      'Before anything else in your first reply, ask them with the AskUserQuestion tool:',
      '"Should Timatic track your time in this folder?" with the options "Yes" and "No".',
      `On "No", run \`${command} track off\` and carry on with their request.`,
      `On "Yes", run \`${command} customers\` (lines of id<TAB>name), ask which customer this folder is for,`,
      `run \`${command} set-customer <id>\`, then carry on with their request.`,
    );
  } else if (!Number.isInteger(config.customerId)) {
    notices.push(`No Timatic customer is set for ${directory}, so time arrives without one. Suggest running /timatic:customer.`);
  }

  if (!credentials) {
    notices.push('The user is not logged in to Timatic, so nothing is sent yet. Suggest running /timatic:login first.');
  } else if (isExpired(credentials)) {
    notices.push('The Timatic login has expired, so nothing is sent until the user runs /timatic:login.');
  }

  return notices.length ? `Timatic plugin: ${notices.join(' ')}` : '';
}

async function runHook(name) {
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

    if (events.length === 0 || !credentials || isExpired(credentials)) {
      return;
    }

    await sendEvents(credentials, events.map((event) => buildEvent({ ...event, userId: credentials.user.id })));
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
      throw new Error('No Timatic url known. Pass it with --url https://your-timatic-backend');
    }

    const credentials = await login(baseUrl);
    saveCredentials(credentials);
    console.log(`Logged in to ${baseUrl} as ${credentials.user.fullName} <${credentials.user.email}>.`);

    const { sent } = await sendEvents(credentials, []);

    if (sent > 0) {
      console.log(`Delivered ${sent} event(s) that were waiting.`);
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
      ? `Logged in to ${credentials.baseUrl} as ${credentials.user.fullName} <${credentials.user.email}>${isExpired(credentials) ? ' (expired, run /timatic:login)' : ''}.`
      : 'Not logged in to Timatic.');
    console.log(config === null
      ? `Not decided yet whether ${directory} is tracked.`
      : !config.tracked
        ? `${directory} is not tracked.`
        : Number.isInteger(config.customerId)
          ? `${directory} is tracked on ${config.customerName ?? '?'} (#${config.customerId}).`
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

    saveProject(directory, { tracked: true, customerId: customer.id, customerName: customer.name });
    console.log(`Timatic now tracks ${directory} on ${customer.name} (#${customer.id}).`);
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
