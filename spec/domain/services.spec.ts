import { describe, expect, it } from 'vitest';

import { registry } from '#composition/registry';
import {
  agentPort,
  agentService,
  dependOnDaemon,
  networkDaemon,
  staleServices,
} from '#domain/services';

import type { ServiceDefinition } from '#domain/services';

describe('fn:agentPort', () => {
  it('should reject an agent declaration without an HTTP port', () => {
    const service: ServiceDefinition = { ...registry.agents.t3.service };
    delete service.httpPort;
    const declarations = {
      ...registry,
      agents: { t3: { ...registry.agents.t3, service } },
    };

    expect(() => agentPort(declarations, 't3')).toThrow(
      expect.objectContaining({
        code: 'UNEXPECTED',
        message: expect.stringContaining('t3'),
      }),
    );
  });
});

describe('fn:agentService', () => {
  it('should depend on the daemon of a network that declares one', () => {
    const daemon = registry.networks.tailscale.daemon;

    expect(daemon).toBeDefined();
    expect(
      agentService(registry, { agent: 't3', network: 'tailscale' }).needs,
    ).toEqual([daemon?.name]);
  });

  it('should depend on no network when the selected network declares no daemon', () => {
    const service = agentService(registry, { agent: 't3', network: 'none' });

    expect(service.needs).toEqual([]);
    expect(service.name).toBe(registry.agents.t3.service.name);
  });
});

describe('fn:dependOnDaemon', () => {
  const daemon: ServiceDefinition = {
    name: 'netd',
    command: '/bin/netd',
    arguments: [],
    account: 'root',
    needs: [],
  };
  const service: ServiceDefinition = {
    ...daemon,
    name: 'agentd',
    command: '/bin/agentd',
  };

  it('should keep the needs the service declares and add the daemon after them', () => {
    expect(
      dependOnDaemon({ ...service, needs: ['storage'] }, daemon).needs,
    ).toEqual(['storage', 'netd']);
  });

  it('should list a daemon the service already needs once', () => {
    expect(
      dependOnDaemon({ ...service, needs: ['netd'] }, daemon).needs,
    ).toEqual(['netd']);
  });

  it('should keep the declared needs when the network runs no daemon', () => {
    expect(
      dependOnDaemon({ ...service, needs: ['storage'] }, undefined).needs,
    ).toEqual(['storage']);
  });
});

describe('fn:networkDaemon', () => {
  it('should find a daemon only for a network that declares one', () => {
    expect(networkDaemon(registry, 'none')).toBeUndefined();
    expect(networkDaemon(registry, 'tailscale')?.name).toBe('tailscaled');
  });
});

describe('fn:staleServices', () => {
  const agent: ServiceDefinition = {
    name: 't3-code',
    command: '/usr/local/bin/t3',
    arguments: [],
    account: 'agent',
    needs: [],
    runsOn: ['t3', 'bun', 'node'],
    waitsForIdle: true,
  };
  const daemon: ServiceDefinition = {
    name: 'tailscaled',
    command: '/usr/local/bin/tailscaled',
    arguments: [],
    account: 'root',
    needs: [],
    runsOn: ['tailscale'],
  };
  const cron: ServiceDefinition = {
    name: 'open-agent-cron',
    command: '/usr/sbin/cron',
    arguments: [],
    account: 'root',
    needs: [],
  };
  const STARTED = '2026-11-01T10:00:00Z';
  const running = (name: string, startedAt = STARTED) => ({
    name,
    status: 'running' as const,
    needs: [],
    startedAt,
  });

  it('should name each running service a tool it runs on was installed for after it started', () => {
    const result = staleServices(
      [agent, daemon, cron],
      [running('t3-code'), running('tailscaled'), running('open-agent-cron')],
      [
        { name: 'node', installedAt: '2026-11-02T00:00:00Z' },
        { name: 'bun', installedAt: '2026-11-03T00:00:00Z' },
        { name: 'tailscale', installedAt: '2026-10-30T00:00:00Z' },
        { name: 'codex', installedAt: '2026-11-03T00:00:00Z' },
      ],
    );

    expect(result).toEqual([{ service: agent, tools: ['bun', 'node'] }]);
  });

  it('should keep a service whose start time is unknown or that is not running', () => {
    const result = staleServices(
      [agent, daemon],
      [
        { name: 't3-code', status: 'running', needs: [] },
        { ...running('tailscaled'), status: 'stopped' },
      ],
      [
        { name: 't3', installedAt: '2026-11-02T00:00:00Z' },
        { name: 'tailscale', installedAt: '2026-11-02T00:00:00Z' },
      ],
    );

    expect(result).toEqual([]);
  });

  it('should ignore a tool without a readable install time', () => {
    const result = staleServices(
      [daemon],
      [running('tailscaled')],
      [{ name: 'tailscale' }, { name: 'tailscale', installedAt: 'soon' }],
    );

    expect(result).toEqual([]);
  });
});
