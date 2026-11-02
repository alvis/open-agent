import { randomUUID } from 'node:crypto';

import { AGENT_BIN, AGENT_PATH } from '#adapters/guest/platform/layout';
import {
  converse,
  GuestLineProcess,
} from '#adapters/guest/platform/native/line-process';
import { isRecord } from '#kernel/guards';
import { checkOperation } from '#kernel/operation';

import {
  hasNoClaudePendingInteractions,
  isClaudeHookNotification,
} from './init-notifications';
import { CLAUDE_CONFIG_DIR } from './paths';

import type { GuestChannel } from '#application/ports/guest-channel';
import type { HarnessCommandEvidence } from '#domain/observations/harness';

/** what the Claude SDK reports after loading the managed settings */
export interface ClaudeInitialization extends HarnessCommandEvidence {
  /** number of models the SDK offers */
  modelCount: number;
  /** agents the SDK registered */
  agents: string[];
}

/** the Claude CLI, kept in the agent's npm prefix */
const CLAUDE = `${AGENT_BIN}/claude`;
/** longest initialization may take */
const INITIALIZATION_LIMIT_MS = 45_000;
/** most output Claude may print while initializing */
const OUTPUT_LIMIT_CHARS = 1_048_576;

/**
 * asks Claude to initialize through its control protocol, never sending a
 * conversation frame: one Claude process on the guest, whose replies the
 * host parses
 * @param guest target guest
 * @returns native initialization evidence, absent when Claude did not initialize
 */
export async function inspectClaudeInitialization(
  guest: GuestChannel,
): Promise<ClaudeInitialization | undefined> {
  const claude = new GuestLineProcess(
    guest,
    [
      CLAUDE,
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--setting-sources=user,project,local',
    ],
    {
      environment: { CLAUDE_CONFIG_DIR, PATH: AGENT_PATH },
      limits: {
        timeoutMs: INITIALIZATION_LIMIT_MS,
        outputChars: OUTPUT_LIMIT_CHARS,
      },
    },
  );
  try {
    return await converse(claude, async () => {
      const initialized = await request(claude, 'initialize');
      if (!Array.isArray(initialized.models)) {
        return undefined;
      }

      return {
        kind: 'commands',
        modelCount: initialized.models.length,
        commands: names(initialized.commands),
        agents: names(initialized.agents),
      };
    });
  } catch {
    checkOperation();

    return undefined;
  }
}

/**
 * sends one control request and takes its reply, skipping hook notifications;
 * any other frame, or a reply asking for a permission or dialog, fails it
 * @param claude the running Claude
 * @param subtype native initialization operation
 * @returns the correlated native payload
 * @throws {Error} when Claude answered anything else
 */
async function request(
  claude: GuestLineProcess,
  subtype: 'initialize',
): Promise<Record<string, unknown>> {
  const id = randomUUID();
  claude.send({
    type: 'control_request',
    request_id: id,
    request: { subtype },
  });
  for (;;) {
    const frame = await claude.next();
    if (!isClaudeHookNotification(frame)) {
      if (
        !isRecord(frame) ||
        frame.type !== 'control_response' ||
        !isRecord(frame.response) ||
        frame.response.subtype !== 'success' ||
        frame.response.request_id !== id ||
        !isRecord(frame.response.response) ||
        !hasNoClaudePendingInteractions(frame.response)
      ) {
        throw new Error(
          'Claude initialization returned an unexpected control response',
        );
      }

      return frame.response.response;
    }
  }
}

/**
 * validates discovery names without manufacturing successful empty evidence
 * @param value native discovery array
 * @returns exact native names
 * @throws {Error} when the discovery evidence is missing or malformed
 */
function names(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Claude initialization omitted discovery evidence');
  }

  return value.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name) {
      throw new Error(
        'Claude initialization returned malformed discovery evidence',
      );
    }

    return entry.name;
  });
}
