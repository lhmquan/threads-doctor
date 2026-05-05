import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api/webhook': {
        target: 'https://tudong.soccanh.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/webhook/, '/webhook'),
      },
    },
  },
})
