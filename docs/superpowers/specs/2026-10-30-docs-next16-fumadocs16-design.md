# Docs app: Next 16, Fumadocs 16, Tailwind 4, Serwist

**Date:** 2026-10-30
**Status:** Approved (brainstorm with Jonas, 2026-10-30)
**Stream:** first major upgrade after the dependency refresh (PR #21). The other majors (TypeScript 7, react-day-picker 10, lint-staged 17, @types/node 26, @testing-library/jest-dom 7) are separate specs.

## Problem

`apps/docs` is the only workspace still on a previous major line of everything it uses: Next 15.5, Fumadocs 14.7 with fumadocs-mdx 11, Tailwind CSS 3.4 with the Fumadocs Tailwind plugin, and the PWA plugin `@ducanh2912/next-pwa` 10.2.9. Three facts make the upgrade more than a version bump:

- Fumadocs 16 supports Tailwind CSS 4 only; `fumadocs-ui/style.css` and `fumadocs-ui/tailwind-plugin` are gone, replaced by CSS presets.
- Next 16 builds with Turbopack by default and fails `next build` when a webpack plugin is configured unless `--webpack` is passed. `@ducanh2912/next-pwa` is webpack-only and has had no release since September 2024.
- The repository's Node floor is now `>=22.12`, but `docs.yml` never pins Node, so `next build` runs on whatever the runner ships.

## Decisions

| Question | Decision |
| --- | --- |
| Method | One branch, three verified groups, one commit each, in the order Next 16, then Fumadocs 16 + Tailwind 4, then the Serwist swap. Each group ends with a green docs build in both modes. |
| Service worker | Replace `@ducanh2912/next-pwa` with Serwist 9.5 in configurator mode (bundler-agnostic, works with Turbopack and the static export). Keep the web manifest. |
| Tailwind preset | Fumadocs `neutral` colour preset, which matches the default the `createPreset()` plugin used. |
| Development | The service worker is disabled in `next dev` (`disable` on `SerwistProvider`); no `concurrently`. |
| Type-check | `apps/docs` gains a `types` script (`next typegen && tsc --noEmit`) and joins `bun run types`, closing the "CI never type-checks docs" drift item. |
| Node in CI | `docs.yml` adds `actions/setup-node@v4` with Node 24 before setup-bun, like `release.yml`. |
| Changeset | None. `@repo/docs` is ignored by Changesets. |

## Current shape of the app (verified 2026-10-30)

- 16 MDX pages under `content/docs`, one `meta.json`. The only JSX in content sits inside code fences; the pages use only the default `fumadocs-ui/mdx` components.
- `src/app/layout.tsx` wraps `RootProvider` (static search) and injects WebSite JSON-LD; `src/app/docs/[[...slug]]/page.tsx` uses `DocsPage`, `DocsBody`, `DocsTitle`, `editOnGithub`, breadcrumb and footer, TechArticle JSON-LD and `generateStaticParams`; `src/app/api/search/route.ts` uses `createFromSource(source).staticGET`; `src/lib/source.ts` uses `loader` with `docs.toFumadocsSource()` from `.source`; `manifest.ts`, `robots.ts` and `sitemap.ts` are `force-static`.
- `next.config.mjs` wraps `withPWA(withMDX(config))`, with `output: "export"` and `basePath: "/figma-plugin-template"` when `GITHUB_PAGES=true`.
- `tailwind.config.ts` uses `createPreset()` from `fumadocs-ui/tailwind-plugin`; `postcss.config.mjs` runs `tailwindcss` and `autoprefixer`; `global.css` imports `fumadocs-ui/style.css` and the three Tailwind 3 directives.
- The generated `public/sw.js`, `public/workbox-*.js` and `public/swe-worker-*.js` are excluded in `biome.json` and `.gitignore`.
- `docs.yml` builds with `GITHUB_PAGES=true`, copies the Storybook build into `out/storybook` and deploys `out/` to GitHub Pages.

## Groups (in order)

After each group: `bun run lint`, `bun run types`, `bun run docs:build`, `GITHUB_PAGES=true bun run docs:build`, and `out/` served locally (`bunx serve apps/docs/out` or equivalent) to check the home redirect, a docs page, search, dark mode toggle, `sitemap.xml` and `manifest.webmanifest`.

1. **Next 16.** `next` to the current 16.x (16.4.3 at the time of writing); `@types/node` stays on 25. No codemod: the app has four route files and already uses the async `params` API, so the Next 16 upgrade guide is applied by hand and `next typegen` is run to confirm the route types. `dev` drops `--turbopack` (default now); `build` temporarily becomes `next build --webpack` so the old PWA plugin keeps building. Nothing in `next.config.mjs` otherwise changes; `images.unoptimized`, `output: "export"` and `basePath` stay.
2. **Fumadocs 16 and Tailwind 4.** `fumadocs-core` and `fumadocs-ui` to the current 16.x (16.17.9), `fumadocs-mdx` to the current 15.x (15.4.10), `tailwindcss` to the current 4.x (4.3.3) plus `@tailwindcss/postcss`; remove `autoprefixer` and delete `tailwind.config.ts`. `postcss.config.mjs` lists only `@tailwindcss/postcss`. `global.css` becomes:
   ```css
   @import "tailwindcss";
   @import "fumadocs-ui/css/neutral.css";
   @import "fumadocs-ui/css/preset.css";
   ```
   `RootProvider` imports from `fumadocs-ui/provider/next`; `DocsPage`, `DocsBody`, `DocsTitle` import from `fumadocs-ui/layouts/docs/page`; `DocsLayout` from `fumadocs-ui/layouts/docs` and `BaseLayoutProps` from `fumadocs-ui/layouts/shared` are checked against the installed types and adjusted if renamed. `source.config.ts`, `source.ts`, the search route and `mdx.tsx` keep their APIs; the plan verifies each against the installed 16.x types and records any rename. If `.source` must exist before `tsc` or `biome` run, add `"postinstall": "fumadocs-mdx"` to `apps/docs/package.json` and confirm Bun runs it for workspace packages; otherwise the `types` script runs `fumadocs-mdx` first.
3. **Serwist replaces next-pwa.** Remove `@ducanh2912/next-pwa`, the `--webpack` flag, the `withPWA` wrapper, and the `sw.js`, `sw.js.map`, `workbox-*.js` and `swe-worker-*.js` entries in `biome.json` and `.gitignore`; delete the stale generated files from `public/`. Add `@serwist/next`, `@serwist/cli` and `serwist` (9.5.13) as devDependencies. Create `serwist.config.js` using `serwist()` from `@serwist/next/config` with `swSrc: "src/app/sw.ts"` and `swDest` pointing into the exported `out/` directory so the prerendered HTML is precached and the file ships with the static export; the exact option names (`swDest`, `globDirectory`, basePath handling, passing `nextConfig`) are confirmed against the package's TypeScript definitions while planning. Create `src/app/sw.ts` from the Serwist template (`defaultCache`, `skipWaiting`, `clientsClaim`, `navigationPreload`, a document fallback to `/~offline`) and a minimal `src/app/~offline/page.tsx`. Wrap the body in `SerwistProvider` from `@serwist/next/react` with `swUrl` set to `${BASE}/sw.js` (the existing `BASE` constant) and `disable={process.env.NODE_ENV === "development"}`. `tsconfig.json` adds `"webworker"` to `lib`, `@serwist/next/typings` to `types`, and excludes `public/sw.js` and `out`. The `build` script becomes `next build && serwist build`. `.gitignore` gains `apps/docs/public/sw*`.
4. **CI, type-check and docs text.** `docs.yml` adds `actions/setup-node@v4` with `node-version: 24` before `oven-sh/setup-bun@v2`. `apps/docs/package.json` gains `"types": "next typegen && tsc --noEmit"`; the root `types` script is `turbo run types`, which picks up every workspace that defines the script, so no root change is needed and `bun run types` goes from three to four tasks. Documentation that names the old stack changes: the `.claude/CLAUDE.md` Tooling line "(the docs site uses its own Tailwind 3 setup)", any docs page or README sentence mentioning Next 15, Fumadocs 14, Tailwind 3 for docs, or `next-pwa`; the Renovate rule set needs no change (Serwist packages are regular npm dependencies grouped with the rest). The stream-3 list loses the "CI never type-checks docs" item.

## Facts the groups rely on (verified 2026-10-30)

- Next 16: Turbopack is the default for `next dev` and `next build`; `next build` fails when a webpack configuration is present unless `--webpack` is passed; Node 20.9+ and TypeScript 5.1+ required; `turbopack` is a top-level `nextConfig` key.
- Fumadocs UI 16.17.9 peers: `next 16.x.x`, `react ^19.2.0`, `fumadocs-core 16.17.9`. Fumadocs MDX 15.4.10 peers: `next ^15.3.0 || ^16.0.0`, `fumadocs-core ^16.17.8`. Only Tailwind CSS 4 is supported; the CSS presets live at `fumadocs-ui/css/<preset>.css` and `fumadocs-ui/css/preset.css`, and the preset includes the `@source` for Fumadocs UI itself.
- Fumadocs 15.2+ ships `RootProvider` from `fumadocs-ui/provider/next` (framework adapter) and `fumadocs-ui/provider/base`; Fumadocs 16.2 recommends importing `DocsPage` from `fumadocs-ui/layouts/docs/page`. `createFromSource(source).staticGET` with `revalidate = false` remains the static search route; `source.generateParams()` remains the `generateStaticParams` source. The `fumadocs-mdx` CLI generates `.source` and can run as `postinstall`.
- Serwist 9.5.13 (`serwist`, `@serwist/next`, `@serwist/cli`; `@serwist/next` peers `next >=14`, `react >=18`, `typescript >=5`). Configurator mode (9.4+) runs `serwist build` after `next build`, so prerendered routes are precached, and does not depend on webpack, so it works with Turbopack. `SerwistProvider` from `@serwist/next/react` registers the worker at `swUrl` and takes `disable`; `@serwist/next/typings` types `window.serwist`; the generated worker is ignored with `public/sw*`.
- `@ducanh2912/next-pwa` 10.2.9 peers `next >=14` and `webpack >=5.9`; last release 2024-09-18.

## Verification

- The per-group commands above, plus a final clean reinstall (`rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile`) followed by `bun run lint`, `bun run types`, `bun run test`, `bun run --filter @repo/design-plugin build`, `GITHUB_PAGES=true bun run docs:build` and the Storybook build (the Pages workflow copies it into `out/storybook`).
- Serve `out/` and confirm in the browser: `/figma-plugin-template/` redirects to `/docs`, a docs page renders with the sidebar and table of contents, search returns results, the theme toggle works, `sw.js` registers (Application tab) and a reload with the network offline shows cached pages or the offline page.
- `bun outdated --filter @repo/docs` lists nothing but `@types/node` 26 and TypeScript 7.
- After merge, the Deploy Docs workflow succeeds on Node 24 and the live site at bromso.github.io/figma-plugin-template renders the same checks.

## Out of scope

- TypeScript 7, react-day-picker 10, lint-staged 17, @types/node 26, jest-dom 7 (each a later spec).
- Rewriting content, adding Fumadocs features (OpenAPI, i18n, new layouts), or changing the colour theme beyond the neutral preset.
- Moving the docs app off Next (the stream-3 "docs stack" question stays open; this upgrade keeps that option alive by shrinking the custom config).
