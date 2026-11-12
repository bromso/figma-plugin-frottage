# Frottage

[![CI](https://github.com/bromso/figma-plugin-frottage/actions/workflows/ci.yml/badge.svg)](https://github.com/bromso/figma-plugin-frottage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/bromso/figma-plugin-frottage)](LICENSE)
![Bun](https://img.shields.io/badge/bun-1.4-f9f1e1?logo=bun)
![TypeScript](https://img.shields.io/badge/typescript-7-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=black)
![Turborepo](https://img.shields.io/badge/turborepo-2-ef4444?logo=turborepo&logoColor=white)
![Biome](https://img.shields.io/badge/biome-2-60a5fa?logo=biome&logoColor=white)
![Storybook](https://img.shields.io/badge/storybook-10-ff4785?logo=storybook&logoColor=white)
![Figma](https://img.shields.io/badge/figma-plugin-a259ff?logo=figma&logoColor=white)

Frottage imports rendered web pages into editable Figma designs. A Chrome extension captures the page; the Figma plugin turns the capture into native layers. Built with React, Bun, TypeScript and a Turborepo monorepo.

Capture a page with the Chrome extension: tick the sizes you want (TV, Desktop, Laptop, tablet, phone or watch), press Capture once, and get one `.frottage` file with every size. Then open that file in the plugin. Sizes change the layout width only, not the browser's identity. Passwords, typed text and URL queries stay out of the file, and the plugin makes no network requests.

## Features

- **Page capture** — layout, text, images, inline SVG, pseudo-elements, video posters and open or closed shadow DOM, with anything left out listed in the import report
- **Native Figma layers** — auto layout with a per-frame fallback, real vectors, hyperlinks and readable layer names
- **Components and hover variants** — repeated custom elements become components with instances, and their `:hover` rules become a Hover variant
- **Components from the page's code** — Frottage reads component names and props from React and Vue code, and from shadcn's `data-slot` markers. A component that occurs at least twice on one device frame becomes a Figma component set, with variant properties for the props that change its look, one variant for each combination seen, a `Label` text property and `Show icon` or `Icon` properties where occurrences differ. One set is shared by all the page's device frames, and "What's in this file" lists them, such as `Components: Button (4 variants), Card`. Only variants the page showed are made; a combination it never rendered is not invented. Frottage keeps only booleans, numbers up to 10000 and short token-like words as props. Children, class names, styles, ids, links, props that can hold someone's words (such as `label`, `text`, `email` or any `…name`), handlers, `aria-*` and `data-*` attributes never enter the file, and the plugin refuses a file that carries them. Svelte compiles components away and Angular exposes only custom-element tag names in production, so those pages keep the repeated-custom-element components above. Minified names are used only when a shadcn marker renames them. A re-import onto the same page (Current page) adds missing variants only to sets Frottage made, never to your own sets
- **Paint and transforms** — gradients, filters, rotation and z-index order come through as native fills, effects and layers
- **Image access** — images a site blocks from the page can be fetched by the extension, after you allow it with one click
- **Styles and variables** — repeated values become text styles and color variables, and lengths held by custom properties named for spacing, such as `--space-4` or `--gutter`, become spacing variables, all reused on later imports
- **Tokens and themes** — a single-page import creates up to six variable collections (empty raw ones are left out): `Palette`, `Spacing`, `Border radius` and `Typography` with one mode each, `Color Mode` with the themes you tick, Light, Dark or both (Dark is read from the page's stylesheet, with no second capture; the popup disables it when the page has no dark theme, and the plugin's Themes choice in "What's in this file" is pre-ticked from the capture), and a final `Theme` with one `Default` mode. Color Mode holds variables such as `color/background` and `color/primary`, and every one of its colors points into Palette. Layers and text styles bind to Theme, so switching the page frame's Color Mode recolors it. Collections from an earlier Frottage version are left as they are. Where the CSS names none, a variable with exactly the same value is used if only one has it (your own colors are reused only from single-mode collections); otherwise the value stays as it is and is counted in the report. Without named tokens, a few clearly evidenced roles are inferred and labeled "Inferred"; the report lists modes, inferred roles, near twins and unbound values
- **Devices and breakpoints** — Capture records each device by name. The popup lists the page's CSS breakpoints as rows under the devices, each with its name, width and a checkbox (ticked by default), or the name of a ticked device that covers it. Breakpoints within 2 px of each other count as one. Each ticked breakpoint no device covers adds a capture. The plugin lists what is in the file in Devices, Breakpoints, Themes and Languages groups. It adds `Device` and `Breakpoint` collections beside the layered ones, with one mode per device or CSS range. Each device becomes one frame, side by side in a Section. Each frame is set to its modes. The Section is set to the captured Color Mode. A page with no recorded breakpoints uses each device width as a breakpoint
- **Versions of a page** — capture several sizes in one file and they import as devices with breakpoints, one frame per device side by side, as described under Devices and breakpoints. Files group by page URL, so files of one page at different URLs import as separate pages. Files captured with an older build that labeled versions as themes or languages still import the older way, each version on its own mode of one collection
- **Languages** — the popup finds a page's languages from `hreflang` alternates, URL patterns like `/en/…` and `/sv/…`, or switcher links (the reader that finds the most wins), adds the page's own from `<html lang>` when the page lists only its other languages, keeps one entry per language, names each simply (`Svenska`, `English`), and shows a `Languages` group when it finds two or more (up to 8; the page's own is ticked and stays). Each ticked language is captured at every ticked device, and the Capture button counts them all, such as `8 captures: 3 devices × 2 languages, plus 2 for breakpoints`; breakpoint extras use the page's own language only. Languages on the same site load in the run's own small window; one on another site asks for access to that site when you press Capture, and is left out if you refuse. In the plugin, texts are paired by their place in the page (links also by target). Paired texts always bind to a `Language` variable collection with one mode per language, so switching the Section's Language mode swaps the text; there are no separate language frames. Texts with mixed styling or no match stay in the page's own language. The report counts texts that didn't pair and, per device under 80% paired, says so (`Only 35% of the Svenska page matches English on Laptop.`)
- **Import options** — remembered per site, with a replacement picked for each missing font
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
# Clone the repository
git clone https://github.com/bromso/figma-plugin-frottage.git
cd figma-plugin-frottage

# Install dependencies
bun install

# Start development
bun run dev
```

## Project Structure

```
apps/
  design-plugin/  — Figma plugin app (build.ts bundles to dist/)
  chrome-extension/ — Chrome extension that captures a page into a .frottage file
  storybook/      — Storybook component documentation
  docs/           — Documentation site (Next.js + Fumadocs, port 3000)
packages/
  common/         — Shared types and network events (@repo/common)
  ui/             — UI components, styles, and app shell (@repo/ui)
  capture-schema/ — Capture schema, validation and the .frottage container
  capture-dom/    — DOM walker that produces a capture in the page
  figma-mapper/   — Maps a capture to Figma layer plans
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
- **UI side** (`packages/ui/src/`) — Runs in an iframe. React app with shadcn/ui components. Entry: `main.tsx` → `app.tsx`; `app.tsx` is the import screen.
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
  name: "Frottage",
  id: "frottage-dev",
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
