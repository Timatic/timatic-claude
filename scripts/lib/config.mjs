import { dirname, join, resolve } from 'node:path';
import { dataDir, readJson, removeFile, writeJson } from './store.mjs';

export const CLIENT_ID = 'claude-code';

export function credentialsPath() {
  return join(dataDir(), 'credentials.json');
}

/**
 * The token's expiry is not kept: Timatic pushes it forward every time it is used, so only
 * Timatic knows. `rejectedAt` records when it last refused the token.
 *
 * @returns {{baseUrl: string, token: string, rejectedAt?: string, user: {id: number, fullName: string, email: string}} | null}
 */
export function loadCredentials() {
  const credentials = readJson(credentialsPath());

  if (!credentials?.token || !credentials?.baseUrl || !credentials?.user?.id) {
    return null;
  }

  return credentials;
}

export function saveCredentials(credentials) {
  writeJson(credentialsPath(), credentials);
}

export function forgetCredentials() {
  removeFile(credentialsPath());
}

/**
 * An explicit url wins, then TIMATIC_URL, then the one the current token was issued by.
 */
export function resolveBaseUrl(explicitUrl) {
  const url = explicitUrl
    || process.env.TIMATIC_URL
    || loadCredentials()?.baseUrl;

  return url ? normalizeBaseUrl(url) : null;
}

export function normalizeBaseUrl(url) {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    && !parsed.hostname.endsWith('.test')) {
    throw new Error(`Refusing to send a token over plain http to ${parsed.host}; use https.`);
  }

  return parsed.toString().replace(/\/+$/, '');
}

/**
 * Whether a folder is tracked, and on which customer, is remembered per folder in the plugin's own
 * data rather than in the repository: it is a personal choice, and a folder may not be a
 * repository at all. A choice applies to every folder below it, so the closest one wins.
 *
 * @typedef {{tracked: boolean, customerId?: ?number, customerName?: string, budgetId?: ?number, budgetTitle?: ?string, isInternal?: boolean, ticketPattern?: string, decidedAt?: string}} ProjectConfig
 */
function projectsPath() {
  return join(dataDir(), 'projects.json');
}

/**
 * @returns {Record<string, ProjectConfig>}
 */
export function loadProjects() {
  return readJson(projectsPath(), {}) ?? {};
}

/**
 * The folder Claude Code was started in, not wherever a command happened to cd to.
 */
export function workingDir(cwd) {
  return resolve(process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd());
}

/**
 * @returns {{directory: string, config: ?ProjectConfig}} the folder whose choice applies, or the
 *   working folder itself with no config when nothing was decided yet.
 */
export function findProject(cwd) {
  const projects = loadProjects();
  const start = workingDir(cwd);

  for (let directory = start; ; directory = dirname(directory)) {
    if (projects[directory]) {
      return { directory, config: projects[directory] };
    }

    if (dirname(directory) === directory) {
      return { directory: start, config: null };
    }
  }
}

/**
 * @param {Partial<ProjectConfig>} change
 */
export function saveProject(directory, change, now = new Date()) {
  const projects = loadProjects();
  projects[directory] = { ...projects[directory], ...change, decidedAt: now.toISOString() };
  writeJson(projectsPath(), projects);

  return projects[directory];
}
