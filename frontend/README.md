# Hearth & Page frontend (v2)

A modern Vite + React 18 + TypeScript + Tailwind app that ships alongside the
legacy `hp-patches.js`-based UI. Serves under `/app-v2/*`. See project note
**"Path C hybrid"** for full context on why this coexists with the old app
instead of replacing it.

## Layout

```
frontend/
  index.html            entry HTML — mounts <App /> at #root
  src/
    main.tsx            React root + <BrowserRouter basename="/app-v2">
    App.tsx             shell (header, footer, <Routes>)
    pages/
      StatusPage.tsx    /app-v2/status — first real screen (POC)
    index.css           Tailwind entry
  public/               static assets copied verbatim into the bundle
  vite.config.ts        base: '/app-v2/', outDir: '../dist/public/new'
  tailwind.config.js    'hp-*' color tokens mirror legacy CSS
  tsconfig.json         strict TS
  package.json
```

## Dev

```
cd frontend
npm install
# In one terminal: run the backend
NODE_ENV=development node ../dist/index.cjs
# In another: run the Vite dev server
npm run dev
```

Vite dev server runs at http://localhost:5173/app-v2/. API calls to `/api/*`
are proxied to `http://localhost:3000` (see `vite.config.ts`).

## Build

```
cd frontend && npm run build
```

Output lands in `../dist/public/new/`. The Express server (see
`dist/index.cjs`) serves anything under `/app-v2/*` from that directory with
SPA-style fallback to `index.html`.

The nixpacks build phase runs `npm ci --prefix frontend` + `npm --prefix
frontend run build` automatically on every deploy.

## Adding a new screen

1. Create `src/pages/YourScreen.tsx`.
2. Add `<Route path="/your-path" element={<YourScreen />} />` in `App.tsx`.
3. It's live at `/app-v2/your-path` after the next build.

## Design tokens

Tailwind config exposes an `hp-*` palette (`hp-primary`, `hp-accent`,
`hp-ink`, `hp-muted`, `hp-surface`, `hp-border`) meant to visually match the
legacy app so cross-linked screens don't feel jarring. Adjust here rather
than duplicating hex codes across components.

## Same-origin API

All fetches use relative URLs (`/api/health`, not `https://.../api/health`).
The backend serves both the old app AND the v2 bundle, so relative URLs
Just Work.

## Why is this separate from the legacy app?

The legacy frontend is a 1.5 MB minified React bundle with **no source
code**, plus a 950 KB `hp-patches.js` that monkey-patches functions onto
`window.*` at runtime. Rebuilding the whole thing in modern React is
weeks of work with high risk of regressions.

Path C: build NEW UI here in modern React; keep old UI at `/*` untouched.
If a legacy screen ever needs modification, port that one screen to
`/app-v2/*` at that time. Never a big-bang migration.
