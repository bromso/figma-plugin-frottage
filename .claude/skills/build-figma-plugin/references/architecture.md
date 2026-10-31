# Template Architecture

## Two-Process Model

Figma plugins run as **two separate processes** that communicate via message passing:

```
┌─────────────────────────┐     messages     ┌─────────────────────────┐
│     Plugin Process      │ ◄──────────────► │      UI Process         │
│                         │                  │                         │
│  apps/design-plugin/    │                  │  packages/ui/src/       │
│    src/plugin/          │                  │                         │
│      plugin.ts          │                  │    app.tsx  (React)     │
│      plugin.network.ts  │                  │    app.network.tsx      │
│                         │                  │    main.tsx             │
│  Has: figma.* API       │                  │  Has: DOM, React, CSS  │
│  No: DOM, window        │                  │  No: figma.* API       │
└─────────────────────────┘                  └─────────────────────────┘
```

## File Roles

| File | Process | Purpose |
|------|---------|---------|
| `packages/common/src/networkSides.ts` | Shared | Defines message types both sides understand |
| `apps/design-plugin/src/plugin/plugin.ts` | Plugin | Entry point — opens UI window, initializes networking |
| `apps/design-plugin/src/plugin/plugin.network.ts` | Plugin | Registers handlers for messages FROM the UI |
| `packages/ui/src/app.tsx` | UI | React component — the plugin's visible interface |
| `packages/ui/src/app.network.tsx` | UI | Registers handlers for messages FROM the plugin |
| `packages/ui/src/main.tsx` | UI | Bootstrap — mounts React app, initializes networking |
| `apps/design-plugin/figma.manifest.ts` | Build | Plugin metadata — name, ID, capabilities |

## Build Output

Both processes build to `apps/design-plugin/dist/`:
- `dist/index.html` — Single HTML file with ALL JS + CSS inlined (Figma requirement)
- `dist/plugin.js` — Plugin sandbox code
- `dist/manifest.json` — Generated from `figma.manifest.ts`

## Monorepo Structure

```
apps/
  design-plugin/      — Figma plugin app (builds to dist/)
  storybook/          — Component documentation (not part of plugin)
  docs/               — Documentation site (Next.js + Fumadocs)
packages/
  common/             — Shared types and message definitions
  ui/                 — React UI components and app shell
```

Use `@repo/ui` and `@repo/common` for imports across packages.
