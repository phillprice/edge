import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Override with VITE_API_PROXY for isolated e2e runs (see playwright.config.js)
      '/api': process.env.VITE_API_PROXY || 'http://localhost:3001'
    }
  }
})
