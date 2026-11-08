import { describe, expect, it } from 'vitest';

import {
  parseStorageProbe,
  storageWarnings,
} from '#domain/observations/storage';

import type {
  RecordedStoragePolicy,
  StorageReport,
} from '#domain/observations/storage';

// --- CONSTANTS --- //

const HEADER =
  'Filesystem     1024-blocks     Used Available Capacity Mounted on';

/** a 20 GB filesystem with 13.1 GB used */
const MEASURE = `${HEADER}\n/dev/vdb 20971520 13736345 7235175 66% /data\n`;

const ON: RecordedStoragePolicy = {
  state: 'on',
  thresholdPercent: 80,
  stepGb: 10,
  limitGb: 100,
  mechanisms: ['provider-auto'],
};

const INSTANT = '2026-11-08T10:00:00.000Z';

const STATE = { version: 1, lastSizeGb: 19, sizeChangedAt: INSTANT };

const FAILED = {
  at: INSTANT,
  targetGb: 30,
  outcome: 'failed',
  detail: 'the provider refused the size',
} as const;

const REPORT: StorageReport = {
  sizeGb: 20,
  usedGb: 13.1,
  usedPercent: 66,
  policy: ON,
};

// --- TEST SUITES --- //

describe('fn:parseStorageProbe', () => {
  it('should report the size and usage in GB to one decimal place with the recorded policy', () => {
    expect(parseStorageProbe({ measure: MEASURE, policy: ON })).toEqual(REPORT);
  });

  it('should round the used share up, as df and the watcher do', () => {
    const measure = `${HEADER}\n/dev/vdb 10485760 1 10485759 1% /data`;

    expect(parseStorageProbe({ measure, policy: { state: 'off' } })).toEqual({
      sizeGb: 10,
      usedGb: 0,
      usedPercent: 1,
      policy: { state: 'off' },
    });
  });

  it('should read a filesystem whose name holds spaces and a capacity df could not compute', () => {
    const measure = `${HEADER}\nmy disk 1048576 0 0 - /`;

    expect(
      parseStorageProbe({ measure, policy: { state: 'not-recorded' } }),
    ).toEqual({
      sizeGb: 1,
      usedGb: 0,
      usedPercent: 100,
      policy: { state: 'not-recorded' },
    });
  });

  it('should map the watcher last attempt to the last growth without the size it recorded, with the provisioned size', () => {
    const state = JSON.stringify({
      ...STATE,
      lastAttempt: {
        at: INSTANT,
        targetGb: 30,
        outcome: 'grown',
        detail: 'the provider reports 30 GB',
        sizeGb: 30,
      },
    });

    expect(parseStorageProbe({ measure: MEASURE, state, policy: ON })).toEqual({
      ...REPORT,
      provisionedGb: 19,
      lastGrowth: {
        at: INSTANT,
        targetGb: 30,
        outcome: 'grown',
        detail: 'the provider reports 30 GB',
      },
    });
  });

  it('should report no last growth for a watcher that learned the size but never attempted, nor a detail it never recorded', () => {
    const measured = JSON.stringify(STATE);
    const bare = JSON.stringify({
      ...STATE,
      lastAttempt: { at: INSTANT, targetGb: 30, outcome: 'failed' },
    });

    expect({
      measured: parseStorageProbe({
        measure: MEASURE,
        state: measured,
        policy: ON,
      }),
      bare: parseStorageProbe({ measure: MEASURE, state: bare, policy: ON }),
    }).toEqual({
      measured: { ...REPORT, provisionedGb: 19 },
      bare: {
        ...REPORT,
        provisionedGb: 19,
        lastGrowth: { at: INSTANT, targetGb: 30, outcome: 'failed' },
      },
    });
  });

  it('should report a failed attempt without a target, and no provisioned size, for a watcher whose size query failed', () => {
    const state = JSON.stringify({
      version: 1,
      lastAttempt: {
        at: INSTANT,
        outcome: 'failed',
        detail: 'the size query failed',
      },
    });

    expect(parseStorageProbe({ measure: MEASURE, state, policy: ON })).toEqual({
      ...REPORT,
      lastGrowth: {
        at: INSTANT,
        outcome: 'failed',
        detail: 'the size query failed',
      },
    });
  });

  it.each([
    { label: 'an empty output', measure: '' },
    { label: 'a header alone', measure: HEADER },
    { label: 'a size of zero', measure: `${HEADER}\nnone 0 0 0 - /data` },
    {
      label: 'no mount point after the capacity',
      measure: `${HEADER}\n/dev/vdb 1 1 1 1%`,
    },
    {
      label: 'a size that is not a number',
      measure: `${HEADER}\n/dev/vdb many 1 1 1% /data`,
    },
  ])('should refuse a measure with $label', ({ measure }) => {
    expect(() => parseStorageProbe({ measure, policy: ON })).toThrow(
      new Error('The storage measure is malformed'),
    );
  });

  it.each([
    { label: 'text that is not JSON', state: '{' },
    {
      label: 'a state beyond the size the watcher writes',
      state: ' '.repeat(4097),
    },
    { label: 'a state that is no object', state: '[]' },
    {
      label: 'an unknown version',
      state: JSON.stringify({ ...STATE, version: 2 }),
    },
    {
      label: 'a field the watcher does not write',
      state: JSON.stringify({ ...STATE, extra: true }),
    },
    {
      label: 'a fractional provisioned size',
      state: JSON.stringify({ ...STATE, lastSizeGb: 1.5 }),
    },
    {
      label: 'an instant Date does not write back',
      state: JSON.stringify({ ...STATE, sizeChangedAt: '2026-11-08' }),
    },
    {
      label: 'an attempt with an unknown outcome',
      state: JSON.stringify({
        ...STATE,
        lastAttempt: { ...FAILED, outcome: 'pending' },
      }),
    },
    {
      label: 'a grown attempt without a target',
      state: JSON.stringify({
        ...STATE,
        lastAttempt: { at: INSTANT, outcome: 'grown' },
      }),
    },
    {
      label: 'an attempt with a fractional target',
      state: JSON.stringify({
        ...STATE,
        lastAttempt: { ...FAILED, targetGb: 1.5 },
      }),
    },
    {
      label: 'an attempt with a field the watcher does not write',
      state: JSON.stringify({ ...STATE, lastAttempt: { ...FAILED, by: 'x' } }),
    },
    {
      label: 'an attempt whose detail holds a control character',
      state: JSON.stringify({
        ...STATE,
        lastAttempt: { ...FAILED, detail: 'refused\u001b[2J' },
      }),
    },
    {
      label: 'an attempt with a negative size',
      state: JSON.stringify({
        ...STATE,
        lastAttempt: { ...FAILED, sizeGb: -1 },
      }),
    },
    {
      label: 'an attempt that is no object',
      state: JSON.stringify({ ...STATE, lastAttempt: 'failed' }),
    },
  ])('should refuse a watcher state with $label', ({ state }) => {
    expect(() =>
      parseStorageProbe({ measure: MEASURE, state, policy: ON }),
    ).toThrow(new Error('The storage watcher state is not valid'));
  });
});

describe('fn:storageWarnings', () => {
  it('should warn of nothing for storage below its threshold whose last growth succeeded', () => {
    expect(
      storageWarnings({
        ...REPORT,
        lastGrowth: { at: INSTANT, targetGb: 20, outcome: 'grown' },
      }),
    ).toEqual([]);
  });

  it.each([
    { state: 'off', policy: { state: 'off' } },
    { state: 'unsupported', policy: { state: 'unsupported' } },
    { state: 'not-recorded', policy: { state: 'not-recorded' } },
  ] as const)(
    'should warn of nearly full storage whose policy is $state',
    ({ policy }) => {
      expect(
        storageWarnings({ ...REPORT, usedGb: 19, usedPercent: 95, policy }),
      ).toEqual([expect.stringContaining('95% full')]);
    },
  );

  it.each([
    { sizeGb: 97, limitGb: 100 },
    { sizeGb: 11.7, limitGb: 12 },
  ])(
    'should warn of storage past its threshold whose filesystem of $sizeGb GB has reached the limit of $limitGb GB, allowing for its metadata, when the provisioned size is unknown',
    ({ sizeGb, limitGb }) => {
      expect(
        storageWarnings({
          sizeGb,
          usedGb: sizeGb * 0.85,
          usedPercent: 85,
          policy: { ...ON, limitGb },
        }),
      ).toEqual([
        expect.stringContaining(`growth limit of ${String(limitGb)} GB`),
      ]);
    },
  );

  it.each([
    {
      label: 'below its threshold at the limit',
      sizeGb: 98,
      usedPercent: 79,
      limitGb: 100,
    },
    {
      label: 'past its threshold below the limit',
      sizeGb: 96.9,
      usedPercent: 85,
      limitGb: 100,
    },
    {
      label:
        'past its threshold, a 490 GB volume measuring 482 GB, below the limit',
      sizeGb: 482,
      usedPercent: 85,
      limitGb: 500,
    },
  ])(
    'should not warn of the growth limit for storage $label when the provisioned size is unknown',
    ({ sizeGb, usedPercent, limitGb }) => {
      expect(
        storageWarnings({
          ...REPORT,
          sizeGb,
          usedPercent,
          policy: { ...ON, limitGb },
        }),
      ).toEqual([]);
    },
  );

  it.each([
    { provisionedGb: 100, sizeGb: 90, expected: ['growth limit of 100 GB'] },
    { provisionedGb: 99, sizeGb: 98, expected: [] },
  ])(
    'should judge the growth limit by the provisioned size of $provisionedGb GB rather than the filesystem of $sizeGb GB',
    ({ provisionedGb, sizeGb, expected }) => {
      expect(
        storageWarnings({
          ...REPORT,
          sizeGb,
          usedPercent: 85,
          provisionedGb,
        }),
      ).toEqual(expected.map((text) => expect.stringContaining(text)));
    },
  );

  it('should give both warnings for nearly full storage at its limit', () => {
    expect(
      storageWarnings({ sizeGb: 98, usedGb: 95, usedPercent: 97, policy: ON }),
    ).toEqual([
      expect.stringContaining('97% full'),
      expect.stringContaining('growth limit'),
    ]);
  });

  it('should warn of a failed last growth, with its target and detail when it has them', () => {
    const { detail, ...bare } = FAILED;
    const { targetGb: _targetGb, ...untargeted } = FAILED;

    expect({
      detailed: storageWarnings({ ...REPORT, lastGrowth: FAILED }),
      bare: storageWarnings({ ...REPORT, lastGrowth: bare }),
      untargeted: storageWarnings({ ...REPORT, lastGrowth: untargeted }),
    }).toEqual({
      detailed: [
        `The last storage growth to 30 GB at ${INSTANT} failed: ${detail}`,
      ],
      bare: [`The last storage growth to 30 GB at ${INSTANT} failed`],
      untargeted: [`The last storage growth at ${INSTANT} failed: ${detail}`],
    });
  });
});
