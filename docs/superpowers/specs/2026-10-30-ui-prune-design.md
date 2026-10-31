# UI package pruning: Sidebar, use-mobile, next-themes, Type scale

**Date:** 2026-10-30
**Status:** Approved (brainstorm with Jonas, 2026-10-30)
**Stream:** 3 (structural cleanup), bundle 1 of 4. The other bundles, each its own spec and PR: tooling and small fixes, docs archive, official Figma MCP.

## Problem

`packages/ui` carries three things the template does not use and one that contradicts its own type scale:

- `components/ui/sidebar.tsx` (shadcn Sidebar) and `hooks/use-mobile.ts` are exported from `index.ts` and used nowhere: no story, no sample-app usage, no test beyond the export itself. Sidebar's own imports (Button, Input, Separator, Sheet, Skeleton, Tooltip) all have other users.
- `next-themes` is a dependency only because shadcn's `sonner.tsx` calls its `useTheme()` for the toaster's theme. The plugin has no `next-themes` provider, so the hook returns `"system"` and Sonner falls back to `prefers-color-scheme`, which does not follow Figma's theme. Figma already toggles `figma-dark` / `figma-light` on `<html>` (with `themeColors: true`), and `styles.css` keys its dark variant on `html.figma-dark` and `.dark`.
- The `Type` component uses arbitrary `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[14px]` classes. The UI3 scale defined in `styles.css` is `text-xs` 9/12, `text-sm` and `text-base` 11/16, `text-lg` 13/20, `text-xl` 15/24; `Type`'s default `small` is 12 px, a UI2 size, and three doc sentences explain that `Type` "keeps its own sizes".

## Decisions

| Question | Decision |
| --- | --- |
| Sidebar and use-mobile | Delete both files and their exports. Counts in docs go from 46 shadcn / 50 total to 45 / 49; "Sidebar" leaves the component lists. |
| Theme source for Sonner | New hook `useFigmaTheme()` in `packages/ui/src/hooks/use-figma-theme.ts`, exported from the package: returns `"dark"` when `<html>` has `figma-dark` or `dark`, else `"light"`, observes the `class` attribute with a `MutationObserver`, and returns `"light"` when `document` is undefined. `sonner.tsx` passes its value as `theme`. `next-themes` is removed from `packages/ui/package.json`. |
| Type scale | `xsmall` → `text-xs`, `small` → `text-sm` (default), `large` → `text-lg`, `xlarge` → `text-xl`. Weights unchanged (`font-normal` 400, `font-medium` 450, `font-semibold` 550). Stories unchanged. |
| Changeset | `major` for `@repo/ui`: two exports are removed and `Type` renders at different sizes. `@repo/common` follows through the fixed group (2.0.0 for both). |
| Tests | `use-figma-theme.test.ts` (happy-dom): light by default, dark when `figma-dark` is set before mount, flips when the class changes after mount, no update after unmount. The exports test adds `useFigmaTheme`. |

## Changes (one commit each)

1. **Remove Sidebar and use-mobile.** `git rm` the two files; drop the sidebar export block and `useIsMobile` from `packages/ui/src/index.ts`. Docs: `README.md` lines 20 and 87, `.claude/CLAUDE.md` line 105 (count and the "including Dialog, DropdownMenu, Tabs, Command and Sidebar" list), `apps/docs/content/docs/guides/ui-components.mdx` lines 3, 8 and the Layout row at 25, `.claude/skills/build-figma-plugin/references/ui-components.md` Layout row at 20.
2. **Sonner reads the Figma theme.** Add the hook and its test, export it from `index.ts` (hooks section) and add it to `__tests__/exports.test.ts`, change `sonner.tsx`, remove `next-themes` from the manifest (controller runs `bun install`). Docs: `apps/docs/content/docs/guides/theming.mdx` gains one sentence naming `useFigmaTheme()` as the way to read the current theme in plugin code.
3. **Type on the UI3 scale.** Edit `sizeMap`; update the three sentences: `theming.mdx` line 89, `ui-components.mdx` line 117, skill reference line 125 (new wording: `Type` uses the UI3 scale: `xsmall` 9 px, `small` 11 px (default), `large` 13 px, `xlarge` 15 px).
4. **Changeset.** `.changeset/ui-prune.md`, `"@repo/ui": major`, text: "Remove the unused Sidebar component and useIsMobile hook; Sonner now follows Figma's theme through the new useFigmaTheme() hook instead of next-themes; Type uses the UI3 type scale (9/11/13/15 px) so its default size is 11 px like every other control."

## Facts the changes rely on (verified 2026-10-30)

- `grep` across `packages/ui/src`, `apps/storybook`, `apps/design-plugin`: `Sidebar*` and `useIsMobile` appear only in `index.ts`, `sidebar.tsx` and `use-mobile.ts`. `next-themes` appears only in `sonner.tsx` and the manifest.
- `styles.css` line 13: `@custom-variant dark (&:where(.dark, .dark *, html.figma-dark, html.figma-dark *))`; `figma-variables.md` documents that Figma toggles `figma-light` / `figma-dark` on `<html>`.
- `sonner`'s `ToasterProps["theme"]` accepts `"light" | "dark" | "system"`.
- Token scale in `styles.css` lines 254–267: `--text-xs` 9 px, `--text-sm` 11 px, `--text-base` 11 px, `--text-lg` 13 px, `--text-xl` 15 px; weights 400 / 450 / 550 / 600.
- The `Type` stories (`apps/storybook/src/stories/DataDisplay/Type.stories.tsx`) only pass `size` and `weight` names, so they need no change.

## Verification

- `bun run test` (new hook tests plus the existing 133), `bun run types`, `bun run lint`, `bun run --filter @repo/design-plugin build` (the sampler app renders the Toaster).
- Storybook built and checked in the browser: the Sonner story in light and dark (toast surface follows the theme), the Type stories (default now 11 px), and one Sheet or Tooltip story to confirm the shared components survived the Sidebar removal.
- `grep -rn "Sidebar\|useIsMobile\|next-themes\|text-\[1[1-4]px\]" packages apps/storybook README.md CONTRIBUTING.md .claude apps/docs/content` finds nothing outside history docs.
- `bun changeset status` lists both packages for a major bump.

## Out of scope

- The other three stream 3 bundles.
- Removing further shadcn components or re-syncing any component with the shadcn registry.
- A theme provider or theme switching API beyond reading the class Figma sets.
