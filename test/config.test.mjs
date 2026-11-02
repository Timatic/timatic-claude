import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBaseUrl, normalizeGitRemote } from '../scripts/lib/config.mjs';

test('sends the app url of a tenant to its api', () => {
  assert.equal(normalizeBaseUrl('https://acme.timatic.app/'), 'https://api.acme.timatic.app');
  assert.equal(normalizeBaseUrl('acme.timatic.app'), 'https://api.acme.timatic.app');
  assert.equal(normalizeBaseUrl('https://api.acme.timatic.app'), 'https://api.acme.timatic.app');
});

test('names a repository the same whether it was cloned over ssh or https', () => {
  assert.equal(normalizeGitRemote('git@bitbucket.org:acme/shop.git'), 'bitbucket.org/acme/shop');
  assert.equal(normalizeGitRemote('ssh://git@bitbucket.org:22/acme/shop.git'), 'bitbucket.org/acme/shop');
  assert.equal(normalizeGitRemote('https://user@Bitbucket.org/acme/shop.git'), 'bitbucket.org/acme/shop');
  assert.equal(normalizeGitRemote('https://github.com/acme/shop/'), 'github.com/acme/shop');
  assert.equal(normalizeGitRemote('not a remote'), null);
});
