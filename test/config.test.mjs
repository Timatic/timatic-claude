import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBaseUrl } from '../scripts/lib/config.mjs';

test('sends the app url of a tenant to its api', () => {
  assert.equal(normalizeBaseUrl('https://acme.timatic.app/'), 'https://api.acme.timatic.app');
  assert.equal(normalizeBaseUrl('acme.timatic.app'), 'https://api.acme.timatic.app');
  assert.equal(normalizeBaseUrl('https://api.acme.timatic.app'), 'https://api.acme.timatic.app');
});
