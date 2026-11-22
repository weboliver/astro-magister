import { defineConfig } from 'astro/config'
// Der öffentliche Host steht im Code genau einmal: `app/frontend/src/services/canonical.js`
// (D-07/D-10). Dieselbe Aussage trägt `NGINX_CANONICAL_HOST` in `.env`; hier wird sie
// importiert, nicht als zweites Literal wiederholt. `Astro.site` ist damit die eine
// Host-Quelle des Builds — Canonical, JSON-LD und interne absolute Links leiten daraus ab.
import { CANONICAL_ORIGIN } from '../frontend/src/services/canonical.js'

export default defineConfig({
  output: 'static',
  site: CANONICAL_ORIGIN,
})
