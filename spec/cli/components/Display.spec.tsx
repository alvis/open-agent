import { renderToString } from 'ink';
import { render } from 'ink-testing-library';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  KeyValuePanel,
  MachineTable,
  StatusMessage,
  TaskProgress,
} from '#cli/components/Display';
import { ResultDetails } from '#cli/components/ResultDetails';

describe('rc:Display', () => {
  it('should render nested result sections, booleans and plugin lists within terminal width', () => {
    const plugin =
      'a-long-native-plugin-name-that-exceeds-narrow-terminal-width@alvis';
    for (const columns of [40, 120]) {
      const text = renderToString(
        <ResultDetails
          title="show"
          value={{
            machine: { name: 'primary' },
            inspection: {
              online: true,
              reachable: false,
              selectedPlugins: [plugin],
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
      expect(text.replaceAll(/\s/g, '')).toContain(plugin);
      expect(text.split('\n').every((line) => line.length <= columns)).toBe(
        true,
      );
    }
  });

  it('should lay out a list of records as a table with one aligned row per record', () => {
    const text = renderToString(
      <ResultDetails
        title="upgrade"
        value={{
          tools: [
            { name: 't3', outcome: 'installed', version: '0.1.12 → 0.1.13' },
            {
              name: 'ca-certificates',
              outcome: 'skipped',
              reason: 'is\ncurrent',
            },
          ],
        }}
      />,
      { columns: 120 },
    );

    expect(text.split('\n')).toEqual([
      'Upgrade',
      '  Tools',
      '    Name             Outcome    Version          Reason',
      '    t3               installed  0.1.12 → 0.1.13',
      '    ca-certificates  skipped                     is current',
    ]);
  });

  it('should give each record its own group when the table is wider than the terminal', () => {
    const text = renderToString(
      <ResultDetails
        columns={40}
        title="upgrade"
        value={{
          tools: [
            {
              name: 'ca-certificates',
              manager: 'system',
              version: '20260816ubuntu0.26.04.2',
            },
            { name: 't3', manager: 'npm', reason: 'it is current' },
            { manager: 'brew' },
          ],
        }}
      />,
      { columns: 40 },
    );

    expect(text.split('\n')).toEqual([
      'Upgrade',
      '  Tools',
      '    ca-certificates',
      '      Manager: system',
      '      Version: 20260816ubuntu0.26.04.2',
      '    t3',
      '      Manager: npm',
      '      Reason: it is current',
      '    Not reported',
      '      Manager: brew',
    ]);
  });

  it('should keep a list that mixes records with other values on one line', () => {
    const text = renderToString(
      <ResultDetails
        title="upgrade"
        value={{ restarts: [{ service: 'tailscaled' }, null] }}
      />,
      { columns: 120 },
    );

    expect(text).toContain('Restarts: Service: tailscaled, Not reported');
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
    expect(
      renderToString(
        <StatusMessage
          noColor
          update={{ kind: 'warning', message: 'observed' }}
        />,
      ),
    ).toContain('WARNING: observed');
  });

  it('should keep machine details readable in narrow and wide terminals', () => {
    const machines = [
      {
        name: 'primary',
        id: 'sprite-id',
        state: 'running',
        agentUrl: 'https://primary.sprites.app',
        setup: 'ready',
        organization: 'org',
        createdAt: '2026-10-07',
      },
    ];
    for (const columns of [40, 120]) {
      const text = renderToString(
        <MachineTable columns={columns} machines={machines} />,
      );
      expect(text).toContain('primary');
      expect(text).toContain('sprite-id');
      expect(text).toContain('ready');
    }
    expect(
      renderToString(<MachineTable machines={[{ id: 'id-only' }, {}]} />),
    ).toContain('Workstation');
    expect(
      renderToString(<MachineTable columns={180} machines={[{}]} />, {
        columns: 180,
      }),
    ).toContain('not recorded');
    expect(
      renderToString(
        <KeyValuePanel entries={[['state', 'ready']]} title="workstation" />,
      ),
    ).toContain('State: ready');
  });

  it('should show labelled agent and setup facts in narrow and wide lists', () => {
    const machines = [
      {
        name: 'primary',
        id: 'sprite-primary',
        state: 'running',
        createdAt: '2026-10-09',
        agentUrl: 'https://primary.sprites.app/',
        setup: 'ready',
        organization: 'example',
      },
    ];
    const narrow = renderToString(
      <MachineTable columns={40} machines={machines} />,
      { columns: 40 },
    );
    const wide = renderToString(
      <MachineTable columns={180} machines={machines} />,
      { columns: 180 },
    );

    expect(narrow).toContain('Workstation primary');
    expect(narrow).toContain('Setup: ready');
    expect(narrow).toContain('Agent URL:');
    expect(narrow).not.toContain('agentUrl');
    expect(wide).toContain('WORKSTATION');
    expect(wide).toContain('AGENT URL');
    expect(wide).toContain('https://primary.sprites.app/');
    expect(wide.split('\n')).toHaveLength(2);
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
