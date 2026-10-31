# figma-plugin-template

[![CI](https://github.com/bromso/figma-plugin-template/actions/workflows/ci.yml/badge.svg)](https://github.com/bromso/figma-plugin-template/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/bromso/figma-plugin-template)](LICENSE)
![Bun](https://img.shields.io/badge/bun-1.4-f9f1e1?logo=bun)
![TypeScript](https://img.shields.io/badge/typescript-7-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=black)
![Turborepo](https://img.shields.io/badge/turborepo-2-ef4444?logo=turborepo&logoColor=white)
![Biome](https://img.shields.io/badge/biome-2-60a5fa?logo=biome&logoColor=white)
![Storybook](https://img.shields.io/badge/storybook-10-ff4785?logo=storybook&logoColor=white)
![Figma](https://img.shields.io/badge/figma-plugin-a259ff?logo=figma&logoColor=white)

Figma/FigJam plugin boilerplate with React, Bun, TypeScript, and Turborepo monorepo.

## Features

- **Turborepo monorepo** with Bun package manager — fast installs, cached builds
- **React + TypeScript + Bun** build pipeline — one build script (`build.ts`) for the plugin; Vite is used only by Storybook
- **Single-file HTML output** — required by the Figma plugin API (all assets inlined)
- **49 UI components** — 45 from shadcn/ui plus Icon, IconButton, SectionTitle and Type, styled to Figma's UI3 design and themed live from Figma's color variables
- **Storybook 10** for interactive component documentation, including UI3 parity stories
- **bun test** for testing (happy-dom for UI, plain runtime for common packages)
- **Biome** for linting and formatting
- **Type-safe message passing** between plugin and UI via monorepo-networker

## Quick Start

```bash
# Clone the template
git clone https://github.com/bromso/figma-plugin-template.git
cd figma-plugin-template

# Install dependencies
bun install

# Start development
bun run dev
```

## Project Structure

```
apps/
  design-plugin/  — Figma plugin app (build.ts bundles to dist/)
  storybook/      — Storybook component documentation
  docs/           — Documentation site (Next.js + Fumadocs, port 3000)
packages/
  common/         — Shared types and network events (@repo/common)
  ui/             — UI components, styles, and app shell (@repo/ui)
```

Packages are **JIT source-only** — they export raw TypeScript with no build step. Use `@repo/*` workspace imports for cross-package references.

## Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Watch-mode plugin build plus the docs site dev server (Turborepo) |
| `bun run build` | Production build of the plugin (to `apps/design-plugin/dist/`) and the docs site |
| `bun run analyze` | Production build with bundle size reports |
| `bun run test` | Run all tests |
| `bun run test:watch` | Watch mode for tests |
| `bun run types` | Type-check all packages |
| `bun run lint` | Lint with Biome |
| `bun run docs` | Start the documentation site |
| `bun run storybook` | Start Storybook (port 6006) |
| `bun run build-storybook` | Build static Storybook (cached) |

## Architecture

The plugin runs as **two separate processes** that communicate via message passing:

- **Plugin side** (`apps/design-plugin/src/plugin/`) — Runs in Figma's sandbox with access to the Figma API (`figma.*`). No DOM access. Entry: `plugin.ts`.
- **UI side** (`packages/ui/src/`) — Runs in an iframe. React app with shadcn/ui components. Entry: `main.tsx` → `app.tsx`; `app.tsx` is the sampler laid out like a Figma properties panel.
- **Common** (`packages/common/src/`) — Shared between both sides. Contains network event type definitions.

### Messaging

Communication uses [monorepo-networker](https://github.com/CoconutGoodie/monorepo-networker):

1. **Define events** in `packages/common/src/networkSides.ts` — each side declares the events it listens to with typed signatures.
2. **Build channels** in `plugin.network.ts` and `app.network.tsx` — set up postMessage transport and register handlers.
3. **Use channels** — on the plugin side `PLUGIN_CHANNEL.emit(UI, "event", [args])` for fire-and-forget and `.request(...)` for request/response (returns a Promise); on the UI side the channel is `UI_CHANNEL` and the target is `PLUGIN`.

## UI Components

`packages/ui` provides 49 components: 45 from [shadcn/ui](https://ui.shadcn.com) (inputs, menus, dialogs, tabs, tables, charts, and more) and four custom Figma components (`Icon`, `IconButton`, `SectionTitle`, `Type`). Import everything from `@repo/ui`.

### Figma-native UI

The components follow Figma's UI3 design: 24 px controls, 11 px Inter, 5 px radius, dark menus and tooltips. Most colors bind to the `--figma-color-*` variables Figma injects when the window opens with `themeColors: true`, so the plugin follows the user's light or dark theme live; menus and tooltips use fixed dark values, and outside Figma the UI3 kit colors apply. Use the `figma-*` Tailwind utilities (for example `text-figma-text-secondary`, `border-figma-border`) instead of hard-coded colors. See the [theming guide](apps/docs/content/docs/guides/theming.mdx) and `packages/ui/src/figma-variables.md`.

Run `bun run storybook` to browse all components; the `UI3` section compares them with the kit in both themes.

## Plugin Configuration

Edit `apps/design-plugin/figma.manifest.ts` to set your plugin name, ID, and permissions:

```ts
export default {
  name: "My Plugin",
  id: "your-plugin-id-from-figma",
  documentAccess: "dynamic-page",
  networkAccess: { allowedDomains: ["none"] },
  // ...
};
```

Get your plugin ID from Figma: **Plugins > Manage plugins > Create new plugin**.

The window opens at 320 × 480 with `themeColors: true` (see `apps/design-plugin/src/plugin/plugin.ts`); keep that flag so the UI receives Figma's theme.

## Releases

Run `bun changeset` after user-facing changes. Merging to master runs the release workflow, which opens or updates a "chore: version packages" PR with the version bumps and CHANGELOG entries; merging that PR applies them. Merging it also creates a git tag per package (`@repo/ui@x.y.z`, `@repo/common@x.y.z`) and a GitHub Release with the changelog entry.

## Testing in Figma

1. Run `bun run build`
2. Open the Figma desktop app
3. Go to **Plugins > Development > Import plugin from manifest**
4. Select `apps/design-plugin/dist/manifest.json`

For active development, use `bun run dev` to keep the build updated automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and development workflow.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
