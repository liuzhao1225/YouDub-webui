import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom", "clsx"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // Browser storage belongs to jsdom, including on Node versions with Web Storage enabled.
    execArgv: ["--no-webstorage"],
    setupFiles: ["./vitest.setup.ts"],
    clearMocks: true,
  },
})
