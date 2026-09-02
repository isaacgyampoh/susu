import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    // Only the new architecture is under test. The legacy edge functions run
    // on Deno and are covered by their own phase.
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The domain is pure, so nothing here needs a setup file, a DOM, or mocks.
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
