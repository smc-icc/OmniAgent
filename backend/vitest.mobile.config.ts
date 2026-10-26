import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/mobile-calling/**/*.test.ts"],
    exclude: ["src/__tests__/mobile-calling/**/*.integration.test.ts"],
    setupFiles: ["src/__tests__/env-setup.ts"],
    testTimeout: 10000,
    reporters: "verbose",
  },
});
