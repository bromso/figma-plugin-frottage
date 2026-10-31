# Documentation drift after the Bun and UI3 streams

**Date:** 2026-10-29
**Status:** Approved (brainstorm with Jonas, 2026-10-29)
**Stream:** 2 of the template refresh, first half. Dependency updates are the second half and get their own spec.

## Problem

PR #16 replaced Vite and Vitest with Bun, and PR #17 aligned `packages/ui` with Figma's UI3 design. The documentation did not follow. A drift audit on 2026-10-29 found wrong statements in nine files and several missing topics:

- `.claude/CLAUDE.md` still describes react-figma-ui, "14 components", figma-plugin-ds CSS and CSS Modules; lists skills that are not installed; names two MCP servers where three are configured; cites Biome 2.4.10 and Storybook 8.6.18 (installed: 2.4.12 and 10.3.5); uses the old package name `@repo/figma-plugin`.
- Every `bun run storybook` instruction (CLAUDE.md, README, CONTRIBUTING.md, two docs pages) points at a root script that does not exist.
- Component counts are "14+" or "27+ tests" where the truth is 46 shadcn components plus 4 custom ones and about 133 tests.
- The `build-figma-plugin` skill's UI cheat-sheet and app-shell pattern produce roomy, non-UI3 output (`p-4` shells, `text-muted-foreground`, no `figma-*` utilities), and its validation step skips `bun run test`.
- Nothing explains how theming binds to Figma, the `figma-*` utilities, the dark menus, the 24 px scale, the 320×480 default, the parity stories, or `packages/ui/src/figma-variables.md`.
- Editor config: the `.code-workspace` points Storybook at `packages/ui`, references a root folder name that does not exist, a Tailwind config path that does not exist and a dead GraphQL entry; `.vscode/launch.json` has a UI debug target for a dev server that no longer exists.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Fix every wrong statement, add the missing UI3 topics, realign the `build-figma-plugin` skill. Superseding the April 2026 UI3 plans and adding drift-prevention tooling are out of scope. |
| Single source of truth for theming | A new docs-site page, `apps/docs/content/docs/guides/theming.mdx`. CLAUDE.md, README, the skill references and `figma-variables.md` carry short summaries that link to it. |
| Third-party skills | Removed from the repository in PR #19 (`frontend-design`, `shadcn`, `skill-creator`, `template-skill`, `skills-lock.json`). `build-figma-plugin` is the only shipped skill and the UI authority. CLAUDE.md and the docs Skills page were updated in that PR; this PR only has to keep them consistent. |
| Delivery | One PR on `docs/stream-2-drift`, written truth-first: the theming page, then the summaries and links, then the light corrections. |
| Changeset | None. No package code changes. |

## The canonical page

`apps/docs/content/docs/guides/theming.mdx`, titled "Theming and the UI3 look", registered in the guides `meta.json`. Each section is checked against the code before it is written.

1. **How colours reach the plugin.** `figma.showUI(__html__, { themeColors: true })` makes Figma inject `--figma-color-*` custom properties and toggle `figma-light` / `figma-dark` on `<html>`. `packages/ui/src/styles.css` defines `--ui3-*` tokens as `var(--figma-color-*, <kit fallback>)`, exposes them to Tailwind as `--color-figma-*`, and uses `.dark` (Storybook, tests) or `html.figma-dark` (Figma) for the dark palette.
2. **Bound and static tokens.** The bg, text, border and icon families bind to Figma variables. Menu, tooltip and `border-translucent` tokens are static kit values because Figma injects no such names; menus and tooltips are therefore dark in both themes by design. Link to `packages/ui/src/figma-variables.md` for the full table and the console snippet.
3. **`figma-*` utilities versus shadcn aliases.** `bg-figma-bg-*`, `text-figma-text-*`, `border-figma-border*`, `text-figma-icon-*` versus `bg-background`, `text-muted-foreground` and friends, which are aliases onto the same tokens. Use `figma-*` when the kit names a specific surface; use the alias when a shadcn component already does.
4. **The scale.** 24 px controls and 32 px `lg`; `text-sm` is 11 px with weight 450, `font-semibold` is 550, `tracking-ui3`; radii 5 px (`rounded-md`) and 13 px (`rounded-xl`); the Inter variable font is inlined; Lucide icons use a 1.5 px stroke.
5. **Layout conventions.** From `packages/ui/src/app.tsx`: 320×480 window, 40 px header, sections with 8 px gutters and 1 px dividers, 24 px rows for inputs and toggles.
6. **Storybook.** The theme toolbar and the twelve `UI3/*` parity stories with kit reference images under `apps/storybook/src/stories/UI3/refs`.

## Files that get summaries and a link

- **`.claude/CLAUDE.md`.** Project Overview describes a shadcn/Tailwind 4 library. "UI Components (react-figma-ui)" becomes "UI Components": 46 shadcn components plus Icon, IconButton, SectionTitle and Type, exported from `packages/ui/src/index.ts`. "Styling" becomes a Theming paragraph with the link. Commands: Storybook via `turbo run storybook` or `bun run --filter @repo/storybook storybook`; the plugin package is `@repo/design-plugin`; add `bun run types`, `bun run analyze`, `bun run docs`. Tooling versions corrected. Three MCP servers. One sentence on the release flow (`bun changeset`, `release.yml`, the Version Packages PR). The skills sections already describe the single shipped skill after PR #19; keep them as they are.
- **`README.md`.** 50 components, the Storybook command, manifest fields `documentAccess` and `networkAccess`, a "Figma-native UI" paragraph with the link, the release flow.
- **`.claude/skills/build-figma-plugin/SKILL.md`.** Validation step runs `bun run test`. New UI3 rules: use the exported components; colour only through `figma-*` utilities or the shadcn aliases; 24 px rows and 8 px gutters; keep `themeColors: true`; never hard-code colours or window chrome.
- **`.claude/skills/build-figma-plugin/references/ui-components.md`.** Cheat-sheet rewritten around `figma-*` utilities and the UI3 scale; app-shell pattern replaced by the sampler's panel structure; full component inventory grouped as Storybook groups it; icon list includes `lucide:ellipsis` and the `ICONS` export; size mapping for `xs`/`sm`/default/`lg`.
- **`apps/docs/content/docs/guides/ui-components.mdx`.** Counts, the Storybook command, the icon list, a styling section that points to the theming page, and the full inventory.

## Files that only get corrections

| File | Correction |
| --- | --- |
| `apps/docs/content/docs/index.mdx` | 50 components; about 130 tests |
| `apps/docs/content/docs/getting-started/index.mdx` | Bun 1.4.2 or later; Storybook command |
| `apps/docs/content/docs/guides/plugin-config.mdx` | manifest snippet gains `documentAccess` and `networkAccess` |
| `apps/docs/content/docs/guides/architecture.mdx` | three output files, not two |
| `apps/docs/content/docs/project/contributing.mdx` | test count |
| `apps/docs/content/docs/project/versioning.mdx` | drop the hard-coded current version |
| `CONTRIBUTING.md` | Storybook command |
| `figma-plugin-template.code-workspace` | Storybook folder → `apps/storybook`; root folder references match the folder name; Tailwind config → `packages/ui/src/styles.css`; remove the GraphQL entry |
| `.vscode/launch.json` | remove the "Debug UI (Chrome)" target |

## Verification

- A fact-check reviewer with repo access checks every claim in the five rewritten files against the code: component counts against `packages/ui/src/index.ts`, scripts against the root `package.json` and `turbo.json`, versions against `bun.lock` and package manifests, token and utility names against `packages/ui/src/styles.css`, window and manifest values against `apps/design-plugin/src/plugin/plugin.ts` and `figma.manifest.ts`.
- `bun run docs:build` succeeds and the new page appears in the guides navigation.
- `bun run lint` passes.
- No tests change and no changeset is added.

## Out of scope

- Dependency updates (second half of stream 2, separate spec).
- Marking `docs/plans/2026-04-23-ui3-theming*` as superseded and other structural cleanup (stream 3).
- Tooling that generates counts or inventories from code.
