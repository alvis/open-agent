import { isJsonObject } from '#cli/serialization';

import type { JsonObject, JsonValue } from '#cli/serialization';

/**
 * prepares concise human result groups without altering structured results
 * @param data redacted command data
 * @returns readable detail groups
 */
export function humanResultDetails(data: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key !== 'agentUrl')
      .map(([key, value]) => [
        key,
        key === 'machine' ? machineDetails(value) : value,
      ]),
  );
}

/**
 * keeps the machine identity and provider state without its agent URL
 * @param value workstation control-plane summary
 * @returns machine identity and provider state
 */
function machineDetails(value: JsonValue | undefined): JsonObject {
  return Object.fromEntries(
    Object.entries(asRecord(value)).filter(([key]) => key !== 'agentUrl'),
  );
}

/**
 * identifies a result group while allowing absent inspection sections
 * @param value result section to display
 * @returns present record or an empty group
 */
function asRecord(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}
