import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The end-to-end tests run with Playwright (`npm run test:e2e`).
    include: ["src/**/*.test.{ts,tsx}"],
    // The axe checks take 2-4 s each, and over Vitest's default 5 s on a busy machine.
    testTimeout: 15_000,
    // Used by `npm run test:coverage` (CI); lcov is what SonarQube Cloud reads (plan 012).
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // mock.ts is the dev-only fake backend (NEXT_PUBLIC_API_MOCK=1), not site code.
      // src/test/ holds test helpers.
      exclude: ["src/**/*.test.{ts,tsx}", "src/lib/mock.ts", "src/test/**"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
