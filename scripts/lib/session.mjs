import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, readJson, removeFile, writeJson } from './store.mjs';

const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

function sessionsDir() {
  return join(dataDir(), 'sessions');
}

function sessionPath(sessionId) {
  return join(sessionsDir(), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

/**
 * What one Claude Code session has told us so far: its title, the ticket it is about, its recent
 * prompts and their summary. Only some hook payloads carry the title, so it has to be remembered.
 *
 * @returns {{title?: string, ticket?: string, ticketSource?: string, recentPrompts?: Array<{at: string, text: string}>, summary?: string, summaryKey?: string, questionsAskedAt?: Record<string, string>, heldEvents?: Array<object>}}
 */
export function loadSession(sessionId) {
  return sessionId ? readJson(sessionPath(sessionId), {}) ?? {} : {};
}

export function saveSession(sessionId, session) {
  if (sessionId) {
    writeJson(sessionPath(sessionId), session);
  }
}

export function updateSession(sessionId, change) {
  const session = change(loadSession(sessionId));
  saveSession(sessionId, session);

  return session;
}

export function pruneSessions(now = Date.now()) {
  let names = [];

  try {
    names = readdirSync(sessionsDir());
  } catch {
    return;
  }

  for (const name of names) {
    const path = join(sessionsDir(), name);

    try {
      if (now - statSync(path).mtimeMs > STALE_AFTER_MS) {
        removeFile(path);
      }
    } catch {
      // Another session pruned it first.
    }
  }
}
