# Tooling and small fixes (stream 3, bundle 2)

Date: 2026-10-31. Branch `chore/tooling-fixes`, one pull request, tracked in GitHub project 30.

## Intent

Stream 3 of the template refresh is structural cleanup. Bundle 1 (PR #27) pruned the UI package. This bundle collects four small defects that reviews of the earlier streams recorded as follow-ups but that did not belong in those pull requests. Each is independent and small; they ship together because none justifies a pull request of its own and together they close the "tooling" list so bundles 3 (docs archive) and 4 (official Figma MCP) can proceed.

## Goals

1. Storybook is type-checked by `bun run types` locally and in CI, like every other workspace.
2. The root `package.json` no longer carries a version that nothing bumps or reads.
3. The docs web-app manifest derives its paths from the same base-path switch as the rest of the docs app.
4. The Calendar's week-number cell stops leaking a non-DOM prop onto a table cell.
5. The Calendar right-to-left chevron question is settled, with the finding recorded.

## Non-goals

- No dependency upgrades beyond the dev-dependencies Storybook needs to type-check.
- No changes to how Storybook builds, is deployed, or looks.
- No story content rewrites beyond what the type-check requires.
- No archiving of `docs/plans/` (bundle 3) and no MCP changes (bundle 4).
- No renaming of the many story imports from `@storybook/react`; they type-check as they are.

## Anti-goals

- Making `bun run types` slower or flakier for the other workspaces. Storybook's check must be its own Turborepo task that fails only on Storybook's own files.
- Loosening the Storybook check to get it green (no `skipLibCheck`-style escape beyond what the other workspaces already use, no `// @ts-expect-error` on stories, no `any` in story files).
- Breaking the GitHub Pages deployment of the docs app. The manifest must produce the same URLs as today when `GITHUB_PAGES=true`.

## Constraints

- Bun 1.4.2, Turborepo, Biome 2.6.4, TypeScript 7.0.2 (native compiler). Storybook 10.6.5 on Vite 8 (the only Vite workspace).
- Conventional commits on a `chore/` branch; one patch changeset for `@repo/ui` because the Calendar change is user-facing. Root, Storybook and docs are in the changesets `ignore` list and need no changeset.
- The branch is cut from master at `94f28ad` (PR #27, the UI pruning, merged; PR #26 merged). The open version PR #28 carries the pending `@repo/ui` 2.0.0 major; this bundle's patch changeset stacks on it.
- Specs and plans live in `docs/superpowers/`; the plan records review outcomes per task, as the earlier bundles did.

## Current state (verified 2026-10-31)

- `apps/storybook/package.json` has no `types` script and no `typescript`, `@types/react` or `@types/react-dom` dev-dependencies. Its `tsconfig.json` maps only `@repo/ui` to `../../packages/ui/src`. Running TypeScript 7 against it today reports 146 errors: 62 unresolved modules (`@repo/ui/lib/utils`, `@repo/ui/components/ui/*`, `@/lib/utils`, `@/components/ui/button` reached through the `@repo/ui` source, plus the bare `storybook` import in `.storybook/preview.ts`), 55 missing React type declarations (`react`, `react/jsx-runtime`), one side-effect CSS import without a module declaration, and about 25 story-level typing errors, most of which are consequences of the unresolved Button module (`Pick<any, "size" | "variant">`). Two are real: `Chart.stories.tsx` and `InputOTP.stories.tsx` declare `Meta<typeof Component>` for components with required props and then write render-only stories without `args`.
- The `storybook` package exposes no root export in 10.6.5; `Preview` and the other CSF types come from `@storybook/react`, which `@storybook/react-vite` re-exports in full. Stories already import `Meta` and `StoryObj` from `@storybook/react` (61 files).
- Root `package.json` has `"version": "1.3.0"`. Nothing reads it: not the workflows, not the docs app, not the plugin build. Changesets ignores the root (it is not a workspace package). `apps/docs/content/docs/project/versioning.mdx` ends its "Current version" section with "The root `package.json` version is not bumped by Changesets." The April plans under `docs/plans/` mention 1.3.0 but are archived by bundle 3.
- `apps/docs/src/app/manifest.ts` hard-codes `/figma-plugin-template` in `start_url` and both icon `src` values. `apps/docs/src/app/layout.tsx` and `apps/docs/src/lib/layout.shared.tsx` each define their own `const BASE = process.env.GITHUB_PAGES === "true" ? "/figma-plugin-template" : ""`. `next.config.mjs` sets `basePath` from the same environment variable.
- `packages/ui/src/components/ui/calendar.tsx` overrides `WeekNumber` as `({ children, ...props }) => <td {...props}>…</td>`. react-day-picker 10 passes `{ week: CalendarWeek } & ThHTMLAttributes<HTMLTableCellElement>`, and its own implementation strips `week` before spreading. Ours spreads `week`, an object, onto the `<td>`, so every week-number cell renders with a junk `week="[object Object]"` attribute whenever `showWeekNumber` is set. React 19 does not warn: an all-lowercase unknown attribute with an object value passes its validation silently (verified against react-dom 19.3.1 in happy-dom). `calendar.test.tsx` has two tests and none covers week numbers.
- The right-to-left chevron concern: `calendar.tsx` adds `rtl:**:[.rdp-button\_next>svg]:rotate-180` and the `_previous` twin. react-day-picker 10's `Nav` always passes `orientation="left"` to the previous button and `"right"` to the next, regardless of direction; the flip for RTL lives in the package stylesheet (`.rdp-root[dir="rtl"] .rdp-nav .rdp-chevron { transform: rotate(180deg) }`). The UI package does not import that stylesheet, and the custom `Chevron` renders Lucide icons without the `rdp-chevron` class. So the Tailwind rule is the only flip and there is no double flip. **Finding: no change needed.**

## Decisions

### 1. Storybook type-check

- Add `"types": "tsc --noEmit"` to `apps/storybook/package.json`. Turborepo's existing `types` task picks it up; CI already runs `bun run types`.
- Dev-dependencies added to `apps/storybook`: `typescript` (same range as `packages/ui`, `^7.0.2`), `@types/react` and `@types/react-dom` (same ranges as `packages/ui`, `^19.3.0`), and `@types/node` (same range as `apps/docs`, `^26.0.0`) because `.storybook/main.ts` imports `node:path` and `node:url` and Bun's isolated linker does not hoist the docs app's copy.
- `apps/storybook/tsconfig.json` `paths` become: `@repo/ui` → `../../packages/ui/src`, `@repo/ui/*` → `../../packages/ui/src/*`, `@/*` → `../../packages/ui/src/*`. The `@/*` alias exists because the UI package's own sources use it and the Storybook check compiles them through the path mapping; Vite already has the matching alias in `main.ts`.
- The side-effect import of `@repo/ui/styles.css` is declared through `"types": ["vite/client", "node"]` in the Storybook tsconfig, since Storybook is a Vite app and `vite` is already a dev-dependency. Listing `types` switches off automatic `@types/*` inclusion, which is why `node` is named alongside. The other workspaces do not need this because they do not import CSS from TypeScript that `tsc` sees.
- `.storybook/preview.ts` imports `Preview` from `@storybook/react`, matching the stories. (`@storybook/react-vite` would also work; `@storybook/react` is my call for consistency with the 61 story files.) The decorator's `Story` and `context` parameters are typed by `Preview` once the import resolves.
- Story typing errors that remain after the modules resolve are fixed in the stories themselves, keeping the stories' behaviour. For `Chart.stories.tsx` and `InputOTP.stories.tsx` the expected fix is to type the meta so render-only stories are valid (for example `Meta` without the component generic for the render-only variants, or supplying the required `args`); the builder picks the shape that keeps the Docs tab's controls working. No `any`, no `@ts-expect-error`.
- Documentation: `.claude/CLAUDE.md` line 62 ("Type-check the plugin, `ui`, `common` and the docs app") adds Storybook. README and CONTRIBUTING say "Type-check all packages", which becomes true and needs no edit. `apps/docs/content/docs/project/contributing.mdx` and `ai/using-claude.mdx` only list the command and need no edit.

### 2. Root version

- Delete the `"version"` field from the root `package.json`. The root is `private`, is not a workspace package, and is read by nothing.
- `versioning.mdx` "Current version" section: replace "The root `package.json` version is not bumped by Changesets." with a sentence saying the root `package.json` has no version field because the template's version is the `@repo/ui` / `@repo/common` version. The sentence before it already says that.
- Verify `bun install` (lockfile unchanged or trivially updated) and `bun changeset status` still run.

### 3. Docs manifest base path

- Create `apps/docs/src/lib/base.ts` exporting `BASE` with the existing expression. `layout.tsx`, `layout.shared.tsx` and `manifest.ts` import it; the two local definitions go away.
- `manifest.ts` builds `start_url` as `${BASE}/docs` and the icon paths as `${BASE}/android-chrome-192x192.png` and `${BASE}/android-chrome-512x512.png`. With `GITHUB_PAGES=true` the output is byte-identical to today; without it the paths are root-relative, which is what the local dev server serves.
- Verification: build the docs app with `GITHUB_PAGES=true` and diff `out/manifest.webmanifest` against the current one (same content); build without it and check the manifest has `/docs` and `/android-chrome-…` paths.

### 4. Calendar `WeekNumber`

- Test first: render `<Calendar month={new Date(2025, 0, 1)} showWeekNumber />`, assert the week-number cells (`.rdp-week_number`) render, and assert none of them has a `week` attribute. The test must fail on today's code, where each cell carries `week="[object Object]"`.
- Fix: destructure `week` out of the props before spreading (`({ children, week: _week, ...props })`); Biome ignores underscore-prefixed unused bindings. Keep the `<td>` element and the inner `div`, as upstream shadcn does.
- Remember the test gotchas recorded for this package: a test file's own `afterEach` runs before the preload's `cleanup()`, so call `cleanup()` first if the file adds one; run `bun test` from `packages/ui`, not the repo root, or the preloads are skipped.
- Changeset: patch, `@repo/ui`, "Calendar: the week-number cell no longer spreads the `week` object onto the `<td>`, which rendered a stray `week="[object Object]"` attribute when `showWeekNumber` was set."

### 5. Calendar RTL chevrons

- No code change. The plan's outcomes section records the finding above (single flip via the Tailwind `rtl:` rule; the package stylesheet that would double it is not imported). If a later change imports react-day-picker's stylesheet, the Tailwind rule must go.
- No test is added: a test could only assert the presence of a class name, which pins the mechanism rather than the behaviour. My call.

## Left to the builder

- Any further Storybook dev-dependency the check turns out to need beyond the four named.
- The precise story-typing fixes for the roughly 25 remaining errors once modules resolve; they must preserve what each story renders and keep the Docs tab controls.
- Whether the Storybook `tsconfig.json` needs `"include"` widened (it already covers `src/**` and `.storybook/**/*.ts`).
- Whether `bun install` changes `bun.lock` for the root version removal; commit whatever it produces.
- Commit granularity, within conventional commits (expected: one commit per numbered decision, plus the changeset and the plan outcomes).

## Verification before the pull request

From the repo root: `bun install`, `bun run types` (now including Storybook), `bun run lint`, `bun run test`, `bun run build`, `bun run build-storybook`. From `apps/docs`: `GITHUB_PAGES=true bun run build` and a diff of the manifest. CI must be green on the pull request.
