import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/mobile-calling/**', 'src/__tests__/hub-*.test.ts', 'src/__tests__/channel-media.test.ts', 'src/__tests__/access-*.test.ts', 'src/__tests__/knowledge/**'],
    setupFiles: ['src/__tests__/env-setup.ts', 'src/__tests__/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 10000,
    reporters: 'verbose',
  },
});
