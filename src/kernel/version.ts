import { readFileSync } from 'node:fs';

/** the running open-agent release, read from its package manifest */
export const OPEN_AGENT_VERSION = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;
