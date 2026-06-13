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
      include: ['src/utils/**', 'src/components/**'],
      thresholds: {
        'src/utils/**': {
          lines: 70,
          functions: 70,
          branches: 70,
          statements: 70
        }
      }
    }
  }
})
