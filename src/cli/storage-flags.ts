import { parseWholeNumber } from './whole-number';

/** the storage a new workstation starts with and how it grows; setup accepts only --storage */
export const storageFlags = {
  storage: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'GB',
    brief:
      'GB · least storage a new workstation starts with, in whole gigabytes, at least 1 (default 10); on setup, grows the storage to this size',
  },
  autoExtend: {
    kind: 'boolean',
    optional: true,
    withNegated: true,
    brief:
      'enable or disable automatic storage growth (on where the provider supports it)',
  },
  autoExtendAt: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'PERCENT',
    brief:
      'PERCENT · storage use that triggers automatic growth, 50 to 95 (default 80)',
  },
  autoExtendStep: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'GB',
    brief: 'GB · storage each automatic growth adds, at least 1 (default 10)',
  },
  storageLimit: {
    kind: 'parsed',
    parse: parseWholeNumber,
    optional: true,
    placeholder: 'GB',
    brief:
      'GB · size automatic growth never exceeds, from the starting size to the provider maximum (default 100)',
  },
} as const;
