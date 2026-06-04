import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Override with VITE_API_PROXY for isolated e2e runs (see playwright.config.js)
      '/api': process.env.VITE_API_PROXY || 'http://localhost:3001'
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy chart library — only loaded on match detail and season pages
          recharts: ['recharts'],
          // Clerk auth — separating it shrinks the main chunk
          clerk: ['@clerk/clerk-react'],
          // Admin-only pages — not needed by regular viewers
          admin: [
            './src/pages/Admin.jsx',
            './src/pages/ManualEntry.jsx',
            './src/pages/BallEntry.jsx',
            './src/pages/UserAdmin.jsx',
          ],
          // Large match/player detail pages — deferred until navigation
          detail: [
            './src/pages/MatchDetail.jsx',
            './src/pages/PlayerDetail.jsx',
          ],
        },
      },
    },
  },
})
