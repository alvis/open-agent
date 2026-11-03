import { describe, expect, it } from 'vitest';

import { registry } from '#composition/registry';
import { agentPort, agentService } from '#domain/services';

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
  it('should be the service the selected agent declares', () => {
    const service = agentService(registry, { agent: 't3' });

    expect(service).toBe(registry.agents.t3.service);
  });
});
