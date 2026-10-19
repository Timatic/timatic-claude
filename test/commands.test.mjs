import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findProject, saveCredentials, saveProject } from '../scripts/lib/config.mjs';
import { fakeTimatic, useTemporaryHome } from '../test-support/helpers.mjs';

const script = fileURLToPath(new URL('../scripts/timatic.mjs', import.meta.url));

let folder;

function run(...args) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { env: { ...process.env, CLAUDE_PROJECT_DIR: folder } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const budget = (id, title, customerId) => ({ type: 'budgets', id: String(id), attributes: { title, customerId } });

async function timaticWithBudgets() {
  const timatic = await fakeTimatic((request) => {
    if (request.url.startsWith('/budgets?')) {
      return { json: { data: [budget(2, 'Support 2026', 7), budget(1, 'Development', 7)], links: {} } };
    }

    if (request.url === '/budgets/1') {
      return { json: { data: budget(1, 'Development', 7) } };
    }

    if (request.url === '/budgets/9') {
      return { json: { data: budget(9, 'Someone else', 8) } };
    }

    if (request.url === '/customers/8') {
      return { json: { data: { type: 'customers', id: '8', attributes: { name: 'Globex' } } } };
    }

    return { status: 404, json: {} };
  });

  saveCredentials({ baseUrl: timatic.baseUrl, token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  return timatic;
}

beforeEach(() => {
  useTemporaryHome();
  folder = mkdtempSync(join(tmpdir(), 'timatic-folder-'));
  saveProject(folder, { tracked: true, customerId: 7, customerName: 'Acme' });
});

test('lists the open budgets of the folder\'s customer', async () => {
  const timatic = await timaticWithBudgets();
  const result = await run('budgets');
  await timatic.close();

  assert.equal(result.stdout, '1\tDevelopment\n2\tSupport 2026\n');
  assert.match(timatic.requests[0].url, /filter\[customerId\]=7&filter\[isArchived\]=false/);
});

test('books the folder on a budget of its customer', async () => {
  const timatic = await timaticWithBudgets();
  const result = await run('set-budget', '1');
  await timatic.close();

  assert.equal(result.status, 0);
  assert.equal(findProject(folder).config.budgetId, 1);
  assert.equal(findProject(folder).config.budgetTitle, 'Development');
});

test('refuses a budget of another customer', async () => {
  const timatic = await timaticWithBudgets();
  const result = await run('set-budget', '9');
  await timatic.close();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not belong to Acme/);
  assert.equal(findProject(folder).config.budgetId, undefined);
});

test('clears the budget', async () => {
  saveProject(folder, { budgetId: 1, budgetTitle: 'Development' });
  const timatic = await timaticWithBudgets();
  await run('set-budget', 'none');
  await timatic.close();

  assert.equal(findProject(folder).config.budgetId, null);
});

test('drops the budget when the customer changes', async () => {
  saveProject(folder, { budgetId: 1, budgetTitle: 'Development' });
  const timatic = await timaticWithBudgets();
  await run('set-customer', '8');
  await timatic.close();

  assert.equal(findProject(folder).config.customerId, 8);
  assert.equal(findProject(folder).config.budgetId, null);
});

test('declining a folder is remembered', async () => {
  await run('track', 'off');

  assert.equal(findProject(folder).config.tracked, false);
});

test('suggests the customer and budget the branch ticket is mapped to', async () => {
  execFileSync('git', ['init', '-q', '-b', 'feature/acme-12-login'], { cwd: folder });

  const timatic = await fakeTimatic((request) => {
    if (request.url === '/tickets/ACME-12') {
      return { json: { data: { type: 'tickets', id: 'ACME-12', attributes: { key: 'ACME-12', title: 'Login', customerId: 8, budgetId: 9 } } } };
    }

    if (request.url === '/customers/8') {
      return { json: { data: { type: 'customers', id: '8', attributes: { name: 'Globex' } } } };
    }

    if (request.url === '/budgets/9') {
      return { json: { data: budget(9, 'Support', 8) } };
    }

    return { status: 404, json: {} };
  });
  saveCredentials({ baseUrl: timatic.baseUrl, token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  const result = await run('suggest');
  await timatic.close();

  assert.equal(result.stdout, 'Ticket ACME-12 (Login) is mapped to customer Globex (#8) and budget Support (#9).\n');
});

test('says so when the ticket is unknown', async () => {
  const timatic = await fakeTimatic(() => ({ status: 404, json: {} }));
  saveCredentials({ baseUrl: timatic.baseUrl, token: 't', user: { id: 1, fullName: 'T', email: 't@x' } });

  const result = await run('suggest', 'nope-1');
  await timatic.close();

  assert.equal(result.stdout, 'Timatic does not know ticket NOPE-1.\n');
});
