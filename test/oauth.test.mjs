import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { login } from '../scripts/lib/oauth.mjs';
import { fakeTimatic, useTemporaryHome } from './helpers.mjs';

test('logs in through the browser with pkce on a loopback port', async () => {
  useTemporaryHome();

  let challenge;
  const timatic = await fakeTimatic((request) => ({
    status: 201,
    json: { token: 'plain-token', expiresAt: '2027-01-13T10:00:00+00:00', user: { id: 5, fullName: 'Tomas', email: 'tomas@example.com' } },
  }));

  const credentials = await login(timatic.baseUrl, {
    log: () => {},
    // Plays the browser: Timatic approves and sends it to the redirect uri with a code.
    open: async (url) => {
      const authorize = new URL(url);
      challenge = authorize.searchParams.get('code_challenge');

      assert.equal(authorize.pathname, '/oauth/authorize');
      assert.equal(authorize.searchParams.get('client_id'), 'claude-code');
      assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
      assert.match(authorize.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

      const callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.searchParams.set('code', 'the-code');
      callback.searchParams.set('state', authorize.searchParams.get('state'));
      await fetch(callback);
    },
  });

  await timatic.close();

  const [token] = timatic.requests;
  assert.equal(token.url, '/oauth/token');
  assert.equal(token.body.code, 'the-code');
  assert.equal(token.body.client_id, 'claude-code');
  assert.equal(createHash('sha256').update(token.body.code_verifier).digest('base64url'), challenge);
  assert.deepEqual(credentials.user, { id: 5, fullName: 'Tomas', email: 'tomas@example.com' });
  assert.equal(credentials.token, 'plain-token');
});

test('refuses a callback with another state', async () => {
  useTemporaryHome();

  await assert.rejects(login('http://127.0.0.1:9', {
    log: () => {},
    open: async (url) => {
      const callback = new URL(new URL(url).searchParams.get('redirect_uri'));
      callback.searchParams.set('code', 'the-code');
      callback.searchParams.set('state', 'forged');
      await fetch(callback);
    },
  }), /state/);
});
