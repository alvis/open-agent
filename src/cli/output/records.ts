import { isJsonObject } from '#cli/serialization';

import type { JsonObject, JsonValue } from '#cli/serialization';

/** every C0 and C1 control character */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/**
 * identifies a result group while allowing absent inspection sections
 * @param value result section to display
 * @returns present record or an empty group
 */
export function asRecord(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

/**
 * removes every C0 and C1 control character from guest-supplied text
 * @param text text read from the guest
 * @returns the text without control characters
 */
export function printable(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '');
}
