import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'open-agent:E2E',
    include: ['e2e/**/*.spec.e2e.ts'],
    globalSetup: ['e2e/setup.ts'],
    // the machine specs spend most of their time waiting on providers, so
    // every spec file gets a worker and a run lasts as long as its slowest
    // spec rather than all of them in turn
    fileParallelism: true,
    maxWorkers: 5,
    testTimeout: 5_400_000, // 90 minutes; one real creation can exceed 10
  },
});
