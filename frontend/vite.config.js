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
        // rolldown (vite 8) requires manualChunks as a function, not an object
        manualChunks(id) {
          if (id.includes('recharts')) return 'recharts'
          if (id.includes('@clerk/clerk-react')) return 'clerk'
          if (/src\/pages\/(Admin|ManualEntry|BallEntry|UserAdmin)\.jsx/.test(id)) return 'admin'
          if (/src\/pages\/(MatchDetail|PlayerDetail)\.jsx/.test(id)) return 'detail'
        }
      }
    }
  }
})
