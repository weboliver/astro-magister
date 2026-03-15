React + Vite frontend for Astronex

Quickstart (on your machine):

```bash
cd app/frontend
npm install
npm run dev
```

- Dev server runs on http://localhost:5173 by default and proxies API calls to `http://localhost:8000` as configured in `vite.config.js`.
- Production build: `npm run build` creates `dist/` which you can serve with FastAPI or a static server.

Notes:
- This is a minimal scaffold: auth calls target `/auth/*` endpoints which must be implemented in the FastAPI backend.
- For secure JWT storage use httpOnly cookies from the backend instead of `localStorage` in production.
