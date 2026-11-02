import { stderr, stdout } from 'node:process';

import { renderToString } from 'ink';

import { resultDetailsElement } from '#cli/components/OutputPresentation';

import { humanResultDetails } from './output/details';
import { projectResult } from './output/project';
import { isJsonObject, serializeResult } from './serialization';

import type { Writable } from 'node:stream';

import type { CommandResult } from '#application/result';

import type { JsonObject, SerializedResult } from './serialization';

interface ResultStream extends Writable {
  isTTY?: boolean;
  columns?: number;
}

interface ResultStreams {
  stdout: ResultStream;
  stderr: ResultStream;
}

/** completed result used to prepare one payload */
export interface PrepareResultParams {
  result: CommandResult;
  streams?: ResultStreams;
}

/** fully rendered output with one selected destination */
export interface PreparedResult {
  channel: 'stdout' | 'stderr';
  text: string;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_STREAMS: ResultStreams = { stdout, stderr };

/**
 * prepares the entire redacted result before any output is written
 * @param params completed result and optional real streams
 * @param params.result completed application result
 * @param params.streams real output streams used only for terminal width
 * @returns one complete payload and its destination
 */
export function prepareResult({
  result,
  streams = DEFAULT_STREAMS,
}: PrepareResultParams): PreparedResult {
  const safe = serializeResult(projectResult(result));
  const channel = safe.ok ? 'stdout' : 'stderr';
  const stream = streams[channel];
  const columns = stream.isTTY
    ? (stream.columns ?? DEFAULT_COLUMNS)
    : DEFAULT_COLUMNS;

  return { channel, text: humanResult(safe, columns) };
}

/**
 * writes an already complete payload to its selected real stream once
 * @param prepared fully rendered result
 * @param streams real output streams, defaulting to the current process
 */
export function writePreparedResult(
  prepared: PreparedResult,
  streams: ResultStreams = DEFAULT_STREAMS,
): void {
  streams[prepared.channel].write(prepared.text);
}

/**
 * renders a completed result for a human reader
 * @param result redacted application result
 * @param columns available terminal width
 * @returns fully rendered human text
 */
function humanResult(result: SerializedResult, columns: number): string {
  const error = result.ok ? '' : humanError(result);
  if (result.command === null || result.data === undefined) {
    return error;
  }
  const details = renderToString(
    resultDetailsElement(result.command, humanResultDetails(result.data)),
    { columns },
  );

  return `${error}${details}\n${humanConnection(result.data)}`;
}

/**
 * prints the single agent URL without wrapping so copying preserves it
 * @param data already redacted command data
 * @returns unwrapped connection lines
 */
function humanConnection(data: JsonObject): string {
  const lines: string[] = [];
  const machine = isJsonObject(data.machine) ? data.machine : undefined;
  const agentUrl = machine?.agentUrl ?? data.agentUrl;
  if (typeof agentUrl === 'string') {
    lines.push(`    Agent URL: ${agentUrl}\n`);
  }

  return lines.join('');
}

/**
 * shows failure details and the exact recoverable machine identity
 * @param result failed application result
 * @returns complete failure heading and recovery lines
 */
function humanError(result: Extract<SerializedResult, { ok: false }>): string {
  const lines = [`${result.error.message}\n`];
  if (result.error.machine) {
    lines.push(`Workstation: ${result.error.machine}\n`);
  }
  if (result.error.machineId) {
    lines.push(`Workstation ID: ${result.error.machineId}\n`);
  }
  if (result.error.setupIncomplete) {
    lines.push('Setup is incomplete.\n');
  }
  const recovery = isJsonObject(result.data?.recovery)
    ? result.data.recovery
    : undefined;
  if (
    recovery?.incompleteLabel === 'confirmed' ||
    recovery?.incompleteLabel === 'unconfirmed'
  ) {
    lines.push(`Incomplete label: ${recovery.incompleteLabel}\n`);
  }
  for (const detail of result.error.details ?? []) {
    lines.push(`  ${detail}\n`);
  }

  return lines.join('');
}
