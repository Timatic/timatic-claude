import { join } from 'node:path';
import { request } from './api.mjs';
import { dataDir, readJson, writeJson } from './store.mjs';

export const SOURCE_ID = 'claude_code';

export const EVENT_TYPES = {
  promptSubmitted: 'claude_prompt_submitted',
  questionAnswered: 'claude_question_answered',
  responseCompleted: 'claude_response_completed',
};

/**
 * Timatic refuses events longer than this, and a turn that ran this long was not watched anyway.
 */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Events that could not be delivered wait here for the next hook. Timatic keeps events for thirty
 * days, so anything older is not worth sending any more.
 */
const QUEUE_LIMIT = 500;
const QUEUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function queuePath() {
  return join(dataDir(), 'queue.json');
}

/**
 * @param {{eventTypeId: string, userId: number, endedAt: Date, startedAt?: ?Date, project: object, ticket?: ?string, title?: ?string, description?: ?string}} event
 */
export function buildEvent({ eventTypeId, userId, startedAt, endedAt, project, ticket, title, description }) {
  const attributes = {
    sourceId: SOURCE_ID,
    eventTypeId,
    userId,
    endedAt: endedAt.toISOString(),
  };

  if (startedAt && startedAt <= endedAt && endedAt - startedAt <= MAX_DURATION_MS) {
    attributes.startedAt = startedAt.toISOString();
  }

  if (Number.isInteger(project.customerId)) {
    attributes.customerId = project.customerId;
  }

  if (Number.isInteger(project.budgetId)) {
    attributes.budgetId = project.budgetId;
  }

  if (typeof project.isInternal === 'boolean') {
    attributes.isInternal = project.isInternal;
  }

  if (ticket) {
    attributes.ticketNumber = ticket;
  }

  if (title) {
    attributes.title = title.slice(0, 255);
  }

  if (description) {
    attributes.description = description;
  }

  return { data: { type: 'events', attributes } };
}

function isRetryable(error) {
  return error.status === 0 || error.status === 401 || error.status === 429 || error.status >= 500;
}

/**
 * Sends the event together with whatever earlier hooks could not deliver. A network error, an
 * expired token or a server error keeps an event for later; a 422 means Timatic will never take
 * it, so it is dropped rather than retried forever.
 *
 * @returns {Promise<{sent: number, queued: number, dropped: Array<string>}>}
 */
export async function sendEvents(credentials, events, now = Date.now()) {
  const queued = readJson(queuePath(), []) ?? [];
  const pending = [
    ...queued.filter((item) => now - Date.parse(item.queuedAt) < QUEUE_MAX_AGE_MS),
    ...events.map((body) => ({ body, queuedAt: new Date(now).toISOString() })),
  ];

  const remaining = [];
  const dropped = [];
  let sent = 0;
  let unreachable = false;

  for (const item of pending) {
    if (unreachable) {
      remaining.push(item);
      continue;
    }

    try {
      await request(credentials.baseUrl, '/events', { method: 'POST', token: credentials.token, body: item.body });
      sent++;
    } catch (error) {
      if (isRetryable(error)) {
        remaining.push(item);
        unreachable = true;
      } else {
        dropped.push(error.message);
      }
    }
  }

  if (queued.length > 0 || remaining.length > 0) {
    writeJson(queuePath(), remaining.slice(-QUEUE_LIMIT));
  }

  return { sent, queued: remaining.length, dropped };
}

export function queuedCount() {
  return (readJson(queuePath(), []) ?? []).length;
}
