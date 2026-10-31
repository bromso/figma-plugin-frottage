# Bun Build and Test Migration — Design

**Date:** 2026-10-29
**Status:** Approved, awaiting implementation plan
**Stream:** 1 of 3 (followed by dependency updates and docs/config drift, then structural cleanup)

## Goal

Replace Vite and Vitest in the plugin app and the two shared packages with Bun's
native bundler and test runner. The plugin build becomes one short script, the test
setup becomes a preload file, and twelve build-time dev dependencies become two.

## Background

The repo already uses Bun as package manager and script runner. Bun 1.4 (verified
locally on 1.4.2) now covers every bundler feature the template depends on:

| Current Vite piece | Bun equivalent |
|---|---|
| vite-plugin-singlefile | `Bun.build({ compile: true, target: "browser" })` with an HTML entrypoint inlines all JS, CSS and relative assets into one HTML file |
| @tailwindcss/vite | `bun-plugin-tailwind` |
| @rolldown/plugin-babel + babel-plugin-react-compiler | `reactCompiler: true` (experimental) |
| vite-plugin-generate-file | `Bun.write` of the manifest object |
| `vite build --watch` | `fs.watch` loop around the same build function |
| rollup-plugin-visualizer | `metafile` option (JSON + markdown size reports) |
| Vitest + happy-dom | `bun test` with `@happy-dom/global-registrator`, Testing Library and jest-dom via preload |

Two pieces are already dead weight and go regardless: `vite-plugin-react-rich-svg`
(no `?component`, `?raw` or `?url` import exists in the repo) and `postcss-url` plus
its path-encoding workaround (styles.css has no `url()` or `@font-face`; the bundled
`Alkatra.ttf` is unused).

## Scope

### In scope

- `apps/design-plugin`: delete both Vite configs, `postcss-url.d.ts`, and
  `tsconfig.node.json`. Add `build.ts`. Update scripts, dependencies, tsconfig.
- `packages/ui` and `packages/common`: delete `vitest.config.ts`. Add `bunfig.toml`,
  a test preload, and a `global.d.ts` with the `bun:test` triple-slash directive.
  Change explicit `from "vitest"` imports to `from "bun:test"`. Test bodies unchanged.
- `figma.manifest.ts`: add `documentAccess: "dynamic-page"` (required by Figma for
  all new plugins) and `networkAccess: { allowedDomains: ["none"] }`.
- Remove `packages/ui/src/assets/fonts/Alkatra.ttf`, `react.svg`, `vite.svg` and
  the empty `scripts/` tree (three `.gitkeep` files).
- Bun minimum becomes 1.4.2: `packageManager`, `engines.bun`, and the `bun-version`
  pin in `ci.yml`, `docs.yml`, `release.yml`.
- CI test step runs `bun run test` (all packages) instead of `@repo/ui` only.
- Update only the build-system descriptions in `README.md`, `.claude/CLAUDE.md`,
  `CONTRIBUTING.md`, `apps/docs/content/docs/guides/architecture.mdx`,
  `.agents/skills/build-figma-plugin/references/architecture.md`, and the
  `.vscode/launch.json` Vitest debug entry. General drift (stale paths, component
  counts, missing `storybook` script) stays in stream 2.

### Out of scope

- `apps/storybook` stays on Vite 8 and `@storybook/react-vite`. Vite remains a dev
  dependency there only.
- `apps/docs` (Next.js / Fumadocs) is untouched.
- Dependency major bumps (TypeScript 7, Changesets 3, Next 16, etc.) are stream 2.
- Pruning `sidebar`, `use-mobile`, `next-themes` is stream 3.

## Architecture

### Build script: `apps/design-plugin/build.ts`

One file, run with `bun build.ts [--watch] [--analyze]`. `NODE_ENV=production`
(set by the `build` script) selects minified output without sourcemaps; otherwise
output is unminified with inline sourcemaps.

```
build()
  ├─ buildUi()      Bun.build({
  │                   entrypoints: ["../../packages/ui/src/index.html"],
  │                   compile: true, target: "browser",
  │                   outdir: "dist", naming: "[name].[ext]",
  │                   reactCompiler: true,
  │                   plugins: [tailwind],
  │                   minify: isProd, sourcemap: isProd ? "none" : "inline",
  │                   metafile: analyze ? "dist/meta-ui.json" : undefined,
  │                 })                              → dist/index.html
  ├─ buildPlugin()  Bun.build({
  │                   entrypoints: ["src/plugin/plugin.ts"],
  │                   format: "iife", target: "browser",
  │                   outdir: "dist", naming: "plugin.[ext]",
  │                   minify: isProd, sourcemap: isProd ? "none" : "inline",
  │                 })                              → dist/plugin.js
  └─ writeManifest() Bun.write("dist/manifest.json", JSON.stringify(manifest, null, 2))
```

`--watch` wraps `build()` in a debounced `fs.watch({ recursive: true })` over
`packages/ui/src`, `packages/common/src`, `apps/design-plugin/src` and
`figma.manifest.ts`. A failed rebuild logs the error and keeps watching.

The `@` alias (→ `packages/ui/src`) and `@plugin` alias (→ `src/plugin`) move to
`paths` in the respective tsconfigs; Bun's bundler reads tsconfig `paths`.

Bun has no syntax-downleveling target. The current `es2017` plugin target is
dropped; the spike confirms Figma's sandbox runs Bun's output.

### Scripts (`apps/design-plugin/package.json`)

| Script | Command |
|---|---|
| `build` | `NODE_ENV=production bun build.ts` |
| `dev` | `bun build.ts --watch` |
| `dev:ui-only` | `bun ../../packages/ui/src/index.html` (Bun dev server with HMR; Tailwind via `[serve.static] plugins` in `bunfig.toml`) |
| `analyze` | `NODE_ENV=production bun build.ts --analyze` |
| `types` | `tsc --noEmit` |
| `lint` | `biome check .` |

### Dependencies after migration

`apps/design-plugin` devDependencies: `@figma/plugin-typings`, `@types/bun`,
`bun-plugin-tailwind`, `tailwindcss`, `typescript`.

Removed from the repo: `vite` (except apps/storybook), `@vitejs/plugin-react`
(except apps/storybook), `@rolldown/plugin-babel`, `babel-plugin-react-compiler`,
`vite-plugin-singlefile`, `vite-plugin-generate-file`, `vite-plugin-react-rich-svg`,
`postcss-url`, `rollup-plugin-visualizer`, `@tailwindcss/vite` (except
apps/storybook), `vitest`, `happy-dom` (replaced by `@happy-dom/global-registrator`),
`@types/node` in the three migrated workspaces (replaced by `@types/bun`).

### Tests

`packages/ui/bunfig.toml`:

```toml
[test]
preload = ["./src/test/setup.ts"]
```

`packages/ui/src/test/setup.ts` follows Bun's documented ordering: register
happy-dom globals first, then dynamically import jest-dom matchers and Testing
Library `cleanup`, because static imports evaluate before `register()` runs.

```ts
/// <reference types="bun:test" />  (lives in global.d.ts)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const { afterEach, expect } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");
expect.extend(matchers);
afterEach(cleanup);
```

`packages/common` gets a `bunfig.toml` with no preload (node environment).
`describe`, `test`, `it`, `expect`, hooks and the `vi` alias are injected globals,
so the 21 `vi.*` call sites across 13 files keep working. Package scripts become
`"test": "bun test"` and `"test:watch": "bun test --watch"`.

### Turborepo and CI

Task names (`build`, `dev`, `test`, `test:watch`, `types`, `lint`, `analyze`) are
unchanged, so `turbo.json`, root scripts and `.vscode/tasks.json` keep working.
`ci.yml` changes: `bun-version: "1.4.2"` (the version the spike is verified on; bumped only if the spike needs a newer one) and the
test step becomes `bun run test`.

## Spike

First task, in a worktree. Pass criteria:

1. `bun build.ts` emits `dist/index.html` with zero external references; Figma
   loads it, the demo UI renders, dark mode (`html.figma-dark`) applies.
2. `dist/plugin.js` runs in the sandbox; `createRect` and `exportSelection`
   behave as today.
3. `reactCompiler: true` produces a UI that behaves identically. If it fails, the
   flag is set to `false` and the limitation is documented in the build script.
4. All 37 test files pass under `bun test` with at most import-line changes.

If criterion 1 or 2 cannot be made to pass within the spike task itself (no fixes to Bun or Figma, only to our build script and config), the stream stops with nothing
landed on master and stream 2 proceeds on the Vite setup instead.

### Known risks

- React Compiler support in Bun is marked experimental.
- `bun-plugin-tailwind` behaviour under `compile: true` is undocumented.
- `@source "."` in `styles.css` currently relies on the Vite root being
  `packages/ui/src`; Tailwind content detection may need an explicit path.
- Figma sandbox compatibility with un-downleveled modern syntax.

## Acceptance

- Spike criteria 1–4 hold on the final branch.
- `bun run build`, `bun run test`, `bun run lint`, `bun run types` pass locally.
- CI green, including Storybook build and docs workflow.
- Plugin installs from `apps/design-plugin/dist/manifest.json` in Figma desktop.
- No file in the repo imports `vite` or `vitest` outside `apps/storybook`.
- A changeset exists describing the migration (`minor`).
