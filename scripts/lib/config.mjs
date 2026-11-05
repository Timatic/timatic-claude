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
 * Whether a folder is tracked, and on which customer, is remembered in the plugin's own data: per
 * git remote for a repository, per folder otherwise. A choice applies to every folder below it, so
 * the closest one wins.
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
 * The url of the repository's origin, as git has it, or null without one.
 */
export function gitRemoteUrl(directory) {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The same repository as host/path, whether it was cloned over ssh or https, so a personal choice
 * follows it to every clone and every device.
 */
export function normalizeGitRemote(url) {
  // The scp-like form git@host:owner/repo has no scheme, so URL cannot read it.
  const scpLike = /^[\w.-]+@([^:/]+):(?!\/\/)(.+)$/.exec(url);
  let host;
  let path;

  try {
    ({ hostname: host, pathname: path } = scpLike ? { hostname: scpLike[1], pathname: scpLike[2] } : new URL(url));
  } catch {
    return null;
  }

  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');

  return host && path.includes('/') ? `${host.toLowerCase()}/${path}` : null;
}

/**
 * Remotes under one of these prefixes hold work that must be tracked, so the user is asked for a
 * customer when Timatic has no mapping. Set by the organisation in Claude Code's (managed) settings
 * `env`, comma separated, in the host/path form of normalizeGitRemote.
 */
export function isDesiredTrackedRemote(remoteUrl) {
  const remote = normalizeGitRemote(remoteUrl ?? '')?.toLowerCase();

  return Boolean(remote) && (process.env.TIMATIC_TRACKED_GIT_REMOTE_PREFIXES ?? '')
    .split(',')
    .map((prefix) => prefix.trim().toLowerCase().replace(/\/+$/, ''))
    .some((prefix) => prefix !== '' && (remote === prefix || remote.startsWith(`${prefix}/`)));
}

/**
 * Personal choices for a repository are keyed by its remote; folders without one by their path.
 */
function personalKey(root) {
  const remote = normalizeGitRemote(gitRemoteUrl(root) ?? '');

  return remote ? `git:${remote}` : root;
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
  const root = gitRoot(start);
  const rootKey = root && personalKey(root);

  for (let directory = start; ; directory = dirname(directory)) {
    const shared = readJson(sharedConfigPath(directory));
    // Entries saved before they were keyed by remote still count.
    const personal = (directory === root && projects[rootKey]) || projects[directory];

    if (shared) {

      return { directory, config: { ...pick(shared, SHARED_FIELDS), ...personal, tracked: personal?.tracked ?? true } };
    }

    if (personal) {
      return { directory, config: personal };
    }

    if (dirname(directory) === directory) {
      return { directory: start, config: null };
    }
  }
}

/**
 * The mapping is personal by default and keyed by the repository's remote. Saved for the repository,
 * it goes to the shared file in its root, and only the personal choice to track it to the plugin's
 * own data. A personal mapping beats the shared one. Without a scope, the mapping stays where it is.
 *
 * @param {Partial<ProjectConfig>} change
 * @param {?('repo'|'user')} scope
 * @returns {?string} the shared file when it was written, so the user can be told to commit it.
 */
export function saveProject(directory, change, scope = null, now = new Date()) {
  const root = gitRoot(directory);
  const projects = loadProjects();
  let key = directory;
  let sharedPath = null;
  let personalChange = change;

  if (root) {
    key = personalKey(root);
    // Moves an entry saved before it was keyed by remote.
    projects[key] = { ...projects[root], ...projects[key] };

    if (key !== root) {
      delete projects[root];
    }

    const sharesMapping = readJson(sharedConfigPath(root)) !== null && !Number.isInteger(projects[key].customerId);
    scope ??= sharesMapping ? 'repo' : 'user';
  }

  if (root && scope === 'repo') {
    const sharedChange = pick(change, SHARED_FIELDS);
    personalChange = Object.fromEntries(Object.entries(change).filter(([field]) => !SHARED_FIELDS.includes(field)));

    if (Object.keys(sharedChange).length > 0) {
      sharedPath = sharedConfigPath(root);
      writeJson(sharedPath, { ...readJson(sharedPath), ...sharedChange }, 0o644);
      // The personal mapping would otherwise keep beating the shared one.
      projects[key] = Object.fromEntries(Object.entries(projects[key]).filter(([field]) => !SHARED_FIELDS.includes(field)));
    }
  }

  projects[key] = { ...projects[key], ...personalChange, decidedAt: now.toISOString() };
  writeJson(projectsPath(), projects);

  return sharedPath;
}
