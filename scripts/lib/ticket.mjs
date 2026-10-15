import { execFileSync } from 'node:child_process';

/**
 * Jira style keys: a project key of capitals and digits, a dash and a number.
 */
export const DEFAULT_TICKET_PATTERN = '\\b[A-Z][A-Z0-9]{1,9}-[0-9]{1,7}\\b';

/**
 * Things that look like a ticket key but are standards, encodings and hashes.
 */
const NOT_A_TICKET = /^(UTF|UCS|ISO|SHA|MD|RFC|CVE|PEP|PSR|HTTP|TLS|SSL|ES|ECMA|IEEE|AES|RSA|X|COVID|GPT|WCAG|BS|EN|NEN|IEC|H|E|V)-/;

function compile(pattern) {
  try {
    return new RegExp(pattern || DEFAULT_TICKET_PATTERN, 'g');
  } catch {
    return new RegExp(DEFAULT_TICKET_PATTERN, 'g');
  }
}

/**
 * The last ticket mentioned in a text, since a prompt that names several usually ends on the one
 * being worked on ("like in ABC-1, but for ABC-2").
 */
export function findTicket(text, pattern) {
  if (typeof text !== 'string' || text === '') {
    return null;
  }

  const matches = [...text.matchAll(compile(pattern))]
    .map((match) => match[0])
    .filter((key) => !NOT_A_TICKET.test(key));

  return matches.at(-1) ?? null;
}

/**
 * Branches are commonly named after their ticket, as in feature/ABC-123-short-title, and often in
 * lower case, so the key is matched case insensitively. A detached head has no branch to read.
 */
export function ticketFromBranch(cwd, pattern) {
  try {
    const branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();

    return findTicket(branch.toUpperCase(), pattern);
  } catch {
    return null;
  }
}

/**
 * Picks the ticket for this turn. Something said explicitly beats something mentioned in passing:
 * a ticket set with /timatic:ticket stays until it is replaced, one named in a prompt replaces an
 * earlier one, and the branch only fills in when nothing better is known.
 *
 * @returns {{ticket: ?string, ticketSource: ?string}}
 */
export function resolveTicket(session, { prompt, branchTicket, pattern }) {
  if (session.ticketSource === 'explicit') {
    return { ticket: session.ticket, ticketSource: 'explicit' };
  }

  const fromPrompt = findTicket(prompt, pattern);

  if (fromPrompt) {
    return { ticket: fromPrompt, ticketSource: 'prompt' };
  }

  if (session.ticket && session.ticketSource !== 'branch') {
    return { ticket: session.ticket, ticketSource: session.ticketSource };
  }

  if (branchTicket) {
    return { ticket: branchTicket, ticketSource: 'branch' };
  }

  return { ticket: session.ticket ?? null, ticketSource: session.ticketSource ?? null };
}
