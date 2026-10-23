import { execFileSync } from 'node:child_process';
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

/**
 * Users know the app at {tenant}.timatic.app, but its api lives at api.{tenant}.timatic.app.
 */
export function normalizeBaseUrl(url) {
  const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);

  if (parsed.hostname.endsWith('.timatic.app') && !parsed.hostname.startsWith('api.')) {
    parsed.hostname = `api.${parsed.hostname}`;
  }

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
 * The mapping of a git repository is shared with the team in a file they commit; whether to track
 * stays personal, but a repository that has the file is tracked unless the user turned it off.
 */
const SHARED_FIELDS = ['customerId', 'customerName', 'budgetId', 'budgetTitle', 'ticketPattern'];

export function sharedConfigPath(directory) {
  return join(directory, '.claude', 'timatic.json');
}

function pick(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => keys.includes(key) && value !== undefined));
}

/**
 * Relative to the folder rather than --show-toplevel, which resolves symlinks and so would not
 * match the path the folder's choices are keyed by.
 */
function gitRoot(directory) {
  try {
    return resolve(directory, execFileSync('git', ['rev-parse', '--show-cdup'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim());
  } catch {
    return null;
  }
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
    const shared = readJson(sharedConfigPath(directory));

    if (shared) {
      const personal = projects[directory];

      return { directory, config: { ...personal, ...pick(shared, SHARED_FIELDS), tracked: personal?.tracked ?? true } };
    }

    if (projects[directory]) {
      return { directory, config: projects[directory] };
    }

    if (dirname(directory) === directory) {
      return { directory: start, config: null };
    }
  }
}

/**
 * In a git repository the mapping goes to the shared file in its root, and only the personal choice
 * to track it to the plugin's own data.
 *
 * @param {Partial<ProjectConfig>} change
 * @returns {?string} the shared file when it was written, so the user can be told to commit it.
 */
export function saveProject(directory, change, now = new Date()) {
  const root = gitRoot(directory);
  const sharedChange = pick(change, SHARED_FIELDS);
  let sharedPath = null;
  let personalChange = change;

  if (root) {
    directory = root;
    personalChange = Object.fromEntries(Object.entries(change).filter(([key]) => !SHARED_FIELDS.includes(key)));

    if (Object.keys(sharedChange).length > 0) {
      sharedPath = sharedConfigPath(root);
      writeJson(sharedPath, { ...readJson(sharedPath), ...sharedChange }, 0o644);
    }
  }

  const projects = loadProjects();
  projects[directory] = { ...projects[directory], ...personalChange, decidedAt: now.toISOString() };
  writeJson(projectsPath(), projects);

  return sharedPath;
}
