import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const proxyTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || 'localhost,127.0.0.1')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

// Genau ein API-Eingang: alles unter `/api/` gehört der API, der Rest der SPA.
// Der Key beginnt mit `^`, also interpretiert Vite ihn als RegExp — das hält die Grenze
// byte-gleich zu nginx `location /api/`: `/apiary` oder `/api-docs` werden nicht verschluckt.
// `rewrite` schneidet das Präfix ab wie nginx `^/api/(.*)$ /$1`; das Backend bleibt präfixlos.
// Kein `ws: true` — HMR läuft weiter über `location /`.
// `/api` ohne Schrägstrich fällt in den SPA-Fallback statt 301 wie nginx — bewusst,
// niemand ruft `/api` nackt.
// `preview.proxy` bleibt explizit, weil der `--prod`-Pfad (`vite preview`) daran hängt.
const apiProxy = {
  '^/api/': {
    target: proxyTarget,
    changeOrigin: true,
    secure: false,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
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
