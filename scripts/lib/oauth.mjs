import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { spawn } from 'node:child_process';
import { request } from './api.mjs';
import { CLIENT_ID } from './config.mjs';

const LOGIN_TIMEOUT_MS = 4 * 60 * 1000;

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkcePair() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());

  return { verifier, challenge };
}

export function authorizeUrl(baseUrl, { redirectUri, state, challenge }) {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `${baseUrl}/oauth/authorize?${query}`;
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];

  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The url is printed as well, for machines without a browser.
  }
}

const PAGE = (title, message) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.4rem">${title}</h1><p>${message}</p></body>`;

/**
 * Waits on a loopback port for the browser to come back with a code, as RFC 8252 describes for
 * native apps. The port is whatever is free; Timatic accepts any port for this client.
 */
function waitForCode(state, onListening) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname !== '/callback') {
        res.writeHead(404).end();

        return;
      }

      const finish = (status, title, message, outcome) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(title, message));
        clearTimeout(timer);
        server.close();
        outcome();
      };

      if (url.searchParams.get('state') !== state) {
        finish(400, 'Inloggen mislukt', 'De aanvraag hoort niet bij deze login. Probeer het opnieuw.',
          () => reject(new Error('The state returned by Timatic does not match; login aborted.')));

        return;
      }

      if (url.searchParams.get('error')) {
        finish(200, 'Inloggen geannuleerd', 'Je kunt dit venster sluiten.',
          () => reject(new Error(`Timatic refused the login: ${url.searchParams.get('error')}`)));

        return;
      }

      finish(200, 'Ingelogd bij Timatic', 'Je kunt dit venster sluiten en terug naar Claude Code gaan.',
        () => resolve(url.searchParams.get('code')));
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('No answer from the browser within 4 minutes; login aborted.'));
    }, LOGIN_TIMEOUT_MS);

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => onListening(server.address().port));
  });
}

/**
 * The authorization code flow with PKCE: the browser logs in through Timatic's own identity
 * provider and hands a single use code to the loopback listener, which trades it for a token.
 */
export async function login(baseUrl, { log = console.error, open = openBrowser } = {}) {
  const { verifier, challenge } = createPkcePair();
  const state = base64Url(randomBytes(24));
  let redirectUri;

  const code = await waitForCode(state, (port) => {
    redirectUri = `http://127.0.0.1:${port}/callback`;
    const url = authorizeUrl(baseUrl, { redirectUri, state, challenge });

    log(`Opening your browser to log in to Timatic. If it does not open, visit:\n\n  ${url}\n`);
    open(url);
  });

  const issued = await request(baseUrl, '/oauth/token', {
    method: 'POST',
    body: {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      device_name: `Claude Code on ${hostname()}`,
    },
  });

  return {
    baseUrl,
    token: issued.token,
    expiresAt: issued.expiresAt ?? null,
    user: issued.user,
  };
}

export async function logout(credentials) {
  await request(credentials.baseUrl, '/oauth/token', { method: 'DELETE', token: credentials.token });
}
