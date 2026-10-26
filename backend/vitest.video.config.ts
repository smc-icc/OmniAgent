import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/__tests__/video-*.test.ts', 'src/__tests__/sip-tenancy.test.ts'], setupFiles: ['src/__tests__/release-env-setup.ts'] } });
