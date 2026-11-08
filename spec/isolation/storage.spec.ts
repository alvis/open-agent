import { readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

// a repository search for QR-1: storage behaviour derives from the declared
// storage capability through the domain storage rules, never from a provider
// name or a capability field read elsewhere

// --- TYPES --- //

/** where a source breaks storage isolation */
interface Breach {
  rule: string;
  line: number;
}

// --- CONSTANTS --- //

const SOURCE_ROOT = resolve(import.meta.dirname, '../../src');

/** modules that may interpret storage, relative to src: the provider drivers that declare it, the composition root that registers them, and the storage rules with the declarations they read */
const ALLOWED_MODULES = [
  'adapters/drivers/providers/',
  'composition/',
  'domain/storage.ts',
  'domain/declarations.ts',
] as const;

/** the storage capability fields whose meaning only the allowed modules interpret */
const FIELDS = 'growth|hostExtend|maxGb|defaultGb|path|persistence';

/** capability reads, each matched over the whole source so a read may span lines */
const CAPABILITY_READS = [
  {
    // `capabilities.storage.maxGb`, `capabilities.storage?.growth`, or `storage.growth` on an alias
    rule: 'storage field read',
    pattern: new RegExp(String.raw`\bstorage\??\.(?:${FIELDS})\b`, 'g'),
  },
  {
    // `const { growth, maxGb } = provider.capabilities.storage`
    rule: 'storage field destructured',
    pattern: new RegExp(
      String.raw`\{[^{}]*\b(?:${FIELDS})\b[^{}]*\}\s*=\s*[\w.?]*\bstorage\b`,
      'g',
    ),
  },
  {
    // `{ storage: { growth } }` as a binding; shorthand names only, so an
    // object literal that assigns values to these keys does not match
    rule: 'storage field destructured from capabilities',
    pattern: new RegExp(
      String.raw`\bstorage\s*:\s*\{\s*(?:\w+\s*,\s*)*(?:${FIELDS})\s*[,}]`,
      'g',
    ),
  },
] as const;

/** a provider name as a string literal */
const PROVIDER_NAME = String.raw`['"\x60](?:fly-machine|sprite)['"\x60]`;

/** comparisons with a literal provider name */
const PROVIDER_COMPARISONS = [
  // `provider === 'sprite'`
  new RegExp(String.raw`[!=]==?\s*${PROVIDER_NAME}`),
  // `'fly-machine' !== provider`
  new RegExp(String.raw`${PROVIDER_NAME}\s*[!=]==?`),
  // `case 'sprite':`
  new RegExp(String.raw`\bcase\s+${PROVIDER_NAME}\s*:`),
] as const;

/** words that place code in storage behaviour; `extends` is a keyword, not growth */
const STORAGE_TOPIC = /storage|volume|\bextend(?!s\b)/i;

// --- HELPERS --- //

/**
 * finds where a source breaks storage isolation; a provider comparison counts
 * when its paragraph, the run of non-blank lines holding a statement and its
 * body, also mentions storage
 * @param source module text
 * @returns every capability read and every provider-named storage paragraph, with its first line
 */
function findBreaches(source: string): Breach[] {
  const lineOf = (index: number): number =>
    source.slice(0, index).split('\n').length;

  const reads = CAPABILITY_READS.flatMap(({ rule, pattern }) =>
    [...source.matchAll(pattern)].map((match) => ({
      rule,
      line: lineOf(match.index),
    })),
  );

  const lines = source.split('\n');
  const paragraphs = lines.flatMap((text, index) =>
    text.trim() !== '' && (index === 0 || lines[index - 1]?.trim() === '')
      ? [{ line: index + 1, text: paragraphFrom(lines, index) }]
      : [],
  );
  const branches = paragraphs
    .filter(
      ({ text }) =>
        PROVIDER_COMPARISONS.some((pattern) => pattern.test(text)) &&
        STORAGE_TOPIC.test(text),
    )
    .map(({ line }) => ({ rule: 'provider-named storage branch', line }));

  return [...reads, ...branches];
}

/**
 * joins the non-blank lines starting at a paragraph's first line
 * @param lines module lines
 * @param start index of the paragraph's first line
 * @returns the paragraph's text
 */
function paragraphFrom(lines: readonly string[], start: number): string {
  const end = lines.findIndex(
    (text, index) => index > start && text.trim() === '',
  );

  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/**
 * tells whether a module may interpret storage
 * @param path module path relative to src, with forward slashes
 * @returns true when the module is in the allow-list
 */
function isAllowed(path: string): boolean {
  return ALLOWED_MODULES.some((allowed) => path.startsWith(allowed));
}

const sources = await Promise.all(
  (await readdir(SOURCE_ROOT, { recursive: true }))
    .filter((path) => /\.tsx?$/.test(path))
    .map(async (path) => ({
      path: path.split(sep).join('/'),
      text: await readFile(resolve(SOURCE_ROOT, path), 'utf8'),
    })),
);

// --- TEST SUITES --- //

describe('storage isolation', () => {
  it('should keep storage capability reads and provider-named storage branches inside the allowed modules', () => {
    const breaches = sources
      .filter(({ path }) => !isAllowed(path))
      .flatMap(({ path, text }) =>
        findBreaches(text).map((breach) => ({ path, ...breach })),
      );

    expect(breaches).toEqual([]);
  });

  it('should reach the storage rules, whose own reads the search would otherwise report', () => {
    const rules = sources.find(({ path }) => path === 'domain/storage.ts');

    expect(findBreaches(rules?.text ?? '')).toContainEqual(
      expect.objectContaining({ rule: 'storage field read' }),
    );
  });
});

describe('storage isolation search', () => {
  it.each([
    {
      sample: 'storage field read',
      source: 'const fixed = !provider.capabilities.storage.hostExtend;',
      expected: [{ rule: 'storage field read', line: 1 }],
    },
    {
      sample: 'storage path read',
      source: 'const measured = capabilities.storage.path;',
      expected: [{ rule: 'storage field read', line: 1 }],
    },
    {
      sample: 'optional storage field read on an alias',
      source: 'const { storage } = capabilities;\nreturn storage?.maxGb;',
      expected: [{ rule: 'storage field read', line: 2 }],
    },
    {
      sample: 'storage fields destructured across lines',
      source:
        'const {\n  defaultGb,\n  growth,\n} = declaration.capabilities.storage;',
      expected: [{ rule: 'storage field destructured', line: 1 }],
    },
    {
      sample: 'storage field destructured from capabilities',
      source: 'const { storage: { path, growth } } = capabilities;',
      expected: [
        { rule: 'storage field destructured from capabilities', line: 1 },
      ],
    },
    {
      sample: 'provider-named volume branch',
      source:
        "import { x } from 'y';\n\nif (provider === 'fly-machine') {\n  await extendVolume(name);\n}",
      expected: [{ rule: 'provider-named storage branch', line: 3 }],
    },
    {
      sample: 'provider name compared first beside storage',
      source: "const fixed = 'sprite' !== id && !hasStorageGrowth;",
      expected: [{ rule: 'provider-named storage branch', line: 1 }],
    },
    {
      sample: 'provider-named storage case',
      source:
        "switch (provider) {\n  case 'sprite':\n    return { storageGb: 100 };\n}",
      expected: [{ rule: 'provider-named storage branch', line: 1 }],
    },
  ])('should report a $sample', ({ source, expected }) => {
    expect(findBreaches(source)).toEqual(expected);
  });

  it.each([
    {
      sample: 'credential storage read',
      source: "const saved = { storage: storage.storage, path: 'x' };",
    },
    {
      sample: 'object literal that assigns storage keys',
      source: 'const storage = { maxGb: 100, growth: [] };',
    },
    {
      sample: 'provider comparison apart from storage',
      source:
        "if (provider === 'sprite') {\n  return url;\n}\n\nconst size = sizeOf(storage);",
    },
    {
      sample: 'provider comparison beside a class that extends another',
      source: "class Tool extends Base {\n  run = (id) => id !== 'sprite';\n}",
    },
  ])('should accept a $sample', ({ source }) => {
    expect(findBreaches(source)).toEqual([]);
  });
});
