import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    exclude: ['e2e/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'lcov'],
      include: ['src/utils/**', 'src/components/**', 'src/hooks/**', 'src/pages/**'],
      thresholds: {
        lines: 34,
        functions: 26,
        branches: 27,
        statements: 32,
        'src/utils/**': {
          lines: 90,
          functions: 95,
          branches: 80,
          statements: 90
        }
      }
    }
  }
})
