import { defineConfig } from 'vitest/config';

// Only isolated, mocked or in-memory suites. Never load the default setup.ts,
// which builds the full application and can use a developer database.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/__tests__/release-dependencies.test.ts',
      'src/__tests__/hub-*.test.ts',
      'src/__tests__/access-*.test.ts',
      'src/__tests__/knowledge/**/*.unit.test.ts',
      'src/__tests__/phase3-ops-channels.test.ts',
      'src/__tests__/channel-media.test.ts',
      'src/__tests__/overseas-im.test.ts',
      'src/__tests__/login-session.test.ts',
      'src/__tests__/email-login.test.ts',
      'src/__tests__/system-superuser*.test.ts',
      'src/__tests__/conf-tenancy*.test.ts',
      'src/__tests__/ccs-workno.test.ts',
    ],
    setupFiles: ['src/__tests__/release-env-setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: 'verbose',
  },
});
