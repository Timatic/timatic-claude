import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function useTemporaryHome() {
  const home = mkdtempSync(join(tmpdir(), 'timatic-test-'));
  process.env.TIMATIC_HOME = home;
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PLUGIN_OPTION_TIMATIC_URL;
  delete process.env.TIMATIC_URL;

  return home;
}

/**
 * A stand in for the Timatic backend that records every request and answers with whatever the
 * test's handler returns.
 */
export async function fakeTimatic(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';

    for await (const chunk of req) {
      body += chunk;
    }

    const recorded = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(recorded);

    const { status = 200, json, headers = {} } = (await handler(recorded)) ?? {};
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(json === undefined ? '' : JSON.stringify(json));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
