import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    exclude: ['e2e/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'lcov'],
      include: ['src/utils/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  }
})
