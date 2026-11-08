import {
  MILLISECONDS_PER_HOUR,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
} from '#application/upgrade/span';

/** whole hours, minutes and seconds, largest first, each optional: `1h30m`, `90s` */
const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u;

/** upgrade-only restart controls */
export const upgradeFlags = {
  restart: {
    kind: 'boolean',
    default: false,
    brief: 'restart each service still running an older tool',
  },
  force: {
    kind: 'boolean',
    default: false,
    brief:
      'with --restart, restart the agent without waiting for it to be idle',
  },
  waitTimeout: {
    kind: 'parsed',
    parse: parseDuration,
    optional: true,
    placeholder: 'DURATION',
    brief:
      'DURATION · with --restart, longest wait for an idle agent, such as 30m or 1h (default 30m)',
  },
} as const;

/**
 * parses a positive span written as whole hours, minutes and seconds
 * @param value flag text, such as `30m`, `90s` or `1h30m`
 * @returns the span in milliseconds
 * @throws {Error} when the text is not such a span, or the span is zero
 */
export function parseDuration(value: string): number {
  const match = DURATION.exec(value.trim());
  const [, hours, minutes, seconds] = match ?? [];
  const milliseconds =
    Number(hours ?? 0) * MILLISECONDS_PER_HOUR +
    Number(minutes ?? 0) * MILLISECONDS_PER_MINUTE +
    Number(seconds ?? 0) * MILLISECONDS_PER_SECOND;
  if (!match || milliseconds <= 0 || !Number.isSafeInteger(milliseconds)) {
    throw new Error(
      `expected a positive duration such as 30m, 90s or 1h30m, got ${JSON.stringify(value)}`,
    );
  }

  return milliseconds;
}
