import { renderToString } from 'ink';
import { render } from 'ink-testing-library';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StatusMessage, TaskProgress } from '#cli/components/Display';
import { ResultDetails } from '#cli/components/ResultDetails';

describe('rc:Display', () => {
  it('should render nested result sections, booleans and long lists within terminal width', () => {
    const entry =
      'a-long-native-entry-name-that-exceeds-narrow-terminal-width@alvis';
    for (const columns of [40, 120]) {
      const text = renderToString(
        <ResultDetails
          title="create"
          value={{
            machine: { name: 'primary' },
            network: {
              online: true,
              reachable: false,
              entries: [entry],
              absent: undefined,
              missing: null,
              empty: [],
            },
          }}
        />,
        { columns },
      );

      expect(text).toContain('Workstation');
      expect(text).toContain('Name: primary');
      expect(text).toContain('Online: Yes');
      expect(text).toContain('Reachable: No');
      expect(text).toContain('Missing: Not reported');
      expect(text).toContain('Empty: None');
      expect(text).not.toContain('Absent:');
      expect(text).not.toContain('{"');
      expect(text.replaceAll(/\s/g, '')).toContain(entry);
      expect(text.split('\n').every((line) => line.length <= columns)).toBe(
        true,
      );
    }
  });

  it('should display actual workflow stages, counts and status words', () => {
    expect(
      renderToString(
        <TaskProgress
          update={{
            stage: 'routing',
            message: 'ready',
            completed: 2,
            total: 3,
          }}
        />,
      ),
    ).toContain('routing 2/3: ready');
    expect(
      renderToString(
        <TaskProgress update={{ stage: 'routing', message: 'ready' }} />,
      ),
    ).toContain('routing: ready');
    expect(
      renderToString(
        <TaskProgress
          update={{ stage: 'routing', message: 'ready', completed: 2 }}
        />,
      ),
    ).not.toContain('2/');
    expect(
      renderToString(
        <TaskProgress
          update={{
            stage: 'routing',
            message: 'failed',
            phase: 'complete',
            outcome: 'failed',
          }}
        />,
      ),
    ).toContain('✗ routing: failed');
    for (const kind of ['error', 'warning', 'success', 'info'] as const) {
      expect(
        renderToString(
          <StatusMessage update={{ kind, message: 'observed' }} />,
        ),
      ).toContain(`${kind.toUpperCase()}: observed`);
    }
  });

  it('should animate elapsed progress and cleans up the timer when completed', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    const update = {
      stage: 'create',
      message: 'working',
      phase: 'start',
    } as const;
    const view = render(
      <TaskProgress startedAt={Date.now() - 2000} update={update} />,
    );
    try {
      const first = view.lastFrame();
      expect(first).toContain('create: working (2s)');
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(view.lastFrame()).not.toBe(first);
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(view.lastFrame()).toContain('create: working (3s)');

      view.rerender(
        <TaskProgress
          startedAt={Date.now() - 3000}
          update={{
            stage: 'create',
            message: 'done',
            phase: 'complete',
            outcome: 'ok',
            durationMs: 3250,
          }}
        />,
      );
      expect(view.lastFrame()).toContain('✓ create: done (3.3s)');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
});
