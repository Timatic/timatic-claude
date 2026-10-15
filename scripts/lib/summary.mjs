import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Timatic groups events that lie within a quarter of an hour of each other, so that is the stretch
 * of work a description has to cover.
 */
export const WINDOW_MS = 15 * 60 * 1000;

const MAX_PROMPTS = 10;
const MAX_PROMPT_LENGTH = 1000;
const TIMEOUT_MS = 60 * 1000;

/**
 * Set on the Claude Code that writes a summary, so the plugin's own hooks in there stay quiet
 * instead of summarising the summary request.
 */
export const SUMMARIZING_ENV = 'TIMATIC_SUMMARIZING';

const SYSTEM_PROMPT = 'You write the description of a time sheet entry. Answer with the description only: '
  + 'at most ten words, in the language of the prompts, no quotes, no trailing period.';

/**
 * Remembers a prompt and forgets those that fell out of the window. The text stays on this
 * machine; only the summary of it is sent to Timatic.
 *
 * @param {Array<{at: string, text: string}>} prompts
 */
export function rememberPrompt(prompts, text, now) {
  const recent = recentPrompts(prompts, now);

  if (typeof text === 'string' && text.trim() !== '') {
    recent.push({ at: now.toISOString(), text: text.trim().slice(0, MAX_PROMPT_LENGTH) });
  }

  return recent.slice(-MAX_PROMPTS);
}

export function recentPrompts(prompts, now) {
  return (prompts ?? []).filter((prompt) => now - Date.parse(prompt.at) <= WINDOW_MS);
}

export function summaryKey(prompts) {
  return createHash('sha256').update(JSON.stringify(prompts.map((prompt) => prompt.text))).digest('hex');
}

export function summaryRequest(prompts) {
  return `Summarise what these prompts to a coding assistant are about:\n\n${prompts
    .map((prompt, index) => `${index + 1}. ${prompt.text}`)
    .join('\n\n')}`;
}

/**
 * Asks Claude Code itself, headless, on the small model and without tools, so it runs on the
 * user's own login. Resolves to null whenever that does not work out; a description is a nicety.
 */
export function summarize(prompts, { command = process.env.TIMATIC_CLAUDE_BIN || 'claude' } = {}) {
  if (prompts.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let output = '';
    let child;

    try {
      child = spawn(command, [
        '-p',
        '--model', 'haiku',
        '--tools', '',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--system-prompt', SYSTEM_PROMPT,
      ], {
        env: { ...process.env, [SUMMARIZING_ENV]: '1' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      resolve(null);

      return;
    }

    // Not spawn's own timeout option: its timer outlives a child that failed to start.
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('close', (status) => {
      clearTimeout(timer);

      const summary = output.trim().split('\n')[0]?.replace(/^["'\s]+|["'.\s]+$/g, '');

      resolve(status === 0 && summary ? summary.slice(0, 255) : null);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(summaryRequest(prompts));
  });
}
