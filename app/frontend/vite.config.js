import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || 'localhost,127.0.0.1,raspissd,raspissd.local,astro-magister.de,www.astro-magister.de')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const apiProxy = {
  // Only proxy API requests to the FastAPI backend during development and preview.
  // Keep the root (/) for Vite to serve the React app.
  '/horoscope': { target: proxyTarget, changeOrigin: true, secure: false },
  '/transits': { target: proxyTarget, changeOrigin: true, secure: false },
  '/houses': { target: proxyTarget, changeOrigin: true, secure: false },
  '/auth': { target: proxyTarget, changeOrigin: true, secure: false },
  '/wiki': { target: proxyTarget, changeOrigin: true, secure: false },
  '/locations': { target: proxyTarget, changeOrigin: true, secure: false },
  '/getPosition': { target: proxyTarget, changeOrigin: true, secure: false },
  '/planets': { target: proxyTarget, changeOrigin: true, secure: false },
  '/solar-return': { target: proxyTarget, changeOrigin: true, secure: false },
  '/age-points': { target: proxyTarget, changeOrigin: true, secure: false }
}

export default defineConfig({
  envDir: '../..',
  plugins: [react()],
  server: {
    allowedHosts,
    port: 5173,
    proxy: apiProxy
  },
  preview: {
    allowedHosts,
    proxy: apiProxy
  }
})
