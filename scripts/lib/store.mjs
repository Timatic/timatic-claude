import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Everything the plugin remembers lives in one directory of its own, so the hooks (which run with
 * CLAUDE_PLUGIN_DATA set) and the skills (which run through Bash, where it may not be) agree on it.
 */
export function dataDir() {
  if (process.env.TIMATIC_HOME) {
    return process.env.TIMATIC_HOME;
  }

  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

  return join(configHome, 'timatic-claude');
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Writes through a temporary file, so a hook that is killed halfway never leaves half a file for
 * the next one to choke on.
 */
export function writeJson(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

export function removeFile(path) {
  rmSync(path, { force: true });
}
