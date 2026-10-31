# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Building Your Plugin (No Coding Required)

This template comes with an AI skill that lets you describe what you want and have Claude build it for you.

### Quick Start

1. Open this project in Claude Code
2. Describe your plugin idea: "I want a plugin that..."
3. Claude will ask a few questions, then build the entire plugin
4. Follow the installation guide to test it in Figma

### Example Prompts

- "Build a plugin that renames all selected layers to lowercase"
- "I want a plugin that lets me pick a color and apply it to selected frames"
- "Make a plugin that counts how many text layers are on the current page"
- "Add a settings panel to my plugin with a dropdown for font selection"
- "My plugin button doesn't do anything — can you fix it?"

### Available Skills

- **build-figma-plugin** — Build a complete plugin from a plain English description. This is the only skill shipped with the template; install others into your own Claude Code setup if you want them.

### MCP Servers (pre-configured in `.mcp.json`)

- **Figma** (Figma's official remote server, `https://mcp.figma.com/mcp`) — Lets Claude read your Figma files from a pasted link; sign in once with `/mcp` → figma → Authenticate (no API key)
- **Context7** — Fetches up-to-date library documentation to reduce errors
- **Sequential Thinking** — Lets Claude work through multi-step problems before acting

Claude Code asks you to approve these project servers on first start; `/mcp` shows their status. Personal servers, or keys you would rather not reference from the repository, go in your own config via `claude mcp add --scope local`; shared servers reference keys as `${VAR}` in `.mcp.json`. `.claude/settings.json` cannot define servers.

---

## Git & Versioning

- **Always create feature branches** -- never commit directly to master
- **Branch naming**: `feat/`, `fix/`, `chore/`, `docs/` prefixes
- **Conventional commits**: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`
- **After making user-facing changes**, run `bun changeset` and commit the changeset file
- **Don't bump versions manually** -- changesets handles version bumps and CHANGELOG
- **Releases**: merging to master runs `release.yml`, which opens (or updates) a "chore: version packages" PR containing the version bumps and CHANGELOG entries from the pending changesets; merging that PR lands them on master and creates a git tag plus a GitHub Release per package

---

## Project Overview

Figma/FigJam plugin boilerplate using React, Bun, TypeScript, and Turborepo monorepo. Originally based on [CoconutGoodie/figma-plugin-react-vite](https://github.com/CoconutGoodie/figma-plugin-react-vite); the build is now Bun and the UI is a [shadcn/ui](https://ui.shadcn.com) component library on Tailwind CSS 4, themed to Figma's UI3 design and documented in Storybook.

## Commands

All commands use **Bun** as the package manager. Run from the repo root.

- `bun run dev` — Watch-mode plugin build (UI + sandbox via `build.ts --watch`) and the docs site dev server (port 3000), run in parallel by Turborepo
- `bun run build` — Production build of the plugin (UI + sandbox to `apps/design-plugin/dist/`) and the docs site
- `bun run analyze` — Production build plus `dist/meta-*.json` bundle size reports
- `bun run test` — Run all tests across all packages (bun test)
- `bun run test:watch` — Watch mode for tests
- `bun run types` — Type-check the plugin, `ui`, `common`, Storybook and the docs app (`tsc --noEmit`; the docs task generates `.source` and runs `next typegen` first)
- `bun run lint` — Lint all packages (Biome)
- `bun run docs` — Start the documentation site (Next.js, port 3000)
- `bun run storybook` — Start Storybook (apps/storybook, port 6006)
- `bun run build-storybook` — Build static Storybook (cached by Turborepo)

### Package-scoped commands

- `bun run --filter @repo/ui test` — Run UI package tests only
- `bun run --filter @repo/common test` — Run common package tests only
- `bun run --filter @repo/design-plugin build` — Build plugin only
- `bun run --filter @repo/storybook storybook` — Start Storybook only

## Monorepo Structure

```
apps/
  design-plugin/    — Figma plugin app (build.ts bundles to dist/)
  storybook/        — Storybook component documentation
  docs/             — Documentation site (Next.js + Fumadocs, port 3000)
packages/
  common/           — Shared types and network event definitions (@repo/common)
  ui/               — UI components, styles, and app shell (@repo/ui)
```

### Workspace Imports

Use `@repo/*` workspace imports (not relative paths across packages):
- `import { Button } from '@repo/ui'`
- `import { NetworkSide } from '@repo/common'`

Packages are **JIT source-only** — they export raw TypeScript (no build step). Bun resolves them via workspace links.

## Architecture

The plugin runs as **two separate processes** that communicate via message passing:

- **Plugin side** (`apps/design-plugin/src/plugin/`) — Runs in Figma's sandbox with access to the Figma API (`figma.*`). No DOM access. Entry: `plugin.ts`.
- **UI side** (`packages/ui/src/`) — Runs in an iframe. React app built from the `@repo/ui` components. Entry: `main.tsx` → `app.tsx`; `app.tsx` is the sampler laid out like a Figma properties panel and is the reference for new screens.
- **Common** (`packages/common/src/`) — Shared between both sides. Contains network event type definitions.

### UI Components

`packages/ui/src/index.ts` exports 45 shadcn/ui component files (`packages/ui/src/components/ui/`, from Accordion to Tooltip, including Dialog, DropdownMenu, Tabs, Command and Sheet) and four custom Figma components (`packages/ui/src/components/figma/`): `Icon`, `IconButton`, `SectionTitle`, `Type`. Sixteen of the shadcn components are edited to match Figma's UI3 kit (Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog, AlertDialog); the rest use the same tokens and scale. Always import from `@repo/ui`; never add another UI library.

Icons come from a registered Lucide subset (`lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis`); add more with `registerIcons()`.

### Messaging (monorepo-networker)

Communication between sides uses [monorepo-networker](https://github.com/CoconutGoodie/monorepo-networker):

1. **Define events** in `packages/common/src/networkSides.ts` — each side declares the events it *listens* to, with typed signatures.
2. **Build channels** in `*.network.ts` files — `plugin.network.ts` and `app.network.tsx` set up transport (postMessage) and register handlers.
3. **Use channels** — on the plugin side `PLUGIN_CHANNEL.emit(UI, "event", [args])` for fire-and-forget and `.request(...)` for request/response (returns a Promise); on the UI side the channel is `UI_CHANNEL` and the target is `PLUGIN`.

### Build System

Turborepo orchestrates tasks. The plugin is built by one script, `apps/design-plugin/build.ts`, run with Bun:
- UI: `Bun.build` with the `index.html` entrypoint in standalone mode (`compile: true, target: "browser"`), which inlines all JS, CSS and assets into `dist/index.html`. Tailwind runs via `bun-plugin-tailwind`; React Compiler via `reactCompiler: true`.
- Plugin sandbox: `Bun.build` of `src/plugin/plugin.ts` as an IIFE to `dist/plugin.js`.
- Manifest: `dist/manifest.json` written from `figma.manifest.ts`.

`bun run dev` runs the same script with `--watch`; `bun run analyze` adds `dist/meta-*.json` size reports. Figma requires the UI to be a single HTML file — never add external file references.

Storybook (`apps/storybook`) is the only workspace that still uses Vite.

Bun does not downlevel syntax: `dist/plugin.js` ships modern JavaScript unchanged (verified in Figma's sandbox during the Bun migration), so there is no syntax-target option.

### Styling and theming

The UI package uses Tailwind CSS 4 only; there are no CSS Modules. `packages/ui/src/styles.css` defines `--ui3-*` tokens, most as `var(--figma-color-*, <UI3 kit fallback>)` and the rest (menu, tooltip and translucent-border tokens) as static values because Figma documents no variable for them, so inside Figma (`showUI` with `themeColors: true`) the bound colors follow the user's theme live, and in Storybook or tests the fallbacks apply. The tokens are exposed as `figma-*` Tailwind colors (`bg-figma-bg-secondary`, `text-figma-text-secondary`, `border-figma-border`, …) and also back the shadcn aliases (`bg-background`, `text-muted-foreground`, …). Menus and tooltips are dark in both themes by design. The scale is 24 px controls, 11 px Inter at weight 450, 5 px radius (13 px for menus and dialogs). Never hard-code a color. Full explanation: `apps/docs/content/docs/guides/theming.mdx`; the bound-versus-static token table is `packages/ui/src/figma-variables.md`.

## Tooling

- **Bun 1.4.2** — Package manager, bundler and test runner (sole lockfile: `bun.lock`)
- **Turborepo** — Monorepo task orchestration with caching
- **Biome 2.6.4** — Linting and formatting (root `biome.json`)
- **bun test** — Testing framework (happy-dom via preload for UI, plain runtime for common)
- **Storybook 10.6.5** — Component documentation with a light/dark toolbar and `UI3/*` parity stories against kit screenshots
- **Tailwind CSS 4** — Styling for the plugin UI and Storybook, via `bun-plugin-tailwind` in the plugin build and `@tailwindcss/vite` in Storybook (the docs site uses `@tailwindcss/postcss` with the Fumadocs 16 presets)
- **Next 16 + Fumadocs 16 + Serwist** — The docs site: static export to GitHub Pages, Fumadocs neutral preset, Serwist service worker built by `serwist build` after `next build`. `apps/docs` declares `zod` only so Bun resolves one `fumadocs-core` variant (Serwist pins an older zod); do not remove it as unused.
- **Changesets** — Versioning and CHANGELOGs, released by `release.yml`

## Plugin Configuration

`apps/design-plugin/figma.manifest.ts` exports the Figma plugin manifest (`documentAccess: "dynamic-page"` and `networkAccess` are required fields; keep them). Update `id` with your plugin's ID from Figma. This generates `dist/manifest.json` at build time. The window is opened in `apps/design-plugin/src/plugin/plugin.ts` at 320 × 480 with `themeColors: true`; keep that flag or the UI loses Figma's theme.

## Available Skills

- `build-figma-plugin` (`.claude/skills/build-figma-plugin/`) — Build a complete Figma plugin from a plain English description; its `references/` cover the architecture, the UI components and the Figma API patterns this template uses. No third-party skills are vendored into the repository.
