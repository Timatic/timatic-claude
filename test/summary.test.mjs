import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { saveCredentials, saveProject } from '../scripts/lib/config.mjs';
import { rememberPrompt, summarize } from '../scripts/lib/summary.mjs';
import { fakeTimatic, useTemporaryHome } from '../test-support/helpers.mjs';

const script = fileURLToPath(new URL('../scripts/timatic.mjs', import.meta.url));

// Copied out with the executable bit set, so it can be run the way the real claude is.
const fakeClaude = join(mkdtempSync(join(tmpdir(), 'timatic-bin-')), 'claude');
writeFileSync(fakeClaude, readFileSync(new URL('../test-support/fake-claude.mjs', import.meta.url)), { mode: 0o755 });

let project;
let log;

function hook(name, input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, 'hook', name], {
      env: { ...process.env, TIMATIC_CLAUDE_BIN: fakeClaude, FAKE_CLAUDE_LOG: log, ...env },
    });
    child.on('close', resolve);
    child.stdin.end(JSON.stringify(input));
  });
}

function claudeCalls() {
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

beforeEach(() => {
  useTemporaryHome();
  project = mkdtempSync(join(tmpdir(), 'timatic-project-'));
  log = join(project, 'claude.log');
  process.env.FAKE_CLAUDE_LOG = log;
  writeFileSync(log, '');
  saveProject(project, { tracked: true, customerId: 7 });
});

test('remembers only the prompts of the last quarter of an hour', () => {
  let prompts = rememberPrompt([], 'first', new Date('2026-10-15T10:00:00Z'));
  prompts = rememberPrompt(prompts, 'second', new Date('2026-10-15T10:10:00Z'));
  prompts = rememberPrompt(prompts, 'third', new Date('2026-10-15T10:20:00Z'));

  assert.deepEqual(prompts.map((prompt) => prompt.text), ['second', 'third']);
});

test('asks a headless claude without tools for the summary and tidies its answer', async () => {
  const summary = await summarize([{ at: '', text: 'add a csv export' }], { command: fakeClaude });
  const [call] = claudeCalls();

  assert.equal(summary, 'CSV-export voor de urenlijst');
  assert.deepEqual(call.args.slice(0, 7), ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--strict-mcp-config']);
  assert.match(call.input, /add a csv export/);
  assert.equal(call.summarizing, '1');
});

test('gives no summary when claude cannot be run', async () => {
  assert.equal(await summarize([{ at: '', text: 'x' }], { command: '/nonexistent/claude' }), null);
});

test('describes an unnamed session with a summary of its recent prompts', async () => {
  const timatic = await fakeTimatic(() => ({ status: 201, json: {} }));
  saveCredentials({ baseUrl: timatic.baseUrl, token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  await hook('prompt-submitted', { session_id: 'u1', cwd: project, prompt: 'add a csv export' });
  await hook('prompt-submitted', { session_id: 'u1', cwd: project, prompt: 'with the budget column' });
  await timatic.close();

  const calls = claudeCalls();
  assert.equal(calls.length, 2);
  assert.match(calls[1].input, /add a csv export[\s\S]*with the budget column/);
  assert.deepEqual(timatic.requests.map((request) => request.body.data.attributes.description), [
    'CSV-export voor de urenlijst',
    'CSV-export voor de urenlijst',
  ]);
});

test('uses the name the user gave the session instead of a summary', async () => {
  const timatic = await fakeTimatic(() => ({ status: 201, json: {} }));
  saveCredentials({ baseUrl: timatic.baseUrl, token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  await hook('prompt-submitted', { session_id: 'u2', cwd: project, prompt: 'add a csv export', session_title: 'Export' });
  await timatic.close();

  assert.equal(claudeCalls().length, 0);
  assert.equal(timatic.requests[0].body.data.attributes.description, 'Export');
});

test('does not summarise for a folder that is not tracked', async () => {
  saveProject(project, { tracked: false });
  saveCredentials({ baseUrl: 'http://127.0.0.1:9', token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  await hook('prompt-submitted', { session_id: 'u3', cwd: project, prompt: 'add a csv export' });

  assert.equal(claudeCalls().length, 0);
});

test('stays quiet inside the claude that writes a summary', async () => {
  saveCredentials({ baseUrl: 'http://127.0.0.1:9', token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  await hook('prompt-submitted', { session_id: 'u4', cwd: project, prompt: 'Summarise these prompts' }, { TIMATIC_SUMMARIZING: '1' });

  assert.equal(claudeCalls().length, 0);
});
