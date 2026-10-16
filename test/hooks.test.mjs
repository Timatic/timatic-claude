import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCredentials, saveCredentials, saveProject } from '../scripts/lib/config.mjs';
import { queuedCount, sendEvents } from '../scripts/lib/events.mjs';
import { handleHook, sessionStartNotice } from '../scripts/timatic.mjs';
import { fakeTimatic, useTemporaryHome } from '../test-support/helpers.mjs';

const script = fileURLToPath(new URL('../scripts/timatic.mjs', import.meta.url));

let project;

function runAsync(args, input) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { env: process.env });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', (status) => resolve({ status, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

beforeEach(() => {
  useTemporaryHome();
  project = mkdtempSync(join(tmpdir(), 'timatic-project-'));
  saveProject(project, { tracked: true, customerId: 7, customerName: 'Acme' });
});

test('a prompt becomes an event with the session title as description', () => {
  handleHook('session-start', { session_id: 's1', cwd: project, session_title: 'Login form' }, { branchTicket: null });

  const [event] = handleHook('prompt-submitted', { session_id: 's1', cwd: project, prompt: 'Build ABC-12' }, {
    now: new Date('2026-10-15T10:00:00Z'),
    branchTicket: null,
  });

  assert.equal(event.eventTypeId, 'claude_prompt_submitted');
  assert.equal(event.ticket, 'ABC-12');
  assert.equal(event.description, 'Login form');
  assert.equal(event.project.customerId, 7);
  assert.equal(event.startedAt, null);
});

test('a later prompt keeps the ticket of an earlier one', () => {
  handleHook('prompt-submitted', { session_id: 's2', cwd: project, prompt: 'Build ABC-12' }, { branchTicket: 'BR-1' });

  const [event] = handleHook('prompt-submitted', { session_id: 's2', cwd: project, prompt: 'and add tests' }, { branchTicket: 'BR-1' });

  assert.equal(event.ticket, 'ABC-12');
});

test('Claude finishing a response is not a user action and sends nothing', () => {
  assert.throws(() => handleHook('response-completed', { session_id: 's2', cwd: project }), /Unknown hook/);
});

test('an answered question spans the time the user took to answer', () => {
  handleHook('question-asked', { session_id: 's3', cwd: project, tool_use_id: 't1' }, {
    now: new Date('2026-10-15T10:00:00Z'),
    branchTicket: null,
  });

  const [event] = handleHook('question-answered', { session_id: 's3', cwd: project, tool_use_id: 't1' }, {
    now: new Date('2026-10-15T10:02:00Z'),
    branchTicket: null,
  });

  assert.equal(event.eventTypeId, 'claude_question_answered');
  assert.equal(event.startedAt.toISOString(), '2026-10-15T10:00:00.000Z');
});

test('the ticket comes from the git branch when the prompt names none', () => {
  execFileSync('git', ['init', '-q', '-b', 'TIM-77-export'], { cwd: project });

  const [event] = handleHook('prompt-submitted', { session_id: 's4', cwd: project, prompt: 'Add a csv export' });

  assert.equal(event.ticket, 'TIM-77');
});

test('the hook posts the event to Timatic and stays silent', async () => {
  const timatic = await fakeTimatic(() => ({ status: 201, json: { data: {} } }));
  saveCredentials({ baseUrl: timatic.baseUrl, token: 'secret', user: { id: 3, fullName: 'T', email: 't@x' } });

  // Spawned asynchronously: a synchronous spawn would block the fake server in this process.
  const result = await runAsync(['hook', 'prompt-submitted'], { session_id: 's5', cwd: project, prompt: 'Fix ABC-1', session_title: 'Bugfix' });

  await timatic.close();

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(timatic.requests.length, 1);

  const [request] = timatic.requests;
  assert.equal(request.url, '/events');
  assert.equal(request.headers.authorization, 'Bearer secret');
  assert.deepEqual(
    { ...request.body.data.attributes, endedAt: undefined },
    {
      sourceId: 'claude_code',
      eventTypeId: 'claude_prompt_submitted',
      userId: 3,
      customerId: 7,
      ticketNumber: 'ABC-1',
      title: `Claude Code: ${project.split('/').at(-1)}`,
      description: 'Bugfix',
      endedAt: undefined,
    },
  );
});

test('the session start has Claude ask whether to track a folder nobody decided on yet', () => {
  const undecided = mkdtempSync(join(tmpdir(), 'timatic-bare-'));

  const result = spawnSync('node', [script, 'hook', 'session-start'], {
    input: JSON.stringify({ session_id: 's6', cwd: undecided }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: '/plugin' },
  });

  assert.match(result.stdout, /Should Timatic track your time in this folder\?/);
  assert.match(result.stdout, /node "\/plugin\/scripts\/timatic.mjs" track off/);
  assert.match(result.stdout, /\/timatic:login/);
});

test('the session start stays silent in a folder the user declined', () => {
  saveProject(project, { tracked: false });

  assert.equal(sessionStartNotice({ cwd: project }), '');
});

test('a subfolder follows the choice made for its parent', () => {
  const subfolder = join(project, 'packages', 'api');
  mkdirSync(subfolder, { recursive: true });

  const [event] = handleHook('prompt-submitted', { session_id: 's7', cwd: subfolder, prompt: 'hi' }, { branchTicket: null });

  assert.equal(event.project.customerId, 7);
});

test('nothing is sent from a folder the user declined', () => {
  saveProject(project, { tracked: false });

  assert.deepEqual(handleHook('prompt-submitted', { session_id: 's8', cwd: project, prompt: 'hi' }, { branchTicket: null }), []);
});

test('events from before the decision are sent once the user says yes', () => {
  const undecided = mkdtempSync(join(tmpdir(), 'timatic-undecided-'));

  assert.deepEqual(handleHook('prompt-submitted', { session_id: 's9', cwd: undecided, prompt: 'hi' }, { branchTicket: null }), []);

  saveProject(undecided, { tracked: true, customerId: 8 });

  const events = handleHook('prompt-submitted', { session_id: 's9', cwd: undecided, prompt: 'go on' }, { branchTicket: null });

  assert.deepEqual(events.map((event) => event.eventTypeId), ['claude_prompt_submitted', 'claude_prompt_submitted']);
  assert.equal(events[0].project.customerId, 8);
});

test('a hook never fails, even on garbage input', () => {
  const result = spawnSync('node', [script, 'hook', 'prompt-submitted'], { input: 'not json', encoding: 'utf8', env: process.env });

  assert.equal(result.status, 0);
});

test('keeps events while Timatic refuses the token and sends them once the user logs in again', async () => {
  const refusing = await fakeTimatic(() => ({ status: 401, json: { message: 'Unauthenticated.' } }));
  saveCredentials({ baseUrl: refusing.baseUrl, token: 'old', user: { id: 3, fullName: 'T', email: 't@x' } });

  await runAsync(['hook', 'prompt-submitted'], { session_id: 's11', cwd: project, prompt: 'one', session_title: 'Work' });
  await runAsync(['hook', 'prompt-submitted'], { session_id: 's11', cwd: project, prompt: 'two', session_title: 'Work' });
  await refusing.close();

  assert.equal(queuedCount(), 2);
  assert.ok(loadCredentials().rejectedAt);
  assert.match(sessionStartNotice({ cwd: project }), /no longer accepts the login/);

  const accepting = await fakeTimatic(() => ({ status: 201, json: {} }));
  saveCredentials({ baseUrl: accepting.baseUrl, token: 'new', user: { id: 3, fullName: 'T', email: 't@x' } });
  const result = await sendEvents(loadCredentials(), []);
  await accepting.close();

  assert.equal(result.sent, 2);
  assert.equal(queuedCount(), 0);
  assert.equal(sessionStartNotice({ cwd: project }), '');
});
