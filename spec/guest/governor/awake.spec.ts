import { describe, expect, it } from 'vitest';

import {
  judgeHookInput,
  runCutShortAwakeEvent,
  storeAdapterResult,
} from '../../mocks/governor';

import type { AwakeEventScenario } from '../../mocks/governor';

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-17T12:00:00.000Z');

const cutShort = async (scenario: Partial<AwakeEventScenario>) =>
  runCutShortAwakeEvent({
    action: 'hold-open',
    keepAwakeMode: 'native-deadline',
    idleTimeoutMinutes: 5,
    holdMaxMinutes: 60,
    now: NOW,
    ...scenario,
  });

describe('fn:oa_idle_event', () => {
  it('should keep the workstation awake for the hold maximum when a turn start is cut short while recording', async () => {
    const ran = await cutShort({});

    expect(ran).toEqual([
      `apply-deadline ${String(NOW + 60 * MINUTE)}`,
      'record',
    ]);
  });

  it('should keep a turn awake when its end, cut short, leaves background work running', async () => {
    const ran = await cutShort({
      action: 'hold-close',
      hasBackgroundWork: true,
    });

    expect(ran).toEqual([
      `apply-deadline ${String(NOW + 60 * MINUTE)}`,
      'record',
    ]);
  });

  it('should apply the idle timeout when it outlasts the hold maximum', async () => {
    const ran = await cutShort({ idleTimeoutMinutes: 30, holdMaxMinutes: 10 });

    expect(ran).toEqual([
      `apply-deadline ${String(NOW + 30 * MINUTE)}`,
      'record',
    ]);
  });

  it.each<[string, Partial<AwakeEventScenario>]>([
    ['a heartbeat, which could shorten an open hold', { action: 'heartbeat' }],
    ['a turn end with no background work', { action: 'hold-close' }],
    ['a root caller, which never runs the adapter', { uid: 0 }],
    ['a governed provider', { keepAwakeMode: 'governed' }],
    ['another apply holding the apply lock', { isApplyLockHeld: true }],
  ])(
    'should apply nothing before recording for %s',
    async (_case, scenario) => {
      const ran = await cutShort(scenario);

      expect(ran).toEqual(['record']);
    },
  );
});

describe('fn:oa_idle_hook_session', () => {
  it('should read the session id from a hook input object', async () => {
    const verdict = await judgeHookInput(
      '{"session_id":"0b-1.2:A_c","cwd":"/home/agent"}',
    );

    expect(verdict).toEqual({ session: '0b-1.2:A_c' });
  });

  it('should accept a session id of 128 characters', async () => {
    const session = 'a'.repeat(128);

    const verdict = await judgeHookInput(
      JSON.stringify({ session_id: session }),
    );

    expect(verdict).toEqual({ session });
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['truncated JSON', '{"session_id":'],
  ])('should refuse %s as not JSON', async (_case, input) => {
    const verdict = await judgeHookInput(input);

    expect(verdict).toEqual({ refusal: 'hook input is not JSON' });
  });

  it.each([
    ['an object without session_id', '{"cwd":"/home/agent"}'],
    ['a session_id that is not a string', '{"session_id":5}'],
    ['an array', '[{"session_id":"s1"}]'],
    ['two objects', '{"session_id":"s1"}{"session_id":"s2"}'],
    ['empty input', ''],
  ])('should refuse %s as having no session', async (_case, input) => {
    const verdict = await judgeHookInput(input);

    expect(verdict).toEqual({
      refusal: 'hook input has no session_id string',
    });
  });

  it.each([
    ['a space', 'bad id'],
    ['a slash', '../s1'],
    ['no characters', ''],
    ['129 characters', 'a'.repeat(129)],
  ])('should refuse a session id with %s', async (_case, session) => {
    const verdict = await judgeHookInput(
      JSON.stringify({ session_id: session }),
    );

    expect(verdict).toEqual({
      refusal:
        'hook session_id must be 1 to 128 letters, digits or ._:- characters',
    });
  });
});

describe('fn:oa_idle_record_adapter', () => {
  const recordedState = {
    deadline: '2026-11-17T13:00:00.000Z',
    holders: 1,
    adapter: { at: '2026-11-17T11:00:00.000Z', result: 'applied' },
  };

  it('should store the apply result in the state the event recorded', async () => {
    const adapterResult = {
      at: '2026-11-17T12:00:00.000Z',
      action: 'apply-deadline',
      result: 'applied',
    };

    const stored = await storeAdapterResult({ recordedState, adapterResult });

    expect(stored).toEqual({
      state: { ...recordedState, adapter: adapterResult },
      mode: 0o640,
    });
  });

  it('should leave the recorded state as it was when the apply left no result', async () => {
    const stored = await storeAdapterResult({ recordedState });

    expect(stored).toEqual({ state: recordedState, mode: 0o600 });
  });

  it('should write no state when the event recorded none', async () => {
    const stored = await storeAdapterResult({
      adapterResult: { result: 'applied' },
    });

    expect(stored).toEqual({});
  });
});
