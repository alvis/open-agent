import { ResultDetails } from './ResultDetails';

import type { ReactElement } from 'react';

import type { JsonObject } from '#cli/serialization';

/**
 * creates the human-readable detail element
 * @param title result group heading
 * @param value already redacted result details
 * @returns the detail element
 */
export function resultDetailsElement(
  title: string,
  value: JsonObject,
): ReactElement {
  return <ResultDetails title={title} value={value} />;
}
