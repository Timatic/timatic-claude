import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findTicket, resolveTicket, ticketFromBranch } from '../scripts/lib/ticket.mjs';

test('finds the last ticket key in a text', () => {
  assert.equal(findTicket('Do it like TIM-12, but for TIM-345 please'), 'TIM-345');
  assert.equal(findTicket('nothing to see here'), null);
  assert.equal(findTicket(null), null);
});

test('ignores standards and encodings that look like keys', () => {
  assert.equal(findTicket('Save it as UTF-8 and hash with SHA-256 per ISO-8601'), null);
  assert.equal(findTicket('UTF-8 for ABC-7'), 'ABC-7');
});

test('honours a custom pattern', () => {
  assert.equal(findTicket('see #1234', '#[0-9]+'), '#1234');
});

test('reads the ticket from the git branch, also in lower case', () => {
  const repository = mkdtempSync(join(tmpdir(), 'timatic-git-'));
  execFileSync('git', ['init', '-q', '-b', 'feature/abc-123-login-form'], { cwd: repository });

  assert.equal(ticketFromBranch(repository), 'ABC-123');
});

test('finds no branch ticket outside a git repository', () => {
  assert.equal(ticketFromBranch(mkdtempSync(join(tmpdir(), 'timatic-nogit-'))), null);
});

test('a ticket from a prompt beats the branch and sticks for later turns', () => {
  const first = resolveTicket({}, { prompt: 'fix ABC-2', branchTicket: 'BR-3' });
  assert.deepEqual(first, { ticket: 'ABC-2', ticketSource: 'prompt' });

  assert.deepEqual(resolveTicket(first, { prompt: 'and the tests', branchTicket: 'BR-3' }), first);
});

test('falls back to the branch', () => {
  assert.deepEqual(resolveTicket({}, { prompt: 'hello', branchTicket: 'BR-3' }), { ticket: 'BR-3', ticketSource: 'branch' });
  assert.deepEqual(resolveTicket({}, { prompt: 'hello', branchTicket: null }), { ticket: null, ticketSource: null });
});

test('follows a branch switch', () => {
  const session = { ticket: 'BR-3', ticketSource: 'branch' };

  assert.deepEqual(resolveTicket(session, { branchTicket: 'BR-4' }), { ticket: 'BR-4', ticketSource: 'branch' });
});
