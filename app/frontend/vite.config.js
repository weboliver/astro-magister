import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || 'localhost,127.0.0.1')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const apiProxy = {
  '/horoscope': { target: proxyTarget, changeOrigin: true, secure: false },
  '/transits': { target: proxyTarget, changeOrigin: true, secure: false },
  '/houses': { target: proxyTarget, changeOrigin: true, secure: false },
  '/auth': { target: proxyTarget, changeOrigin: true, secure: false },
  '/locations': { target: proxyTarget, changeOrigin: true, secure: false },
  '/getPosition': { target: proxyTarget, changeOrigin: true, secure: false },
  '/planets': { target: proxyTarget, changeOrigin: true, secure: false },
  '/solar-return': { target: proxyTarget, changeOrigin: true, secure: false },
  '/age-points': { target: proxyTarget, changeOrigin: true, secure: false },
  '/interpretations': { target: proxyTarget, changeOrigin: true, secure: false },
  '/persons': { target: proxyTarget, changeOrigin: true, secure: false },
  '/timezone': { target: proxyTarget, changeOrigin: true, secure: false },
  '/wiki': { target: proxyTarget, changeOrigin: true, secure: false },
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