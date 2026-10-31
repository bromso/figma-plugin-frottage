# Documentation Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every statement in the template's documentation true after the Bun (PR #16), UI3 (PR #17) and skills-removal (PR #19) changes, and add the missing explanation of how theming works.

**Architecture:** One canonical page, `apps/docs/content/docs/guides/theming.mdx`, carries the full theming and UI3 story and is written first, each claim checked against the code. `CLAUDE.md`, `README.md`, the `build-figma-plugin` skill and the UI components guide then get short summaries that link to it. The remaining files get only the corrections listed in the spec. A fact-check reviewer verifies every claim against the code before the PR opens.

**Tech Stack:** Fumadocs (Next.js) docs site in `apps/docs`, Markdown/MDX, Biome for lint, Bun 1.4.2.

**Spec:** `docs/superpowers/specs/2026-10-29-docs-drift-design.md`

**Branch:** `docs/stream-2-drift` already exists in the main checkout `/Users/jonasbroms/Sites/figma-plugin-template` with the spec committed. Work there; no worktree is needed because no package code changes.

---

## Facts every task relies on (verified 2026-10-30 against master `ed4548e`)

Implementers copy these; reviewers re-check them with the commands shown.

| Fact | Value | Verify with |
| --- | --- | --- |
| shadcn components in `packages/ui/src/components/ui/` | 46: accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, hover-card, input-group, input-otp, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toggle-group, toggle, tooltip | `ls packages/ui/src/components/ui/*.tsx \| grep -v test \| wc -l` |
| Custom components in `packages/ui/src/components/figma/` | Icon, IconButton, SectionTitle, Type | `ls packages/ui/src/components/figma/*.tsx \| grep -v test` |
| Built-in icons | `lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis`; `ICONS` and `registerIcons` exported | `grep -n "ellipsis\|ICONS\|registerIcons" packages/ui/src/components/figma/icon.tsx packages/ui/src/index.ts` |
| Tests | 133 `it`/`test` calls | `grep -rhoE "^\s*(it\|test)\(" packages apps/design-plugin --include='*.test.ts' --include='*.test.tsx' \| wc -l` |
| Root scripts | build, dev, lint, test, test:watch, analyze, types, docs, docs:build, changeset, version-packages, release, prepare, plus `storybook` and `build-storybook` added by the Task 1 fix-up (review outcome: `turbo` is only a devDependency, so `bun run storybook` is the command to document). | `python3 -c "import json;print(list(json.load(open('package.json'))['scripts']))"` |
| Turbo tasks | build, analyze, dev, lint, test, test:watch, types, storybook, build-storybook, docs:dev, docs:build | `python3 -c "import json;print(list(json.load(open('turbo.json'))['tasks']))"` |
| Storybook commands | `bun run storybook` (root script → `turbo run storybook`; or `bun run --filter @repo/storybook storybook`), port 6006; `bun run build-storybook` | `grep storybook apps/storybook/package.json` |
| Versions | Bun 1.4.2 (`packageManager`, `engines.bun >=1.4.2`), Biome 2.4.12, Storybook 10.3.5, Tailwind 4.3, React 19.2, TypeScript 6 | `grep -h '"storybook"\|"@biomejs/biome"\|"tailwindcss"\|"react":\|"typescript":' package.json apps/storybook/package.json packages/ui/package.json` |
| Plugin window | `figma.showUI(__html__, { width: 320, height: 480, themeColors: true, title })` in both editors | `grep -n -A4 showUI apps/design-plugin/src/plugin/plugin.ts` |
| Manifest | has `documentAccess: "dynamic-page"` and `networkAccess: { allowedDomains: ["none"] }` | `cat apps/design-plugin/figma.manifest.ts` |
| Build output | `dist/index.html`, `dist/plugin.js`, `dist/manifest.json` | `ls apps/design-plugin/dist` after `bun run build` |
| MCP servers in `.claude/settings.json` | Figma, Context7, sequential-thinking | `python3 -c "import json;print(list(json.load(open('.claude/settings.json'))['mcpServers']))"` |
| `figma-*` color utilities | bg: `figma-bg`, `-secondary`, `-tertiary`, `-hover`, `-pressed`, `-selected`, `-disabled`, `-brand`, `-brand-hover`, `-brand-pressed`, `-danger`, `-danger-hover`, `-menu`, `-menu-hover`, `-menu-selected`, `-tooltip`; text: `figma-text`, `-secondary`, `-tertiary`, `-disabled`, `-brand`, `-onbrand`, `-danger`, `-ondanger`, `-menu`, `-menu-secondary`, `-menu-danger`, `-menu-disabled`, `-tooltip`, `-tooltip-secondary`; border: `figma-border`, `-translucent`, `-strong`, `-selected`, `-selected-strong`, `-danger`, `-menu`; icon: `figma-icon`, `-secondary`, `-brand`, `-onbrand`, `-menu` | `grep -o "^  --color-figma-[a-z-]*" packages/ui/src/styles.css` |
| Static tokens (Figma injects no variable) | bg-menu, bg-menu-hover, bg-menu-selected, bg-tooltip, text-menu, text-menu-secondary, text-menu-danger, text-menu-disabled, text-tooltip, text-tooltip-secondary, border-menu, border-translucent, icon-menu | `grep -c "static: Figma injects no" packages/ui/src/styles.css` → 26 |
| Scale | `text-xs` 9/12, `text-sm` 11/16 (body), `text-base` 11/16, `text-lg` 13/20, `text-xl` 15/24; weights medium 450 (body), semibold 550, bold 600; radii sm 2 px, md 5 px, lg 5 px, xl 13 px; `--tracking-ui3`; shadows `tooltip`, `menu`, `dialog`; `svg.lucide { stroke-width: 1.5 }` | `grep -n "^  --text-\|^  --font-weight\|^  --radius\|^  --shadow\|svg.lucide" packages/ui/src/styles.css` |
| Button sizes | default `h-6`, `sm`/`xs` `h-5` (aliases), `lg` `h-8`, `icon` 24 px, `icon-sm`/`icon-xs` 20 px, `icon-lg` 32 px | `sed -n 27,36p packages/ui/src/components/ui/button.tsx` |
| Type sizes | `xsmall` 11 px, `small` 12 px (default), `large` 13 px, `xlarge` 14 px; weights normal, medium, bold. Still hard-coded px, not the UI3 scale (follow-up for the sweep, not this PR). | `sed -n 4,12p packages/ui/src/components/figma/type.tsx` |
| Storybook groups | Inputs, DataDisplay, Feedback, Layout, Navigation, Surfaces, Custom, UI3 (12 parity stories: Badge, Button, Checkbox, Command, Dialog, Input, Menu, Radio, Select, Switch, Tabs, Tooltip) | `ls apps/storybook/src/stories/*/` |
| Docs navigation | one file, `apps/docs/content/docs/meta.json`, lists pages under `---Guides---` | `cat apps/docs/content/docs/meta.json` |

Shared verify command, from the repo root, after every task:

```bash
bun run lint 2>&1 | grep -E "Tasks:|✖|rror"
```

Expected: `Tasks: 4 successful, 4 total` (one pre-existing `@repo/docs` warning is fine). Tasks that touch `apps/docs` also run:

```bash
bun run docs:build 2>&1 | grep -E "Compiled|rror|Exited"
```

Expected: `✓ Compiled successfully` and `Exited with code 0`.

Every commit ends with the trailer:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 1: The canonical theming page

**Files:**
- Create: `apps/docs/content/docs/guides/theming.mdx`
- Modify: `apps/docs/content/docs/meta.json` (add one entry)

- [ ] **Step 1: Create the page**

Write `apps/docs/content/docs/guides/theming.mdx` with exactly this content:

````mdx
---
title: Theming and the UI3 look
description: How the components take Figma's colors, what the figma-* utilities are, and the sizes the UI3 design uses.
---

## Where the colors come from

The plugin opens its window with `themeColors: true`:

```ts
figma.showUI(__html__, {
  width: 320,
  height: 480,
  themeColors: true,
  title: "My Plugin",
});
```

With that flag Figma injects its own color variables (`--figma-color-bg`, `--figma-color-text`, `--figma-color-border` and about 150 more) into the plugin iframe and sets a `figma-light` or `figma-dark` class on `<html>`. When the user switches Figma's theme, the variables change and the plugin follows without a reload.

`packages/ui/src/styles.css` turns those variables into the component tokens:

```css
/* light palette, with the UI3 kit value as fallback */
:root {
  --ui3-bg: var(--figma-color-bg, #ffffff);
  --ui3-text: var(--figma-color-text, rgba(0, 0, 0, 0.9));
  /* … */
}

/* dark palette: Storybook and tests use .dark, Figma uses html.figma-dark */
.dark,
html.figma-dark {
  --ui3-bg: var(--figma-color-bg, #2c2c2c);
  --ui3-text: var(--figma-color-text, #ffffff);
  /* … */
}
```

Inside Figma the `--figma-color-*` value wins. Outside Figma, in Storybook, tests or a plain browser, the fallback applies, so the components look the same as they do in Figma's light or dark theme.

The tokens are exposed to Tailwind as `--color-figma-*`, which gives you the `figma-*` utilities described below. The shadcn aliases (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary` and so on) point at the same tokens, so every shadcn component is themed as well.

## Which tokens bind, and which are static

Figma documents variables for the bg, text, border and icon families. The template binds to those. It documents nothing for menus, tooltips or translucent borders, so those tokens hold their UI3 kit value in both themes. That is the intended look: Figma's own menus and tooltips are dark whether the app is light or dark.

| Family | Binds to Figma | Static in both themes |
| --- | --- | --- |
| Backgrounds | `bg`, `bg-secondary`, `bg-tertiary`, `bg-hover`, `bg-pressed`, `bg-selected`, `bg-disabled`, `bg-brand`, `bg-brand-hover`, `bg-brand-pressed`, `bg-danger`, `bg-danger-hover` | `bg-menu`, `bg-menu-hover`, `bg-menu-selected`, `bg-tooltip` |
| Text | `text`, `text-secondary`, `text-tertiary`, `text-disabled`, `text-brand`, `text-onbrand`, `text-danger`, `text-ondanger` | `text-menu`, `text-menu-secondary`, `text-menu-danger`, `text-menu-disabled`, `text-tooltip`, `text-tooltip-secondary` |
| Borders | `border`, `border-strong`, `border-selected`, `border-selected-strong`, `border-danger` | `border-translucent`, `border-menu` |
| Icons | `icon`, `icon-secondary`, `icon-brand`, `icon-onbrand` | `icon-menu` |

The full table with the fallback values, and a console snippet that prints the variables Figma injects into a running plugin, lives in [`packages/ui/src/figma-variables.md`](https://github.com/bromso/figma-plugin-template/blob/master/packages/ui/src/figma-variables.md).

## The figma-* utilities

Every token is a Tailwind color, so it works with any color utility: `bg-figma-bg-secondary`, `text-figma-text-secondary`, `border-figma-border`, `ring-figma-border-selected`, `fill-figma-bg-tooltip`.

```tsx
<section className="border-b border-figma-border p-2">
  <p className="text-figma-text-secondary">Nothing selected</p>
</section>
```

Use a `figma-*` utility when the kit names the surface you want: a secondary text color, the panel divider, the hover background. Use the shadcn alias when a shadcn component already applies it for you; there is no need to override `bg-background` on a `Dialog`. Never write a hex color or an `rgba()` value in a component; it will not follow the theme.

Menus, dropdowns, context menus, the menubar, the command palette and tooltips are dark in both themes. They use the static `figma-*-menu` and `figma-*-tooltip` tokens, so do not wrap them in `dark:` variants or give them light backgrounds.

## Sizes, type and radii

The components follow Figma's UI3 kit, which is denser than the shadcn defaults.

| What | Value |
| --- | --- |
| Control height | 24 px (`h-6`) by default; `size="lg"` is 32 px (`h-8`); `sm` and `xs` are 20 px |
| Body text | `text-sm`, 11 px on a 16 px line, weight 450 (`font-medium`) |
| Emphasis | `font-semibold`, weight 550; `font-bold`, weight 600 |
| Larger text | `text-lg` 13 px, `text-xl` 15 px; `text-xs` is 9 px and is reserved for badges and chart labels |
| Letter spacing | `tracking-ui3` (0.005 em) on labels and controls |
| Radius | `rounded-md` and `rounded-lg` are 5 px (controls, rows, badges); `rounded-xl` is 13 px (menus, dialogs); `rounded-sm` is 2 px |
| Shadows | `shadow-tooltip`, `shadow-menu`, `shadow-dialog` |
| Font | Inter, as a variable font inlined into the plugin bundle |
| Icons | Lucide icons are drawn with a 1.5 px stroke to match Figma's 1 px icons |

The `Type` component keeps its own sizes (`xsmall` 11 px, `small` 12 px, `large` 13 px, `xlarge` 14 px); prefer the Tailwind text utilities above for new UI.

## Laying out a panel

`packages/ui/src/app.tsx` is the reference layout and the plugin's default screen. It reads like a Figma properties panel:

- The window is 320 × 480. A `Dialog` is 320 px wide by default and 480 px with `size="lg"`, clamped to the window.
- A 40 px header (`h-10 border-b border-figma-border px-2`) holds the tabs and an icon button.
- Sections are separated by 1 px dividers (`border-b border-figma-border`) and padded 8 px (`p-2`).
- Inputs, checkboxes, radios and switches sit on 24 px rows (`flex h-6 items-center gap-2`).
- The root is `flex h-full flex-col`; the tab content scrolls (`min-h-0 overflow-y-auto`) so the header stays fixed.

Copy that structure for new screens rather than starting from a padded card.

## Checking parity in Storybook

Start Storybook with:

```bash
turbo run storybook
```

The toolbar has a light/dark toggle that flips the `dark` class on the preview. The `UI3` section holds twelve parity stories (Badge, Button, Checkbox, Command, Dialog, Input, Menu, Radio, Select, Switch, Tabs, Tooltip). Each renders the component in both themes next to a screenshot of the matching component from the UI3 kit, so you can see where the implementation diverges. Components that open in a portal (menus, tooltips, dialogs) render once and are compared with the toolbar toggle.
````

- [ ] **Step 2: Register the page in the navigation**

In `apps/docs/content/docs/meta.json`, after the line `"guides/ui-components",` add a line `"guides/theming",` so the Guides section reads:

```json
    "---Guides---",
    "guides/architecture",
    "guides/ui-components",
    "guides/theming",
    "guides/messaging",
    "guides/plugin-config",
```

- [ ] **Step 3: Check the facts in the page against the code**

Run each command from the "Facts" table for: showUI values, the static-token count (26), the `figma-*` utility list, the scale lines in `styles.css`, the Button sizes, the Type sizes, the twelve parity story names. Fix any mismatch in the page, not in the code.

- [ ] **Step 4: Build the docs**

Run: `bun run docs:build 2>&1 | grep -E "Compiled|rror|Exited|theming"`
Expected: `✓ Compiled successfully`, a `/docs/guides/theming` route in the static page list, `Exited with code 0`.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/content/docs/guides/theming.mdx apps/docs/content/docs/meta.json
git commit -m "docs: add the theming and UI3 guide

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: CLAUDE.md

**Files:**
- Modify: `.claude/CLAUDE.md`

Replace the sections below in place; leave every other line unchanged.

- [ ] **Step 1: MCP servers (lines 28–31)**

Replace:

```markdown
### MCP Servers (pre-configured)

- **Figma Dev Mode** — Lets Claude read your Figma files directly (requires `FIGMA_API_KEY` in `.claude/settings.json`)
- **Context7** — Fetches up-to-date library documentation to reduce errors
```

with:

```markdown
### MCP Servers (pre-configured)

- **Figma Dev Mode** — Lets Claude read your Figma files directly (requires `FIGMA_API_KEY` in `.claude/settings.json`)
- **Context7** — Fetches up-to-date library documentation to reduce errors
- **Sequential Thinking** — Lets Claude work through multi-step problems before acting
```

- [ ] **Step 2: Git & Versioning (line 41)**

After the line `- **Don't bump versions manually** -- changesets handles version bumps and CHANGELOG` add:

```markdown
- **Releases**: merging to master runs `release.yml`, which opens a "chore: version packages" PR from the pending changesets; merging that PR bumps the versions and writes the CHANGELOGs
```

- [ ] **Step 3: Project Overview (line 47)**

Replace the paragraph with:

```markdown
Figma/FigJam plugin boilerplate using React, Bun, TypeScript, and Turborepo monorepo. Originally based on [CoconutGoodie/figma-plugin-react-vite](https://github.com/CoconutGoodie/figma-plugin-react-vite); the build is now Bun and the UI is a [shadcn/ui](https://ui.shadcn.com) component library on Tailwind CSS 4, themed to Figma's UI3 design and documented in Storybook.
```

- [ ] **Step 4: Commands (lines 53–65)**

Replace the two command lists with:

```markdown
- `bun run dev` — Watch mode for both plugin and UI (parallel Turborepo builds)
- `bun run build` — Production build (UI + plugin to `apps/design-plugin/dist/`)
- `bun run analyze` — Production build plus `dist/meta-*.json` bundle size reports
- `bun run test` — Run all tests across all packages (bun test)
- `bun run test:watch` — Watch mode for tests
- `bun run types` — Type-check all packages
- `bun run lint` — Lint all packages (Biome)
- `bun run docs` — Start the documentation site (Next.js, port 3000)
- `bun run storybook` — Start Storybook (apps/storybook, port 6006)
- `bun run build-storybook` — Build static Storybook (cached by Turborepo)

### Package-scoped commands

- `bun run --filter @repo/ui test` — Run UI package tests only
- `bun run --filter @repo/common test` — Run common package tests only
- `bun run --filter @repo/design-plugin build` — Build plugin only
- `bun run --filter @repo/storybook storybook` — Start Storybook only
```

- [ ] **Step 5: Architecture UI side (line 91)**

Replace:

```markdown
- **UI side** (`packages/ui/src/`) — Runs in an iframe. React app with react-figma-ui components. Entry: `main.tsx` → `app.tsx`.
```

with:

```markdown
- **UI side** (`packages/ui/src/`) — Runs in an iframe. React app built from the `@repo/ui` components. Entry: `main.tsx` → `app.tsx`; `app.tsx` is the sampler laid out like a Figma properties panel and is the reference for new screens.
```

- [ ] **Step 6: UI Components section (lines 94–98)**

Replace:

```markdown
### UI Components (react-figma-ui)

`packages/ui` re-exports all 14 react-figma-ui components as named exports: Button, Checkbox, Disclosure, DisclosureItem, Icon, IconButton, Input, Label, SectionTitle, OnboardingTip, Radio, Select, Switch, Textarea, Type.

The figma-plugin-ds CSS is loaded as a side-effect import in `packages/ui/src/index.ts`.
```

with:

```markdown
### UI Components

`packages/ui/src/index.ts` exports 46 shadcn/ui components (`packages/ui/src/components/ui/`, from Accordion to Tooltip, including Dialog, DropdownMenu, Tabs, Command and Sidebar) and four custom Figma components (`packages/ui/src/components/figma/`): `Icon`, `IconButton`, `SectionTitle`, `Type`. Sixteen of the shadcn components are edited to match Figma's UI3 kit (Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog, AlertDialog); the rest use the same tokens and scale. Always import from `@repo/ui`; never add another UI library.

Icons come from a registered Lucide subset (`lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis`); add more with `registerIcons()`.
```

- [ ] **Step 7: Styling section (lines 121–123)**

Replace:

```markdown
### Styling

CSS Modules (`*.module.scss`) for component-scoped styles. react-figma-ui provides native Figma styling via figma-plugin-ds CSS.
```

with:

```markdown
### Styling and theming

Tailwind CSS 4 only; there are no CSS Modules. `packages/ui/src/styles.css` defines `--ui3-*` tokens as `var(--figma-color-*, <UI3 kit fallback>)`, so inside Figma (`showUI` with `themeColors: true`) the colors follow the user's theme live, and in Storybook or tests the fallbacks apply. The tokens are exposed as `figma-*` Tailwind colors (`bg-figma-bg-secondary`, `text-figma-text-secondary`, `border-figma-border`, …) and also back the shadcn aliases (`bg-background`, `text-muted-foreground`, …). Menus and tooltips are dark in both themes by design. The scale is 24 px controls, 11 px Inter at weight 450, 5 px radius (13 px for menus and dialogs). Never hard-code a color. Full explanation: `apps/docs/content/docs/guides/theming.mdx`; the bound-versus-static token table is `packages/ui/src/figma-variables.md`.
```

- [ ] **Step 8: Tooling (lines 127–132)**

Replace the list with:

```markdown
- **Bun 1.4.2** — Package manager, bundler and test runner (sole lockfile: `bun.lock`)
- **Turborepo** — Monorepo task orchestration with caching
- **Biome 2.4.12** — Linting and formatting (root `biome.json`)
- **bun test** — Testing framework (happy-dom via preload for UI, plain runtime for common)
- **Storybook 10.3.5** — Component documentation with a light/dark toolbar and `UI3/*` parity stories against kit screenshots
- **Tailwind CSS 4.3** — Styling, via `bun-plugin-tailwind` in the plugin build and the Vite plugin in Storybook
- **Changesets** — Versioning and CHANGELOGs, released by `release.yml`
```

- [ ] **Step 9: Plugin Configuration (line 136)**

Replace the paragraph with:

```markdown
`apps/design-plugin/figma.manifest.ts` exports the Figma plugin manifest (`documentAccess: "dynamic-page"` and `networkAccess` are required fields; keep them). Update `id` with your plugin's ID from Figma. This generates `dist/manifest.json` at build time. The window is opened in `apps/design-plugin/src/plugin/plugin.ts` at 320 × 480 with `themeColors: true`; keep that flag or the UI loses Figma's theme.
```

- [ ] **Step 10: Verify**

```bash
grep -n "react-figma-ui\|figma-plugin-ds\|module.scss\|14 \|2.4.10\|8.6.18\|turbo run storybook\|@repo/figma-plugin" .claude/CLAUDE.md
```

Expected: no output. Then the shared verify command.

- [ ] **Step 11: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: describe the shadcn, Tailwind and UI3 stack in CLAUDE.md

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Features (lines 18–25)**

Replace line 21 `- **14+ UI components** via shadcn/ui + custom Figma components (Button, Input, Select, Accordion, Icon, and more)` with:

```markdown
- **50 UI components** — 46 from shadcn/ui plus Icon, IconButton, SectionTitle and Type, styled to Figma's UI3 design and themed live from Figma's color variables
```

Delete line 8, the redundant `![Bun bundler]` badge.

- [ ] **Step 2: Commands table (lines 56–64)**

Replace the table with:

```markdown
| Command | Description |
|---------|-------------|
| `bun run dev` | Watch mode (plugin + UI via Turborepo) |
| `bun run build` | Production build |
| `bun run analyze` | Production build with bundle size reports |
| `bun run test` | Run all tests |
| `bun run test:watch` | Watch mode for tests |
| `bun run types` | Type-check all packages |
| `bun run lint` | Lint with Biome |
| `bun run docs` | Start the documentation site |
| `bun run storybook` | Start Storybook (port 6006) |
| `bun run build-storybook` | Build static Storybook (cached) |
```

- [ ] **Step 3: UI Components (lines 82–90)**

Replace the section with:

```markdown
## UI Components

`packages/ui` provides 50 components: 46 from [shadcn/ui](https://ui.shadcn.com) (inputs, menus, dialogs, tabs, tables, charts, and more) and four custom Figma components (`Icon`, `IconButton`, `SectionTitle`, `Type`). Import everything from `@repo/ui`.

### Figma-native UI

The components follow Figma's UI3 design: 24 px controls, 11 px Inter, 5 px radius, dark menus and tooltips. Colors bind to the `--figma-color-*` variables Figma injects when the window opens with `themeColors: true`, so the plugin follows the user's light or dark theme live; outside Figma the UI3 kit colors apply. Use the `figma-*` Tailwind utilities (for example `text-figma-text-secondary`, `border-figma-border`) instead of hard-coded colors. See the [theming guide](apps/docs/content/docs/guides/theming.mdx) and `packages/ui/src/figma-variables.md`.

Run `bun run storybook` to browse all components; the `UI3` section compares them with the kit in both themes.
```

- [ ] **Step 4: Plugin Configuration (lines 96–102)**

Replace the code block with:

```ts
export default {
  name: "My Plugin",
  id: "your-plugin-id-from-figma",
  documentAccess: "dynamic-page",
  networkAccess: { allowedDomains: ["none"] },
  // ...
};
```

After the line `Get your plugin ID from Figma: **Plugins > Manage plugins > Create new plugin**.` add:

```markdown
The window opens at 320 × 480 with `themeColors: true` (see `apps/design-plugin/src/plugin/plugin.ts`); keep that flag so the UI receives Figma's theme.
```

- [ ] **Step 5: Releases**

Find the section that describes versioning or changesets (search `changeset`). If none exists, add before `## Testing in Figma`:

```markdown
## Releases

Run `bun changeset` after user-facing changes. Merging to master runs the release workflow, which opens a "chore: version packages" PR; merging that PR bumps the versions and writes the CHANGELOGs.
```

- [ ] **Step 6: Verify**

```bash
grep -n "14+\|turbo run storybook\|Bun bundler" README.md
```

Expected: no output. Then the shared verify command.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: update the README component inventory, commands and theming summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The build-figma-plugin skill

**Files:**
- Modify: `.claude/skills/build-figma-plugin/SKILL.md`

- [ ] **Step 1: Validation step (lines 50–54)**

Replace the code block with:

```bash
bun run build      # Must succeed — produces dist/index.html, dist/plugin.js, dist/manifest.json
bun run types      # Must succeed — no TypeScript errors
bun run lint       # Must succeed — no Biome errors
bun run test       # Must succeed — all tests pass
```

- [ ] **Step 2: Window size row (line 35)**

Replace `| \`apps/design-plugin/src/plugin/plugin.ts\` | Set window size, title, and bootstrap logic |` with:

```markdown
| `apps/design-plugin/src/plugin/plugin.ts` | Set the window title and bootstrap logic. Keep `width: 320, height: 480` unless the UI needs more, and always keep `themeColors: true` |
```

- [ ] **Step 3: UI3 rules**

In "Important Architecture Constraints", after the line `- **UI components** come from \`@repo/ui\`. Always import from there — never install new UI libraries.` add:

```markdown
- **The UI follows Figma's UI3 design.** Build screens like `packages/ui/src/app.tsx`: a 40 px header, sections divided by `border-b border-figma-border` with `p-2`, and 24 px rows (`flex h-6 items-center gap-2`). Controls are 24 px by default; use `size="lg"` only in dialogs.
- **Color only through tokens.** Use the `figma-*` utilities (`text-figma-text-secondary`, `bg-figma-bg-secondary`, `border-figma-border`) or the shadcn aliases the components already apply. Never write hex or `rgba()` colors, and never add `dark:` variants: the theme comes from Figma's variables through `themeColors: true`.
- **Menus and tooltips are dark in both themes** by design. Do not restyle them.
- **Read `@references/ui-components.md`** for the component inventory and the layout pattern before writing any UI.
```

- [ ] **Step 4: Verify**

```bash
grep -c "bun run test\|themeColors\|figma-text-secondary" .claude/skills/build-figma-plugin/SKILL.md
```

Expected: `3` or more. Then the shared verify command.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/build-figma-plugin/SKILL.md
git commit -m "docs(skill): validate with tests and follow the UI3 conventions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The skill's UI components reference

**Files:**
- Rewrite: `.claude/skills/build-figma-plugin/references/ui-components.md`

- [ ] **Step 1: Replace the whole file with**

````markdown
# UI Components

All UI components are imported from `@repo/ui` (which maps to `packages/ui/src/index.ts`).

**Never install additional UI libraries.** The build produces a single HTML file; external dependencies increase bundle size. Use what's available.

**The components follow Figma's UI3 design.** They are 24 px tall, use 11 px Inter, and take their colors from Figma's theme through `themeColors: true`. Do not fight that: no hard-coded colors, no `dark:` variants, no roomy padding. The full explanation is in `apps/docs/content/docs/guides/theming.mdx`.

## Inventory

Fifty components. The sixteen marked ★ are edited to match the UI3 kit exactly; the others share the same tokens and scale.

| Group | Components |
| --- | --- |
| Inputs | Button ★, Calendar, Checkbox ★, Input ★, InputGroup, InputOTP, RadioGroup ★, Select ★, Slider, Switch ★, Textarea ★, Toggle, ToggleGroup |
| Data display | Avatar, Badge ★, Card, Carousel, Chart, Icon, Label, Table, Tooltip ★, Type |
| Feedback | Alert, AlertDialog ★, Dialog ★, Drawer, Progress, Sheet, Skeleton, Sonner |
| Layout | AspectRatio, Resizable, ScrollArea, Separator, Sidebar |
| Navigation | Breadcrumb, ContextMenu ★, DropdownMenu ★, Menubar ★, NavigationMenu, Pagination, Tabs ★ |
| Surfaces | Accordion, Collapsible, Command ★, HoverCard, Popover |
| Custom Figma | Icon, IconButton, SectionTitle, Type |

Storybook (`bun run storybook`) shows every component in both themes; the `UI3` section compares the ★ components with the kit.

## Inputs

```tsx
import { Input, Textarea, Checkbox, Switch, Label, RadioGroup, RadioGroupItem, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ui";

// Text input (24 px, filled surface)
<Input placeholder="Layer name" aria-label="Layer name" value={name} onChange={e => setName(e.target.value)} />

// Multiline text
<Textarea placeholder="Description" rows={2} aria-label="Description" />

// Checkbox on a 24 px row
<div className="flex h-6 items-center gap-2">
  <Checkbox id="clip" checked={clip} onCheckedChange={setClip} />
  <Label htmlFor="clip">Clip content</Label>
</div>

// Switch on a 24 px row
<div className="flex h-6 items-center gap-2">
  <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
  <Label htmlFor="auto">Auto layout</Label>
</div>

// Radio group
<RadioGroup value={choice} onValueChange={setChoice}>
  <div className="flex h-6 items-center gap-2">
    <RadioGroupItem value="a" id="r1" />
    <Label htmlFor="r1">Option A</Label>
  </div>
  <div className="flex h-6 items-center gap-2">
    <RadioGroupItem value="b" id="r2" />
    <Label htmlFor="r2">Option B</Label>
  </div>
</RadioGroup>

// Dropdown (the list is dark in both themes, like Figma's)
<Select value={selected} onValueChange={setSelected}>
  <SelectTrigger className="w-full" aria-label="Sizing"><SelectValue placeholder="Choose…" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="fill">Fill container</SelectItem>
    <SelectItem value="hug">Hug contents</SelectItem>
  </SelectContent>
</Select>
```

`Input` and `SelectTrigger` take `size="lg"` for 32 px fields in dialogs.

## Buttons

```tsx
import { Button, IconButton } from "@repo/ui";

<Button onClick={handleClick}>Create</Button>            // brand fill
<Button variant="secondary">Cancel</Button>               // translucent border
<Button variant="outline">Settings</Button>               // same look as secondary
<Button variant="ghost">More</Button>
<Button variant="destructive">Delete</Button>
<Button variant="link">Learn more</Button>
<Button disabled>Loading…</Button>
<Button size="lg">Large (32 px)</Button>

// Icon button (24 px square, ghost by default)
<IconButton iconProps={{ name: "lucide:plus" }} aria-label="Add" onClick={handleAdd} />
```

Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`.
Sizes: `default` (24 px), `lg` (32 px), `sm` and `xs` (20 px, aliases), `icon` (24 px square), `icon-sm` and `icon-xs` (20 px), `icon-lg` (32 px).

## Display

```tsx
import { Icon, SectionTitle, Type, Badge, Alert, AlertDescription, Label } from "@repo/ui";

// Icons (registered Lucide subset)
<Icon name="lucide:plus" />
<Icon name="lucide:info" className="text-figma-icon-secondary" />
<Icon name="lucide:star" />
<Icon name="lucide:ellipsis" />

// Section heading: 32 px row, 11 px semibold
<SectionTitle>Layer</SectionTitle>

// Badges: default is outlined, secondary is the selected tint, destructive is danger
<Badge>Default</Badge>
<Badge variant="secondary">New</Badge>

// Typography helper (renders p, span, h1…h6, label); prefer Tailwind text utilities for new UI
<Type size="small">Body text</Type>
<Type as="h2" size="large" weight="bold">Heading</Type>

// Info alert
<Alert>
  <Icon name="lucide:info" className="size-4" />
  <AlertDescription>Select at least one layer to continue.</AlertDescription>
</Alert>
```

Built-in icons: `lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis`. The `ICONS` export lists them; add more with `registerIcons()`.
Type sizes: `xsmall` (11 px), `small` (12 px, default), `large` (13 px), `xlarge` (14 px). Weights: `normal`, `medium`, `bold`.

## Overlays

```tsx
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@repo/ui";

// Dialog: 320 px window, 40 px header and footer; the body is yours (16 px padding)
<Dialog>
  <DialogTrigger asChild><Button variant="secondary">Rename…</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>Rename layers</DialogTitle></DialogHeader>
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
      <DialogDescription>Give the selected layers a new name.</DialogDescription>
      <Input placeholder="New name" aria-label="New name" />
    </div>
    <DialogFooter>
      <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
      <DialogClose asChild><Button>Rename</Button></DialogClose>
    </DialogFooter>
  </DialogContent>
</Dialog>

// Dropdown menu: dark in both themes
<DropdownMenu>
  <DropdownMenuTrigger asChild><IconButton iconProps={{ name: "lucide:ellipsis" }} aria-label="More" /></DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem>Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

// Tooltip: wrap the app in TooltipProvider once; the trigger must be a focusable element
<Tooltip>
  <TooltipTrigger asChild><IconButton size="icon-sm" iconProps={{ name: "lucide:info" }} aria-label="More info" /></TooltipTrigger>
  <TooltipContent>Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span></TooltipContent>
</Tooltip>
```

## Layout

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger, Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@repo/ui";

// Tabs: 24 px pills
<Tabs defaultValue="design">
  <TabsList>
    <TabsTrigger value="design">Design</TabsTrigger>
    <TabsTrigger value="proto">Prototype</TabsTrigger>
  </TabsList>
  <TabsContent value="design">…</TabsContent>
  <TabsContent value="proto">…</TabsContent>
</Tabs>

// Collapsible sections
<Accordion type="single" collapsible>
  <AccordionItem value="advanced">
    <AccordionTrigger>Advanced</AccordionTrigger>
    <AccordionContent>…</AccordionContent>
  </AccordionItem>
</Accordion>
```

## Styling with Tailwind CSS

Components accept `className`. Use these utilities; they follow Figma's theme.

```tsx
// Panel structure
<div className="flex h-full flex-col bg-background text-foreground">          {/* root */}
<div className="flex h-10 items-center justify-between border-b border-figma-border px-2">  {/* 40 px header */}
<section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">              {/* section */}
<div className="flex h-6 items-center gap-2">                                   {/* 24 px row */}

// Color (never hex, never rgba)
<p className="text-figma-text-secondary">Secondary text</p>
<div className="bg-figma-bg-secondary">Filled surface</div>
<div className="border border-figma-border">Divider or outline</div>
<Icon name="lucide:info" className="text-figma-icon-secondary" />

// Text: text-sm is the 11 px body size and the default; use font-semibold for emphasis
<span className="font-semibold">Strong label</span>
<span className="text-lg">13 px heading</span>

// Width and scrolling
<Button className="w-full">Full width</Button>
<div className="min-h-0 flex-1 overflow-y-auto">Scrolling body</div>
```

Do not use `p-4` shells, `mb-4` stacks, `text-base` headings or `font-bold` for body copy; they look oversized next to Figma's own panels.

## App Shell Pattern

The standard plugin screen follows `packages/ui/src/app.tsx`: a fixed header, scrolling sections, 24 px rows, one primary action.

```tsx
import { useState } from "react";
import { Button, Input, SectionTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { PLUGIN_CHANNEL } from "./app.network";
import { PLUGIN } from "@repo/common/networkSides";

function App() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<string | null>(null);

  async function handleRename() {
    try {
      const count = await PLUGIN_CHANNEL.request(PLUGIN, "renameLayers", [name]);
      setResult(`Renamed ${count} layers`);
    } catch (err) {
      setResult(`Error: ${(err as Error).message}`);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Tabs defaultValue="rename" className="min-h-0 flex-1 gap-0">
        <div className="flex h-10 items-center border-b border-figma-border px-2">
          <TabsList>
            <TabsTrigger value="rename">Rename</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="rename" className="flex min-h-0 flex-col overflow-y-auto">
          <section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">
            <SectionTitle>Layer</SectionTitle>
            <Input placeholder="New name" aria-label="New name" value={name} onChange={e => setName(e.target.value)} />
          </section>
          <section className="flex flex-col gap-2 p-2">
            <Button className="w-full" onClick={handleRename}>Rename selection</Button>
            {result && <p className="text-figma-text-secondary">{result}</p>}
          </section>
        </TabsContent>
        <TabsContent value="about" className="min-h-0 overflow-y-auto p-2 text-figma-text-secondary">
          Renames every selected layer.
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
```
````

- [ ] **Step 2: Verify the inventory**

```bash
ls packages/ui/src/components/ui/*.tsx | grep -v test | wc -l
```

Expected: `46`. Count the names in the Inventory table (46 shadcn names across the first six rows, four custom names) and make sure every file in the directory appears once. Then the shared verify command.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/build-figma-plugin/references/ui-components.md
git commit -m "docs(skill): UI3 inventory, utilities and panel pattern in the components reference

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The UI components guide

**Files:**
- Rewrite: `apps/docs/content/docs/guides/ui-components.mdx`

- [ ] **Step 1: Replace the whole file with**

````mdx
---
title: UI Components
description: The 50 components available for your plugin's interface, and how they fit Figma's UI3 design.
---

## Overview

The template includes 50 UI components that look native inside Figma: 46 from [shadcn/ui](https://ui.shadcn.com) and four custom Figma components. They are styled with Tailwind CSS 4 to Figma's UI3 design and take their colors from Figma's theme; see [Theming and the UI3 Look](/docs/guides/theming).

Import them from `@repo/ui`:

```tsx
import { Button, Input, Select } from "@repo/ui";
```

Run `bun run storybook` to browse every component in light and dark; the `UI3` section compares the kit-matched components with Figma's own.

## Inventory

| Group | Components |
| --- | --- |
| Inputs | Button, Calendar, Checkbox, Input, InputGroup, InputOTP, RadioGroup, Select, Slider, Switch, Textarea, Toggle, ToggleGroup |
| Data display | Avatar, Badge, Card, Carousel, Chart, Icon, Label, Table, Tooltip, Type |
| Feedback | Alert, AlertDialog, Dialog, Drawer, Progress, Sheet, Skeleton, Sonner |
| Layout | AspectRatio, Resizable, ScrollArea, Separator, Sidebar |
| Navigation | Breadcrumb, ContextMenu, DropdownMenu, Menubar, NavigationMenu, Pagination, Tabs |
| Surfaces | Accordion, Collapsible, Command, HoverCard, Popover |
| Custom Figma | Icon, IconButton, SectionTitle, Type (Icon and Type are filed under Data display in Storybook) |

Names are families; `packages/ui/src/index.ts` lists the exact exports (for example Sonner is `Toaster`, Chart is `ChartContainer`). Sixteen components are edited to match the UI3 kit exactly: Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog and AlertDialog. The others share the same tokens and scale.

## Input components

### Button

```tsx
<Button onClick={handleClick}>Create</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="outline">Settings</Button>
<Button variant="destructive">Delete</Button>
<Button size="lg">Large</Button>
<Button disabled>Loading…</Button>
```

Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`. Sizes: `default` (24 px), `lg` (32 px), `sm`/`xs` (20 px), `icon`, `icon-sm`, `icon-xs`, `icon-lg`.

### Input and Textarea

```tsx
<Input placeholder="Layer name" aria-label="Layer name" value={name} onChange={e => setName(e.target.value)} />
<Input size="lg" placeholder="Large field" />
<Textarea placeholder="Description" rows={2} />
```

### Select

```tsx
<Select value={selected} onValueChange={setSelected}>
  <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="fill">Fill container</SelectItem>
    <SelectItem value="hug">Hug contents</SelectItem>
  </SelectContent>
</Select>
```

The list is dark in both themes, like Figma's own dropdowns.

### Checkbox, Switch, RadioGroup

Put them on 24 px rows with a `Label`:

```tsx
<div className="flex h-6 items-center gap-2">
  <Checkbox id="clip" checked={clip} onCheckedChange={setClip} />
  <Label htmlFor="clip">Clip content</Label>
</div>
<div className="flex h-6 items-center gap-2">
  <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
  <Label htmlFor="auto">Auto layout</Label>
</div>
<RadioGroup value={choice} onValueChange={setChoice}>
  <div className="flex h-6 items-center gap-2">
    <RadioGroupItem value="a" id="r1" />
    <Label htmlFor="r1">Option A</Label>
  </div>
</RadioGroup>
```

## Display components

### Icon

```tsx
<Icon name="lucide:plus" />
<Icon name="lucide:info" className="text-figma-icon-secondary" />
```

Built-in icons: `lucide:plus`, `lucide:info`, `lucide:star`, `lucide:ellipsis` (the `ICONS` export lists them). To add more, call `registerIcons()` with an Iconify collection and add each name to `StaticIconNameMap` via `declare module "@repo/ui" { interface StaticIconNameMap { "lucide:trash": true } }`; otherwise `<Icon name>` will not type-check.

### Badge

```tsx
<Badge>Default</Badge>
<Badge variant="secondary">New</Badge>
<Badge variant="destructive">Error</Badge>
```

### Type and SectionTitle

```tsx
<SectionTitle>Layer</SectionTitle>
<Type size="small">Body text</Type>
<Type as="h2" size="large" weight="bold">Heading</Type>
```

`SectionTitle` is the 32 px section header used in the sampler. `Type` keeps its own sizes (`xsmall` 11 px, `small` 12 px, `large` 13 px, `xlarge` 14 px); for new UI prefer the Tailwind text utilities from the theming guide.

### Alert

```tsx
<Alert>
  <AlertDescription>Select at least one layer.</AlertDescription>
</Alert>
```

## Overlay components

### Dialog

```tsx
<Dialog>
  <DialogTrigger asChild><Button variant="secondary">Rename…</Button></DialogTrigger>
  <DialogContent>
    <DialogHeader><DialogTitle>Rename layers</DialogTitle></DialogHeader>
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
      <DialogDescription>Give the selected layers a new name.</DialogDescription>
      <Input placeholder="New name" />
    </div>
    <DialogFooter>
      <DialogClose asChild><Button variant="secondary">Cancel</Button></DialogClose>
      <DialogClose asChild><Button>Rename</Button></DialogClose>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Dialogs are 320 px wide (`size="lg"` is 480 px) with a 40 px header and footer; you pad the body.

### DropdownMenu and Tooltip

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild><IconButton iconProps={{ name: "lucide:ellipsis" }} aria-label="More" /></DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem>Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>

<Tooltip>
  <TooltipTrigger asChild><IconButton size="icon-sm" iconProps={{ name: "lucide:info" }} aria-label="More info" /></TooltipTrigger>
  <TooltipContent>Tooltip text</TooltipContent>
</Tooltip>
```

Both are dark in both themes. Wrap the app in `TooltipProvider` once.

## Layout components

### Tabs and Accordion

```tsx
<Tabs defaultValue="design">
  <TabsList>
    <TabsTrigger value="design">Design</TabsTrigger>
    <TabsTrigger value="proto">Prototype</TabsTrigger>
  </TabsList>
  <TabsContent value="design">…</TabsContent>
</Tabs>

<Accordion type="single" collapsible>
  <AccordionItem value="advanced">
    <AccordionTrigger>Advanced</AccordionTrigger>
    <AccordionContent>Content here</AccordionContent>
  </AccordionItem>
</Accordion>
```

## Styling

All components accept `className`. Use the `figma-*` color utilities and the layout conventions from the [theming guide](/docs/guides/theming): 24 px rows, 8 px gutters, `border-figma-border` dividers, `text-figma-text-secondary` for secondary copy. Never hard-code a color.

```tsx
<section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">
  <SectionTitle>Actions</SectionTitle>
  <Button className="w-full">Create</Button>
</section>
```
````

- [ ] **Step 2: Build the docs**

Run: `bun run docs:build 2>&1 | grep -E "Compiled|rror|Exited"`
Expected: `✓ Compiled successfully`, `Exited with code 0`. Then the shared verify command.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/content/docs/guides/ui-components.mdx
git commit -m "docs: full component inventory and UI3 usage in the components guide

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Light corrections in the docs site and CONTRIBUTING

**Files:**
- Modify: `apps/docs/content/docs/index.mdx:14,17`
- Modify: `apps/docs/content/docs/getting-started/index.mdx:10`
- Modify: `apps/docs/content/docs/guides/plugin-config.mdx:10-21`
- Modify: `apps/docs/content/docs/guides/architecture.mdx:56`
- Modify: `apps/docs/content/docs/project/contributing.mdx:50`
- Modify: `apps/docs/content/docs/project/versioning.mdx:43`

- [ ] **Step 1: Apply these exact replacements**

| File | Replace | With |
| --- | --- | --- |
| `index.mdx:14` | `- **14+ UI components** that look native in Figma (buttons, inputs, selects, accordions, and more)` | `- **50 UI components** that look native in Figma (buttons, inputs, selects, menus, dialogs, tabs, and more), themed live from Figma's colors` |
| `index.mdx:17` | `- **Automated testing** with 27+ tests` | `- **Automated testing** with more than 130 tests` |
| `getting-started/index.mdx:10` | `(version 1.0 or later)` | `(version 1.4.2 or later)` |
| `architecture.mdx:56` | `two files are created in` | `three files are created in` |
| `project/contributing.mdx:50` | `- bun test suites (90+ tests)` | `- bun test suites (more than 130 tests)` |
| `project/versioning.mdx:43` | `The template is currently at **v1.3.0** (the root \`package.json\` version).` | `The current version is the root \`package.json\` version; each release is also listed in \`packages/ui/CHANGELOG.md\`.` |

- [ ] **Step 2: Manifest snippet in `plugin-config.mdx`**

Replace the code block at lines 10–21 with:

```ts
export default {
  name: "My Plugin Name",
  id: "your-plugin-id-from-figma",
  api: "1.0.0",
  main: "plugin.js",
  ui: "index.html",
  // Required for new plugins: pages load lazily, so use the *Async node lookups
  documentAccess: "dynamic-page",
  // The template makes no network requests; list domains here if yours does
  networkAccess: { allowedDomains: ["none"] },
  capabilities: [],
  enableProposedApi: false,
  editorType: ["figma", "figjam"],
};
```

- [ ] **Step 3: Verify**

```bash
grep -rn "14+\|27+\|90+\|1.0 or later\|turbo run storybook\|two files\|v1.3.0" apps/docs/content CONTRIBUTING.md README.md .claude/CLAUDE.md
```

Expected: no output. Then `bun run docs:build` and the shared verify command.

- [ ] **Step 4: Commit**

```bash
git add apps/docs/content/docs/index.mdx apps/docs/content/docs/getting-started/index.mdx apps/docs/content/docs/guides/plugin-config.mdx apps/docs/content/docs/guides/architecture.mdx apps/docs/content/docs/project/contributing.mdx apps/docs/content/docs/project/versioning.mdx
git commit -m "docs: correct counts, commands, versions and the manifest example

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7b: MCP configuration (added after the Task 7 sweep)

Review finding, confirmed against Claude Code's documentation: settings files cannot define MCP servers; project servers are read from `.mcp.json` at the repository root (with a one-time approval prompt), personal ones from the user's own config via `claude mcp add`. The three "pre-configured" servers in `.claude/settings.json` therefore never loaded. Jonas chose to fix it in this PR: `mcpServers` moved to `.mcp.json` with `"FIGMA_API_KEY": "${FIGMA_API_KEY}"` env expansion, `settings.json` keeps only `enabledPlugins`, `ai/mcp-servers.mdx` and `ai/extending-claude.mdx` were rewritten around `.mcp.json` and `claude mcp add`, and the CLAUDE.md MCP section says where the servers live. Commit `chore: configure the MCP servers in .mcp.json so Claude Code loads them`.

### Task 8: Editor configuration

**Files:**
- Modify: `figma-plugin-template.code-workspace:10,58,61,64,83`
- Modify: `.vscode/launch.json:26-33`

- [ ] **Step 1: Workspace file**

| Line | Replace | With |
| --- | --- | --- |
| 10 | `{ "name": "📕 Storybook", "path": "packages/ui" },` | `{ "name": "📕 Storybook", "path": "apps/storybook" },` |
| 58 | `"${workspaceFolder:🏠 Root}"` | `"${workspaceFolder:🏡 Root}"` |
| 61 | `"packages/ui/src/styles/globals.css"` | `"packages/ui/src/styles.css"` |
| 64 | the whole `"graphql-config.load.filePath": "./apps/app/graphql.config.ts",` line | delete it (and the comma on the previous line if it becomes the last entry in its object) |
| 83 | `"${workspaceFolder:🏠 Root}/cspell.json"` | `"${workspaceFolder:🏡 Root}/cspell.json"` |

- [ ] **Step 2: launch.json**

Delete the whole `"Debug UI (Chrome)"` configuration object (lines 26–33, from `{` through `},`). Three configurations remain.

- [ ] **Step 3: Verify**

```bash
python3 -c "import json,re;s=open('figma-plugin-template.code-workspace').read();json.loads(re.sub(r'//.*','',s));print('workspace json ok')"
python3 -c "import json;d=json.load(open('.vscode/launch.json'));print(len(d['configurations']),'configurations')"
grep -c "🏠" figma-plugin-template.code-workspace
```

Expected: `workspace json ok`, `3 configurations`, `0`. Then the shared verify command.

- [ ] **Step 4: Commit**

```bash
git add figma-plugin-template.code-workspace .vscode/launch.json
git commit -m "chore: fix workspace folder targets and remove the dead UI debug launch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

Review outcome for Task 8: the workspace file kept all its settings at the top level, where VS Code ignores them; a follow-up commit moves them into the `"settings"` object and drops excludes for folders that do not exist (`.swc`, `.devcontainer`, `.cursor`, `docker`, `k8s`).

### Task 9: Biome exclusion, fact-check review, final verification, PR

**Files:**
- Modify: `biome.json` (`files.includes`)

- [ ] **Step 0: Exclude the generated PWA files from Biome**

`bun run docs:build` writes `sw.js`, `workbox-*.js` and `swe-worker-*.js` into `apps/docs/public/`. They are gitignored but Biome still lints them, so `bun run lint` fails with about 70 errors whenever it runs after a docs build (it happened in Tasks 1 and 6). In `biome.json`, inside `files.includes`, after `"!**/bun.lock"` add:

```json
    "!**/public/sw.js",
    "!**/public/sw.js.map",
    "!**/public/workbox-*.js",
    "!**/public/workbox-*.js.map",
    "!**/public/swe-worker-*.js"
```

Verify: `bun run docs:build >/dev/null 2>&1; bun run lint 2>&1 | grep -E "Tasks:|✖|rror"` → `Tasks: 4 successful, 4 total` without deleting anything first. Commit:

```bash
git add biome.json
git commit -m "chore: keep Biome off the generated docs service-worker files

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 1: Fact-check review (controller dispatches a reviewer)**

The reviewer has repo access and verifies every factual claim in the five rewritten files (`theming.mdx`, `.claude/CLAUDE.md`, `README.md`, `SKILL.md`, `references/ui-components.md`) plus `ui-components.mdx` against the code using the "Facts" table commands: counts, scripts, versions, token and utility names, window and manifest values, Storybook groups and story names, Button and Type sizes. Any mismatch is fixed in the docs in a `docs:` commit and re-checked.

- [ ] **Step 2: Full verification**

```bash
bun run lint 2>&1 | grep -E "Tasks:|✖|rror"
bun run docs:build 2>&1 | grep -E "Compiled|rror|Exited"
git status --short
```

Expected: `Tasks: 4 successful, 4 total`; `✓ Compiled successfully` and `Exited with code 0`; clean tree.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin docs/stream-2-drift
gh pr create --base master --title "docs: bring the documentation in line with the Bun and UI3 stack" --body "$(cat <<'PRBODY'
## Summary
- New guide `guides/theming.mdx`: how colors bind to Figma's variables, the `figma-*` utilities, which tokens are static, the UI3 scale, the panel layout, the parity stories
- CLAUDE.md, README and the build-figma-plugin skill rewritten to the shadcn/Tailwind 4/UI3 stack with summaries linking to the guide; the skill now validates with tests and follows the UI3 conventions
- Full 50-component inventory in the components guide and the skill reference
- Corrections: counts, Storybook command, Bun version, manifest fields, build outputs, hard-coded version; workspace and launch config targets

Spec: docs/superpowers/specs/2026-10-29-docs-drift-design.md
Plan: docs/superpowers/plans/2026-10-30-docs-drift.md

## Test plan
- [ ] CI green
- [ ] `bun run docs:build` passes and the theming page is in the Guides navigation
- [ ] Fact-check review found no mismatches against the code

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

---

## Self-review

- **Spec coverage.** Canonical page: Task 1. Summaries and links in CLAUDE.md, README, SKILL.md, the skill reference and the components guide: Tasks 2–6. Light corrections table: Task 7 (every row of the spec's table) and Task 8 (editor config). Verification: Task 9 plus the per-task docs build and lint. Changeset: none, as decided. `frontend-design`: already removed in PR #19; CLAUDE.md's skill sections are left as they are.
- **Placeholders.** None; every step carries the exact text or a replace/with pair.
- **Consistency.** Component counts (46 + 4 = 50), sixteen kit-matched names, icon list, Storybook command, Button and Type sizes and the static-token list are identical across Tasks 1, 2, 3, 5 and 6 and match the Facts table.
