/** milliseconds in a second, a minute and an hour */
export const MILLISECONDS_PER_SECOND = 1_000;
export const MILLISECONDS_PER_MINUTE = 60_000;
export const MILLISECONDS_PER_HOUR = 3_600_000;

/** the suffixes a span is written with */
export interface SpanUnits {
  /** after whole minutes */
  minutes: string;
  /** after whole seconds */
  seconds: string;
}

/** units for progress text, such as `30 min` */
export const SPOKEN_UNITS: SpanUnits = { minutes: ' min', seconds: ' s' };

/** units `--wait-timeout` reads back, such as `30m` */
export const FLAG_UNITS: SpanUnits = { minutes: 'm', seconds: 's' };

/**
 * words a span of time in its largest whole unit
 * @param milliseconds length of the span
 * @param units the suffixes to write it with
 * @returns whole minutes when the span is one, else whole seconds rounded up
 */
export function formatSpan(milliseconds: number, units: SpanUnits): string {
  return milliseconds % MILLISECONDS_PER_MINUTE === 0
    ? `${milliseconds / MILLISECONDS_PER_MINUTE}${units.minutes}`
    : `${Math.ceil(milliseconds / MILLISECONDS_PER_SECOND)}${units.seconds}`;
}
