import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/__tests__/social/**/*.test.ts',
  'src/__tests__/ccs-session-manager.test.ts', 'src/__tests__/ccs-bridge-login.test.ts'],
  setupFiles: ['src/__tests__/release-env-setup.ts'], testTimeout: 10000 } });
