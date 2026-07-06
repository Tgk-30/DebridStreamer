import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Installs the outbound-fetch guard (see test/setup.ts) before every test
    // file so an un-mocked network call fails deterministically instead of
    // leaking to real indexers.
    setupFiles: ["./test/setup.ts"],
  },
});
