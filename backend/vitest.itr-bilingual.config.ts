import {defineConfig} from 'vitest/config';export default defineConfig({test:{environment:'node',include:['src/__tests__/itr-bilingual*.test.ts'],setupFiles:['src/__tests__/env-setup.ts']}});
