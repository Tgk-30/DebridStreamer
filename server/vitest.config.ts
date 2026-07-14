import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // The shipped scrypt work factor (N=2^15) is deliberately expensive. Nearly
      // every test here sets up an owner and profiles, and each one pays it: on a
      // loaded CI runner that pushed the longest test past the 20s limit and
      // failed a release build, which then passed unchanged on retry.
      //
      // This cannot weaken production: crypto.ts only honours the override under
      // NODE_ENV=test (which vitest sets), and verifyPassword reads N/r/p back
      // out of each stored hash, so hashes written at any cost stay verifiable.
      DS_SCRYPT_N: "1024",
    },
  },
});
