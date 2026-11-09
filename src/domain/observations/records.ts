// the guest programs record their state as JSON the host reads back as data,
// so each recorded field is checked against the bounds the programs write

/** longest ISO 8601 instant a record holds */
const INSTANT_LENGTH = 32;

/** longest diagnostic a record keeps */
const DIAGNOSTIC_LENGTH = 240;

/** a C0 or C1 control character, which could rewrite a terminal's display */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * validates an ISO 8601 instant
 * @param value untrusted field
 * @returns whether the value is an instant `Date` writes back unchanged
 */
export function isRecordedInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > INSTANT_LENGTH) {
    return false;
  }
  const time = Date.parse(value);

  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/**
 * validates a whole-number field
 * @param value untrusted field
 * @returns whether the value is a non-negative safe integer
 */
export function isRecordedCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * validates a bounded text field that a terminal shows as it is
 * @param value untrusted field
 * @returns whether the value is a string within the diagnostic length that
 * holds no C0 or C1 control character
 */
export function isRecordedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= DIAGNOSTIC_LENGTH &&
    !CONTROL_CHARACTER.test(value)
  );
}
