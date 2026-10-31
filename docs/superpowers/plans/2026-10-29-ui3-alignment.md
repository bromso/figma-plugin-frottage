# Figma UI3 Component Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `packages/ui` render like Figma's native UI3 panels, per `docs/superpowers/specs/2026-10-29-ui3-alignment-design.md`: Figma-variable-bound tokens, the kit's 24 px / 11 px / 5 px scale, sixteen component files edited to kit specs, and a Storybook parity story per matched component.

**Architecture:** `styles.css` becomes the single token layer: every shadcn token is `var(--figma-color-*, <kit fallback>)`, a `figma` Tailwind colour namespace exposes the kit tokens shadcn lacks, and `@theme` overrides shrink the global type, radius and weight scales so unmatched components follow for free. Matched components are then edited one commit each with a side-by-side parity story. A manual Figma spike opens the work to capture the real injected variable list.

**Tech Stack:** Tailwind CSS 4 (`@theme`, `@custom-variant`), Radix UI via `radix-ui`, cva, Storybook 10 (react-vite), `bun test` + Testing Library, Figma MCP (`get_screenshot`) for reference PNGs, Inter variable font (OFL) from `@fontsource-variable/inter`.

**Manual steps:** Task 1 (spike) and the sign-off of every parity story need Figma desktop and a human. Everything else is automatable. Subagent sandboxes cannot load native addons, so the controller runs `bun run build` and Storybook builds.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `.gitignore` | modify | ignore `.superpowers/` |
| `packages/ui/src/figma-variables.md` | create (Task 1) | authoritative list of `--figma-*` variables injected by Figma, light and dark |
| `packages/ui/src/assets/fonts/inter-latin-wght-normal.woff2`, `INTER-LICENSE.txt` | create | Inter variable font (Latin subset) inlined by the build |
| `packages/ui/src/styles.css` | rewrite | token layer, scale, font-face, elevation; no component overrides |
| `packages/ui/src/components/ui/{button,input,textarea,checkbox,radio-group,switch,tabs,badge,tooltip,select,dialog,alert-dialog,dropdown-menu,context-menu,menubar,command}.tsx` | modify | kit metrics |
| `packages/ui/src/components/ui/button.test.tsx` | modify | one class assertion |
| `apps/storybook/.storybook/preview.ts` | modify | theme toolbar toggle |
| `apps/storybook/src/stories/UI3/_parity.tsx` | create | `ParityFrame` helper (light + dark + reference PNG) |
| `apps/storybook/src/stories/UI3/refs/*.png` | create | kit reference screenshots |
| `apps/storybook/src/stories/UI3/*.parity.stories.tsx` | create | one per matched component |
| `packages/ui/src/app.tsx` | rewrite | sampler as a Figma panel |
| `apps/design-plugin/src/plugin/plugin.ts` | modify | `showUI` 320 × 480 |
| `.changeset/ui3-alignment.md` | create | minor for `@repo/ui` |

Naming used throughout: CSS custom properties for kit tokens are `--ui3-*` (never `--figma-*`, which Figma owns). Tailwind colour utilities are `*-figma-<token>`, e.g. `bg-figma-bg-secondary`, `text-figma-text-secondary`, `border-figma-border-translucent`. Shadows: `shadow-tooltip`, `shadow-menu`, `shadow-dialog`. Letter-spacing: `tracking-ui3`.

---

### Task 0: Branch and worktree

- [ ] **Step 1: Create the worktree from the spec branch**

```bash
cd <path-to-your-clone>
git worktree add ../figma-plugin-template-ui3 -b feat/ui3-alignment docs/ui3-alignment-spec
cd ../figma-plugin-template-ui3
bun install --frozen-lockfile
```

Expected: install completes; `git branch --show-current` prints `feat/ui3-alignment`.

- [ ] **Step 2: Ignore brainstorm artefacts**

Append to `.gitignore`:

```
# Superpowers brainstorm mockups (local only)
.superpowers/
```

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers brainstorm artefacts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Spike — capture Figma's injected variables and font availability (manual, with Jonas)

**Files:**
- Create: `packages/ui/src/figma-variables.md`

- [ ] **Step 1: Build and run the plugin**

```bash
bun run --filter @repo/design-plugin build
```

In Figma desktop: Plugins → Development → Import plugin from manifest… → `apps/design-plugin/dist/manifest.json` (skip if already imported). Run the plugin with Figma in the **light** theme.

- [ ] **Step 2: Dump the injected variables (light)**

Open Plugins → Development → Show/Hide console. In the console's context dropdown pick the plugin **iframe** (the entry that is not "top"). Paste and run:

```js
(() => {
  const s = document.getElementById("figma-style");
  const css = s ? s.textContent : "";
  const vars = [...css.matchAll(/(--figma-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => `${m[1]}: ${m[2].trim()}`);
  console.log(`THEME=${document.documentElement.className}\nCOUNT=${vars.length}\n${vars.join("\n")}`);
  console.log("FONT Inter 450:", document.fonts.check("450 11px Inter"), "| body font:", getComputedStyle(document.body).fontFamily);
})();
```

Copy the whole output.

- [ ] **Step 3: Repeat in dark**

Switch Figma to the dark theme (Figma menu → Preferences → Theme), re-run the plugin, run the same snippet, copy the output.

- [ ] **Step 4: Write the variables file**

Create `packages/ui/src/figma-variables.md`:

```md
# Variables Figma injects into the plugin iframe

Captured <YYYY-MM-DD> from Figma desktop with `figma.showUI(__html__, { themeColors: true })`.
Source of truth for the fallback values in `styles.css`. Re-capture when Figma changes its theme.

Font check: `document.fonts.check("450 11px Inter")` → <true|false>; body font-family → <value>.

## Light (`html.figma-light`)

<paste the light list, one `--figma-...: value` per line, inside a fenced block>

## Dark (`html.figma-dark`)

<paste the dark list>
```

- [ ] **Step 5: Decide the font**

If the font check printed `false` in Step 2, Inter must be bundled (Task 3 as written). If it printed `true` and the body font resolved to Inter, Task 3 still runs (Storybook and the dev server need the font too) but add a note at the top of the variables file: "Figma's iframe already provides Inter; the bundled copy serves Storybook and local dev."

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/figma-variables.md
git commit -m "docs(ui): record the --figma-* variables injected into the plugin iframe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Reference screenshots from the kit (controller, Figma MCP)

**Files:**
- Create: `apps/storybook/src/stories/UI3/refs/<name>.png` (13 files)

The executor needs the Figma MCP `get_screenshot` tool against file `tumaLvnU1CE6fZgCVc68wb` (session already open as `74987946-35d1-4db3-8801-4ea27a7f419f`; create a new session if expired). If the executor lacks the tool, the controller performs this task.

- [ ] **Step 1: Export each node with `contentsOnly: true`, `maxDimension: 1200`**

| File | Node |
|---|---|
| `button.png` | `2012:48557` |
| `input.png` | `2028:79255` |
| `checkbox.png` | `2012:55461` |
| `radio.png` | `2015:20365` |
| `switch.png` | `2015:24697` |
| `select.png` | `2028:36589` |
| `tabs.png` | `2015:27780` |
| `badge.png` | `2012:35027` |
| `tooltip.png` | `2015:39095` |
| `menu.png` | `2327:96374` |
| `menu-multiselect.png` | `2327:96387` |
| `dialog-320.png` | `2327:134405` |
| `dialog-480.png` | `2327:134403` |

For each, run `curl -f -L -o apps/storybook/src/stories/UI3/refs/<file> "<image_url>"` with the returned URL.

- [ ] **Step 2: Verify and commit**

```bash
ls -la apps/storybook/src/stories/UI3/refs | wc -l   # 13 files + . and ..
file apps/storybook/src/stories/UI3/refs/*.png | grep -c "PNG image"   # 13
git add apps/storybook/src/stories/UI3/refs
git commit -m "chore(storybook): add UI3 kit reference screenshots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Inter variable font

**Files:**
- Create: `packages/ui/src/assets/fonts/inter-latin-wght-normal.woff2`, `packages/ui/src/assets/fonts/INTER-LICENSE.txt`

- [ ] **Step 1: Copy the Latin subset out of the fontsource package without keeping the dependency**

```bash
cd packages/ui
bun add -d @fontsource-variable/inter@5.3.0
mkdir -p src/assets/fonts
cp node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 src/assets/fonts/
cp node_modules/@fontsource-variable/inter/LICENSE src/assets/fonts/INTER-LICENSE.txt
bun remove @fontsource-variable/inter
cd ../..
ls -la packages/ui/src/assets/fonts
git status --short
```

Expected: two new files; the woff2 is roughly 45–110 KB; `package.json` and `bun.lock` show no net change (`git status` lists only the two font files).

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/assets/fonts
git commit -m "feat(ui): bundle Inter variable font (Latin subset)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Token layer — rewrite `styles.css`

**Files:**
- Rewrite: `packages/ui/src/styles.css`

- [ ] **Step 1: Replace the whole file**

```css
@import "tailwindcss";
@import "tw-animate-css";

/* Tailwind v4 content scan, relative to this file. The build runs from
   apps/design-plugin, so the default auto-detection would miss these sources. */
@source ".";

/* Dark mode: `.dark` for Storybook/tests, `html.figma-dark` is what Figma sets
   on the plugin iframe when showUI runs with themeColors: true. */
@custom-variant dark (&:where(.dark, .dark *, html.figma-dark, html.figma-dark *));

/* Inter variable (Latin subset, OFL). Figma's iframe does not inherit Figma's
   fonts; UI3 weights 450/550 need the variable font. Inlined by the Bun build. */
@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("./assets/fonts/inter-latin-wght-normal.woff2") format("woff2-variations");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* ============================================================
   UI3 tokens. Each binds to the variable Figma injects
   (--figma-color-*) with the kit's value as fallback, so inside
   Figma colours track the user's theme live and outside Figma
   (Storybook, tests) the fallback palette applies.
   Never define --figma-color-* here: Figma owns those names.
   Fallback values: packages/ui/src/figma-variables.md (Task 1).
   ============================================================ */
:root {
  /* surfaces */
  --ui3-bg: var(--figma-color-bg, #ffffff);
  --ui3-bg-secondary: var(--figma-color-bg-secondary, #f5f5f5);
  --ui3-bg-tertiary: var(--figma-color-bg-tertiary, #e6e6e6);
  --ui3-bg-hover: var(--figma-color-bg-hover, #f5f5f5);
  --ui3-bg-pressed: var(--figma-color-bg-pressed, #e6e6e6);
  --ui3-bg-selected: var(--figma-color-bg-selected, #e5f4ff);
  --ui3-bg-disabled: var(--figma-color-bg-disabled, #f0f0f0);
  --ui3-bg-brand: var(--figma-color-bg-brand, #0d99ff);
  --ui3-bg-brand-hover: var(--figma-color-bg-brand-hover, #0c8ce9);
  --ui3-bg-brand-pressed: var(--figma-color-bg-brand-pressed, #007be5);
  --ui3-bg-danger: var(--figma-color-bg-danger, #f24822);
  --ui3-bg-danger-hover: var(--figma-color-bg-danger-hover, #dc3412);
  --ui3-bg-menu: var(--figma-color-bg-menu, #1e1e1e);
  --ui3-bg-menu-hover: var(--figma-color-bg-menu-hover, #383838);
  --ui3-bg-menu-selected: var(--figma-color-bg-menu-selected, #0d99ff);
  --ui3-bg-tooltip: var(--figma-color-bg-tooltip, #1e1e1e);
  /* text */
  --ui3-text: var(--figma-color-text, rgba(0, 0, 0, 0.9));
  --ui3-text-secondary: var(--figma-color-text-secondary, rgba(0, 0, 0, 0.5));
  --ui3-text-tertiary: var(--figma-color-text-tertiary, rgba(0, 0, 0, 0.3));
  --ui3-text-disabled: var(--figma-color-text-disabled, rgba(0, 0, 0, 0.3));
  --ui3-text-brand: var(--figma-color-text-brand, #007be5);
  --ui3-text-onbrand: var(--figma-color-text-onbrand, #ffffff);
  --ui3-text-danger: var(--figma-color-text-danger, #dc3412);
  --ui3-text-ondanger: var(--figma-color-text-ondanger, #ffffff);
  --ui3-text-menu: var(--figma-color-text-menu, #ffffff);
  --ui3-text-menu-secondary: var(--figma-color-text-menu-secondary, rgba(255, 255, 255, 0.7));
  --ui3-text-tooltip: var(--figma-color-text-tooltip, #ffffff);
  --ui3-text-tooltip-secondary: var(--figma-color-text-tooltip-secondary, rgba(255, 255, 255, 0.7));
  /* borders */
  --ui3-border: var(--figma-color-border, #e6e6e6);
  --ui3-border-translucent: var(--figma-color-border-translucent, rgba(0, 0, 0, 0.1));
  --ui3-border-strong: var(--figma-color-border-strong, rgba(0, 0, 0, 0.8));
  --ui3-border-selected: var(--figma-color-border-selected, #0d99ff);
  --ui3-border-selected-strong: var(--figma-color-border-selected-strong, #007be5);
  --ui3-border-danger: var(--figma-color-border-danger, #f24822);
  --ui3-border-menu: var(--figma-color-border-menu, #383838);
  /* icons */
  --ui3-icon: var(--figma-color-icon, rgba(0, 0, 0, 0.9));
  --ui3-icon-secondary: var(--figma-color-icon-secondary, rgba(0, 0, 0, 0.5));
  --ui3-icon-brand: var(--figma-color-icon-brand, #007be5);
  --ui3-icon-onbrand: var(--figma-color-icon-onbrand, #ffffff);
  --ui3-icon-menu: var(--figma-color-icon-menu, #ffffff);

  /* shadcn tokens → UI3 */
  --background: var(--ui3-bg);
  --foreground: var(--ui3-text);
  --card: var(--ui3-bg);
  --card-foreground: var(--ui3-text);
  --popover: var(--ui3-bg);
  --popover-foreground: var(--ui3-text);
  --primary: var(--ui3-bg-brand);
  --primary-foreground: var(--ui3-text-onbrand);
  --secondary: var(--ui3-bg-secondary);
  --secondary-foreground: var(--ui3-text);
  --muted: var(--ui3-bg-secondary);
  --muted-foreground: var(--ui3-text-secondary);
  --accent: var(--ui3-bg-hover);
  --accent-foreground: var(--ui3-text);
  --destructive: var(--ui3-bg-danger);
  --destructive-foreground: var(--ui3-text-ondanger);
  --border: var(--ui3-border);
  --input: var(--ui3-bg-secondary);
  --ring: var(--ui3-border-selected);
  --sidebar: var(--ui3-bg-secondary);
  --sidebar-foreground: var(--ui3-text);
  --sidebar-border: var(--ui3-border);
  --chart-1: #0d99ff;
  --chart-2: #14ae5c;
  --chart-3: #ffcd29;
  --chart-4: #9747ff;
  --chart-5: #f24822;
  --radius: 5px;
}

/* Dark fallbacks (Storybook/tests). Inside Figma the injected values win. */
.dark,
html.figma-dark {
  --ui3-bg: var(--figma-color-bg, #2c2c2c);
  --ui3-bg-secondary: var(--figma-color-bg-secondary, #383838);
  --ui3-bg-tertiary: var(--figma-color-bg-tertiary, #444444);
  --ui3-bg-hover: var(--figma-color-bg-hover, #383838);
  --ui3-bg-pressed: var(--figma-color-bg-pressed, #444444);
  --ui3-bg-selected: var(--figma-color-bg-selected, #394360);
  --ui3-bg-disabled: var(--figma-color-bg-disabled, #383838);
  --ui3-bg-brand: var(--figma-color-bg-brand, #0c8ce9);
  --ui3-bg-brand-hover: var(--figma-color-bg-brand-hover, #0a6dc2);
  --ui3-bg-brand-pressed: var(--figma-color-bg-brand-pressed, #0a6dc2);
  --ui3-bg-danger: var(--figma-color-bg-danger, #f24822);
  --ui3-bg-danger-hover: var(--figma-color-bg-danger-hover, #dc3412);
  --ui3-bg-menu: var(--figma-color-bg-menu, #1e1e1e);
  --ui3-bg-menu-hover: var(--figma-color-bg-menu-hover, #383838);
  --ui3-bg-menu-selected: var(--figma-color-bg-menu-selected, #0c8ce9);
  --ui3-bg-tooltip: var(--figma-color-bg-tooltip, #1e1e1e);
  --ui3-text: var(--figma-color-text, #ffffff);
  --ui3-text-secondary: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.7));
  --ui3-text-tertiary: var(--figma-color-text-tertiary, rgba(255, 255, 255, 0.4));
  --ui3-text-disabled: var(--figma-color-text-disabled, rgba(255, 255, 255, 0.4));
  --ui3-text-brand: var(--figma-color-text-brand, #7cc4f8);
  --ui3-text-onbrand: var(--figma-color-text-onbrand, #ffffff);
  --ui3-text-danger: var(--figma-color-text-danger, #ffafa3);
  --ui3-text-ondanger: var(--figma-color-text-ondanger, #ffffff);
  --ui3-text-menu: var(--figma-color-text-menu, #ffffff);
  --ui3-text-menu-secondary: var(--figma-color-text-menu-secondary, rgba(255, 255, 255, 0.7));
  --ui3-text-tooltip: var(--figma-color-text-tooltip, #ffffff);
  --ui3-text-tooltip-secondary: var(--figma-color-text-tooltip-secondary, rgba(255, 255, 255, 0.7));
  --ui3-border: var(--figma-color-border, #444444);
  --ui3-border-translucent: var(--figma-color-border-translucent, rgba(255, 255, 255, 0.1));
  --ui3-border-strong: var(--figma-color-border-strong, #e6e6e6);
  --ui3-border-selected: var(--figma-color-border-selected, #0c8ce9);
  --ui3-border-selected-strong: var(--figma-color-border-selected-strong, #0c8ce9);
  --ui3-border-danger: var(--figma-color-border-danger, #f24822);
  --ui3-border-menu: var(--figma-color-border-menu, #383838);
  --ui3-icon: var(--figma-color-icon, #ffffff);
  --ui3-icon-secondary: var(--figma-color-icon-secondary, rgba(255, 255, 255, 0.7));
  --ui3-icon-brand: var(--figma-color-icon-brand, #7cc4f8);
  --ui3-icon-onbrand: var(--figma-color-icon-onbrand, #ffffff);
  --ui3-icon-menu: var(--figma-color-icon-menu, #ffffff);
  --chart-1: #0c8ce9;
  --chart-2: #14ae5c;
  --chart-3: #ffcd29;
  --chart-4: #9747ff;
  --chart-5: #f24822;
}

@theme inline {
  /* shadcn colour tokens */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  /* figma namespace: kit tokens shadcn lacks → bg-figma-bg-secondary etc. */
  --color-figma-bg: var(--ui3-bg);
  --color-figma-bg-secondary: var(--ui3-bg-secondary);
  --color-figma-bg-tertiary: var(--ui3-bg-tertiary);
  --color-figma-bg-hover: var(--ui3-bg-hover);
  --color-figma-bg-pressed: var(--ui3-bg-pressed);
  --color-figma-bg-selected: var(--ui3-bg-selected);
  --color-figma-bg-disabled: var(--ui3-bg-disabled);
  --color-figma-bg-brand: var(--ui3-bg-brand);
  --color-figma-bg-brand-hover: var(--ui3-bg-brand-hover);
  --color-figma-bg-brand-pressed: var(--ui3-bg-brand-pressed);
  --color-figma-bg-danger: var(--ui3-bg-danger);
  --color-figma-bg-danger-hover: var(--ui3-bg-danger-hover);
  --color-figma-bg-menu: var(--ui3-bg-menu);
  --color-figma-bg-menu-hover: var(--ui3-bg-menu-hover);
  --color-figma-bg-menu-selected: var(--ui3-bg-menu-selected);
  --color-figma-bg-tooltip: var(--ui3-bg-tooltip);
  --color-figma-text: var(--ui3-text);
  --color-figma-text-secondary: var(--ui3-text-secondary);
  --color-figma-text-tertiary: var(--ui3-text-tertiary);
  --color-figma-text-disabled: var(--ui3-text-disabled);
  --color-figma-text-brand: var(--ui3-text-brand);
  --color-figma-text-onbrand: var(--ui3-text-onbrand);
  --color-figma-text-danger: var(--ui3-text-danger);
  --color-figma-text-ondanger: var(--ui3-text-ondanger);
  --color-figma-text-menu: var(--ui3-text-menu);
  --color-figma-text-menu-secondary: var(--ui3-text-menu-secondary);
  --color-figma-text-tooltip: var(--ui3-text-tooltip);
  --color-figma-text-tooltip-secondary: var(--ui3-text-tooltip-secondary);
  --color-figma-border: var(--ui3-border);
  --color-figma-border-translucent: var(--ui3-border-translucent);
  --color-figma-border-strong: var(--ui3-border-strong);
  --color-figma-border-selected: var(--ui3-border-selected);
  --color-figma-border-selected-strong: var(--ui3-border-selected-strong);
  --color-figma-border-danger: var(--ui3-border-danger);
  --color-figma-border-menu: var(--ui3-border-menu);
  --color-figma-icon: var(--ui3-icon);
  --color-figma-icon-secondary: var(--ui3-icon-secondary);
  --color-figma-icon-brand: var(--ui3-icon-brand);
  --color-figma-icon-onbrand: var(--ui3-icon-onbrand);
  --color-figma-icon-menu: var(--ui3-icon-menu);

  /* radii: controls 5 px, panels 13 px */
  --radius-sm: 2px;
  --radius-md: 5px;
  --radius-lg: 5px;
  --radius-xl: 13px;
  --radius-2xl: 13px;

  /* UI3 type scale (px, so the 16 px rem base and 4 px spacing grid are untouched) */
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --text-xs: 9px;
  --text-xs--line-height: 12px;
  --text-sm: 11px;
  --text-sm--line-height: 16px;
  --text-base: 11px;
  --text-base--line-height: 16px;
  --text-lg: 13px;
  --text-lg--line-height: 20px;
  --text-xl: 15px;
  --text-xl--line-height: 24px;
  --font-weight-normal: 400;
  --font-weight-medium: 450;
  --font-weight-semibold: 550;
  --font-weight-bold: 600;
  --tracking-ui3: 0.005em;

  /* elevation (from the kit) */
  --shadow-tooltip: 0 1px 3px rgba(0, 0, 0, 0.1), 0 5px 12px rgba(0, 0, 0, 0.13), 0 0 0.5px rgba(0, 0, 0, 0.15);
  --shadow-menu: 0 2px 5px rgba(0, 0, 0, 0.15), 0 10px 16px rgba(0, 0, 0, 0.12), 0 0 0.5px rgba(0, 0, 0, 0.12);
  --shadow-dialog: 0 2px 14px rgba(0, 0, 0, 0.15), 0 0 0 0.5px rgba(0, 0, 0, 0.2);
}

@layer base {
  html {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  body {
    margin: 0;
    background: var(--color-background);
    color: var(--color-foreground);
    font-size: var(--text-sm);
    line-height: var(--text-sm--line-height);
    font-weight: var(--font-weight-medium);
    letter-spacing: var(--tracking-ui3);
  }
  * {
    border-color: var(--color-border);
  }
}
```

- [ ] **Step 2: Correct fallbacks from the spike**

Open `packages/ui/src/figma-variables.md`. For every `--ui3-*` line above whose `--figma-color-*` name does not appear in the captured list, either rename to the name Figma actually uses (if an equivalent exists, e.g. `--figma-color-border-translucent` may not exist while `--figma-color-bordertranslucent` does) or leave the fallback as the only source and add a trailing comment `/* not injected by Figma */`. Replace fallback hex values with the captured light and dark values where they differ.

- [ ] **Step 3: Verify tests, types, lint and a build**

```bash
bun run test 2>&1 | grep -E " pass| fail"
bun run types 2>&1 | grep -E "Tasks:|error"
bun run lint 2>&1 | grep -E "Tasks:|error"
```

Expected: 90 pass / 1 skip / 0 fail for ui, 2 pass for common; types 3/3; lint 4/4. Then the controller runs:

```bash
bun run --filter @repo/design-plugin build && wc -c apps/design-plugin/dist/index.html && grep -c "font/woff2;base64" apps/design-plugin/dist/index.html
```

Expected: build succeeds; `index.html` grew by roughly the woff2 size; the font is inlined (count ≥ 1). If the count is 0, the Bun standalone build did not inline the CSS `url()`. Report BLOCKED with the build output; the controller decides between committing a base64 `data:` URI as the `src` in `styles.css` or dropping the bundled font.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/styles.css
git commit -m "feat(ui): UI3 token layer bound to Figma's injected variables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Storybook theme toggle and parity helper

**Files:**
- Modify: `apps/storybook/.storybook/preview.ts`
- Create: `apps/storybook/src/stories/UI3/_parity.tsx`

- [ ] **Step 1: Replace `preview.ts`**

```ts
import type { Preview } from "storybook";
import "@repo/ui/styles.css";

const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Figma theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, context) => {
      const dark = context.globals.theme === "dark";
      document.documentElement.classList.toggle("dark", dark);
      document.body.style.background = "var(--color-background)";
      return Story();
    },
  ],
  parameters: {
    viewport: {
      viewports: {
        figmaSmall: { name: "Figma Plugin Small (300x200)", styles: { width: "300px", height: "200px" } },
        figmaMedium: { name: "Figma Plugin Medium (320x500)", styles: { width: "320px", height: "500px" } },
        figmaLarge: { name: "Figma Plugin Large (400x600)", styles: { width: "400px", height: "600px" } },
      },
    },
  },
};

export default preview;
```

- [ ] **Step 2: Create the parity helper**

`apps/storybook/src/stories/UI3/_parity.tsx`:

```tsx
import type { ReactNode } from "react";

type ParityFrameProps = {
  /** Component rendered twice, once per theme. Use inline (non-portaled) states here. */
  children: ReactNode;
  /** Reference PNG imported from ./refs */
  reference: string;
  /** What the reference shows, e.g. "Button set: variants × states" */
  caption: string;
  /** Set when the component portals (menus, tooltips, dialogs): the dark column is omitted and the toolbar toggle is used instead. */
  portaled?: boolean;
};

const col = "flex min-w-[240px] flex-col gap-2 rounded-xl p-4";

export function ParityFrame({ children, reference, caption, portaled }: ParityFrameProps) {
  return (
    <div className="flex flex-wrap items-start gap-6 font-sans text-sm text-foreground">
      <div className={`${col} bg-figma-bg ring-1 ring-figma-border`}>
        <span className="text-figma-text-secondary">Light</span>
        {children}
      </div>
      {!portaled && (
        <div className={`dark ${col} bg-figma-bg ring-1 ring-figma-border`}>
          <span className="text-figma-text-secondary">Dark</span>
          {children}
        </div>
      )}
      <figure className="m-0 flex max-w-[560px] flex-col gap-2">
        <img src={reference} alt={caption} className="max-w-full rounded-md ring-1 ring-figma-border" />
        <figcaption className="text-figma-text-secondary">Kit reference: {caption}</figcaption>
      </figure>
      {portaled && (
        <p className="basis-full text-figma-text-secondary">
          This component portals to the body; switch the Theme toolbar to compare dark.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke the Storybook build (controller)**

```bash
bunx turbo run build-storybook --filter=@repo/storybook 2>&1 | grep -E "Tasks:|error"
```

Expected: 1 successful. (No story uses the helper yet; this proves `preview.ts` compiles.)

- [ ] **Step 4: Commit**

```bash
git add apps/storybook/.storybook/preview.ts apps/storybook/src/stories/UI3/_parity.tsx
git commit -m "feat(storybook): theme toolbar toggle and UI3 parity frame

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Component tasks

Every component task follows the same shape: edit the file, run `bun test` and `tsc` in `packages/ui`, add the parity story, commit. Reference PNGs come from Task 2. Stories import `ParityFrame` from `./_parity` and PNGs via `import ref from "./refs/<name>.png"` (Vite handles the asset).

Shared verify command, run from `packages/ui`:

```bash
bun --bun x tsc --noEmit && bun test 2>&1 | grep -E " pass| fail"
```

Expected after each task: `0 fail` (pass count unchanged unless the task edits a test).

---

### Task 6: Button

**Files:**
- Rewrite: `packages/ui/src/components/ui/button.tsx`
- Modify: `packages/ui/src/components/ui/button.test.tsx:28`
- Create: `apps/storybook/src/stories/UI3/Button.parity.stories.tsx`

- [ ] **Step 1: Update the test first (it asserts the outline class)**

In `button.test.tsx` line 28 change

```ts
    expect(btn.className).toContain("border-border");
```

to

```ts
    expect(btn.className).toContain("border-figma-border-translucent");
```

Run `cd packages/ui && bun test src/components/ui/button.test.tsx; cd ../..` → expected: that test FAILS (old class still present).

- [ ] **Step 2: Replace `button.tsx`**

```tsx
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

/**
 * UI3 button: 24 px default / 32 px large, 5 px radius, body/medium type.
 * Kit refs: Primary 2012:48558, Secondary 2012:48574.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-transparent text-sm font-medium tracking-ui3 whitespace-nowrap transition-colors outline-none select-none focus-visible:border-figma-border-selected disabled:pointer-events-none disabled:border-transparent disabled:bg-figma-bg-disabled disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-figma-bg-brand-hover active:bg-figma-bg-brand-pressed focus-visible:border-figma-border-selected-strong",
        secondary:
          "border-figma-border-translucent bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed",
        outline:
          "border-figma-border-translucent bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed",
        ghost:
          "bg-transparent text-foreground hover:bg-figma-bg-hover active:bg-figma-bg-pressed aria-expanded:bg-figma-bg-pressed",
        destructive:
          "bg-figma-bg-danger text-figma-text-ondanger hover:bg-figma-bg-danger-hover focus-visible:border-figma-border-danger",
        link: "text-figma-text-brand underline-offset-2 hover:underline",
      },
      size: {
        default: "h-6 px-2",
        sm: "h-5 px-1.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        xs: "h-5 px-1.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 px-3",
        icon: "size-6",
        "icon-sm": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-xs": "size-5 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export { Button, type ButtonProps, buttonVariants };
```

- [ ] **Step 3: Verify**

Run the shared verify command. Expected: button test passes again; `0 fail`.

- [ ] **Step 4: Parity story**

`apps/storybook/src/stories/UI3/Button.parity.stories.tsx`:

```tsx
import { Button } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { StarIcon } from "lucide-react";
import { ParityFrame } from "./_parity";
import ref from "./refs/button.png";

const meta = { title: "UI3/Button", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Button set: Primary, Secondary, FigJam, Danger… × Default/Active/Focused/Disabled, with icon-lead and large">
      <div className="flex flex-wrap gap-2">
        <Button>Button</Button>
        <Button variant="secondary">Button</Button>
        <Button variant="ghost">Button</Button>
        <Button variant="destructive">Button</Button>
        <Button disabled>Button</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button><StarIcon />Button</Button>
        <Button variant="secondary"><StarIcon />Button</Button>
        <Button size="icon" variant="secondary" aria-label="Star"><StarIcon /></Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="lg">Button</Button>
        <Button size="lg" variant="secondary">Button</Button>
        <Button size="sm">Button</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="w-full">Wide button</Button>
      </div>
    </ParityFrame>
  ),
};
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ui/button.tsx packages/ui/src/components/ui/button.test.tsx apps/storybook/src/stories/UI3/Button.parity.stories.tsx
git commit -m "feat(ui): UI3 button metrics and variants

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Input and Textarea

**Files:**
- Rewrite: `packages/ui/src/components/ui/input.tsx`, `packages/ui/src/components/ui/textarea.tsx`
- Create: `apps/storybook/src/stories/UI3/Input.parity.stories.tsx`

- [ ] **Step 1: Replace `input.tsx`**

```tsx
import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

/** UI3 text input: 24 px, filled bg-secondary, no border; 1 px blue border on focus. Kit refs 2028:79256 (default), 2028:79258 (focus), 2028:79301 (large). */
function Input({
  className,
  type,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { size?: "default" | "lg" }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "w-full min-w-0 rounded-md border border-transparent bg-figma-bg-secondary px-2 text-sm font-medium tracking-ui3 text-foreground transition-colors outline-none data-[size=default]:h-6 data-[size=lg]:h-8 file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-figma-text-secondary hover:border-figma-border focus-visible:border-figma-border-selected disabled:pointer-events-none disabled:border-figma-border-translucent disabled:bg-transparent disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Input };
```

- [ ] **Step 2: Replace `textarea.tsx`**

```tsx
import { cn } from "@repo/ui/lib/utils";
import type * as React from "react";

/** UI3 multi-line input: same surface and states as Input, grows in 16 px line steps. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-transparent bg-figma-bg-secondary px-2 py-1 text-sm font-medium tracking-ui3 text-foreground transition-colors outline-none placeholder:text-figma-text-secondary hover:border-figma-border focus-visible:border-figma-border-selected disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:bg-transparent disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
```

- [ ] **Step 3: Verify** (shared command; `input.test.tsx` and `textarea.test.tsx` assert behaviour only).

- [ ] **Step 4: Parity story**

`apps/storybook/src/stories/UI3/Input.parity.stories.tsx`:

```tsx
import { Input, Textarea } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/input.png";

const meta = { title: "UI3/Input", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Text input: Default, Focus, Active, Empty, Disabled; with icon; large; multi-line">
      <Input defaultValue="Text, Default" />
      <Input defaultValue="Text, Focus" autoFocus />
      <Input placeholder="Text, Empty" />
      <Input defaultValue="Text, Disabled" disabled />
      <Input size="lg" defaultValue="Text, Large" />
      <Textarea defaultValue={"Multi-line value.\nGrows in line height increments"} />
    </ParityFrame>
  ),
};
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ui/input.tsx packages/ui/src/components/ui/textarea.tsx apps/storybook/src/stories/UI3/Input.parity.stories.tsx
git commit -m "feat(ui): UI3 text input and textarea

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Checkbox

**Files:**
- Rewrite: `packages/ui/src/components/ui/checkbox.tsx`
- Create: `apps/storybook/src/stories/UI3/Checkbox.parity.stories.tsx`

- [ ] **Step 1: Replace `checkbox.tsx`**

```tsx
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** UI3 checkbox: 16 px, 5 px radius, strong border; checked = brand fill + border-selected-strong. Kit ref 2012:55462. */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-md border border-figma-border-strong bg-background text-primary-foreground transition-colors outline-none after:absolute after:-inset-1 focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:bg-figma-bg-disabled disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger data-checked:border-figma-border-selected-strong data-checked:bg-primary data-[state=indeterminate]:border-figma-border-selected-strong data-[state=indeterminate]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3 [&>svg]:stroke-[2.5]"
      >
        {props.checked === "indeterminate" ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
```

- [ ] **Step 2: Verify** (shared command).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Checkbox.parity.stories.tsx`:

```tsx
import { Checkbox, Label } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/checkbox.png";

const meta = { title: "UI3/Checkbox", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

const Row = ({ id, label, ...p }: { id: string; label: string } & React.ComponentProps<typeof Checkbox>) => (
  <div className="flex h-6 items-center gap-2">
    <Checkbox id={id} {...p} />
    <Label htmlFor={id}>{label}</Label>
  </div>
);

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Checkbox: Checked / Unchecked / Mixed × Default / Focused / Disabled, with label and description">
      <Row id="c1" label="On, Normal" defaultChecked />
      <Row id="c2" label="Off, Normal" />
      <Row id="c3" label="Mixed" checked="indeterminate" />
      <Row id="c4" label="On, Disabled" defaultChecked disabled />
      <Row id="c5" label="Off, Disabled" disabled />
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/checkbox.tsx apps/storybook/src/stories/UI3/Checkbox.parity.stories.tsx
git commit -m "feat(ui): UI3 checkbox

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: RadioGroup

**Files:**
- Rewrite: `packages/ui/src/components/ui/radio-group.tsx`
- Create: `apps/storybook/src/stories/UI3/Radio.parity.stories.tsx`

The kit's radio (`2015:20366`) uses `light/border/default/strong` (#2c2c2c) for the ring and a dot in the text colour — it is not brand blue.

- [ ] **Step 1: Replace `radio-group.tsx`**

```tsx
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid w-full gap-0", className)}
      {...props}
    />
  );
}

/** UI3 radio: 16 px circle, strong 1 px border; selected shows a 6 px dot in the text colour. Kit ref 2015:20366. */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-figma-border-strong bg-background outline-none after:absolute after:-inset-1 focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:bg-figma-bg-disabled aria-invalid:border-figma-border-danger",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-full items-center justify-center"
      >
        <span className="size-1.5 rounded-full bg-foreground group-disabled/radio-group-item:bg-figma-text-disabled" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
```

- [ ] **Step 2: Verify** (shared command).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Radio.parity.stories.tsx`:

```tsx
import { Label, RadioGroup, RadioGroupItem } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/radio.png";

const meta = { title: "UI3/Radio", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Radio button: On / Off × Default / Focused, with labels">
      <RadioGroup defaultValue="a">
        {["a", "b", "c"].map((v) => (
          <div key={v} className="flex h-6 items-center gap-2">
            <RadioGroupItem value={v} id={`r-${v}`} />
            <Label htmlFor={`r-${v}`}>Option {v.toUpperCase()}</Label>
          </div>
        ))}
        <div className="flex h-6 items-center gap-2">
          <RadioGroupItem value="d" id="r-d" disabled />
          <Label htmlFor="r-d">Disabled</Label>
        </div>
      </RadioGroup>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/radio-group.tsx apps/storybook/src/stories/UI3/Radio.parity.stories.tsx
git commit -m "feat(ui): UI3 radio group

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Switch

**Files:**
- Rewrite: `packages/ui/src/components/ui/switch.tsx`
- Create: `apps/storybook/src/stories/UI3/Switch.parity.stories.tsx`

- [ ] **Step 1: Replace `switch.tsx`**

```tsx
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * UI3 switch: 32 × 16 track, 14 px knob with 1 px inset. On = brand fill, white knob.
 * Off = outlined track and knob in the strong border colour. Kit ref 2015:24698.
 */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border transition-colors outline-none after:absolute after:-inset-1 focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[size=default]:h-4 data-[size=default]:w-8 data-[size=sm]:h-3 data-[size=sm]:w-6 data-checked:border-transparent data-checked:bg-primary data-unchecked:border-figma-border-strong data-unchecked:bg-background data-disabled:cursor-not-allowed data-disabled:border-figma-border-translucent data-disabled:bg-figma-bg-disabled",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full transition-transform group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 data-checked:bg-figma-icon-onbrand data-unchecked:bg-background data-unchecked:ring-1 data-unchecked:ring-inset data-unchecked:ring-figma-border-strong group-data-disabled/switch:data-unchecked:ring-figma-border-translucent group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-3 group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
```

- [ ] **Step 2: Verify** (shared command).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Switch.parity.stories.tsx`:

```tsx
import { Label, Switch } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/switch.png";

const meta = { title: "UI3/Switch", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

const Row = ({ id, label, ...p }: { id: string; label: string } & React.ComponentProps<typeof Switch>) => (
  <div className="flex h-6 items-center gap-2">
    <Switch id={id} {...p} />
    <Label htmlFor={id}>{label}</Label>
  </div>
);

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Switch: On / Off / Mixed × Default / Focused / Disabled">
      <Row id="s1" label="On, Normal" defaultChecked />
      <Row id="s2" label="Off, Normal" />
      <Row id="s3" label="On, Disabled" defaultChecked disabled />
      <Row id="s4" label="Off, Disabled" disabled />
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/switch.tsx apps/storybook/src/stories/UI3/Switch.parity.stories.tsx
git commit -m "feat(ui): UI3 switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Select (trigger + dark menu content)

**Files:**
- Modify: `packages/ui/src/components/ui/select.tsx` (five class strings and the trigger chevron)
- Create: `apps/storybook/src/stories/UI3/Select.parity.stories.tsx`

- [ ] **Step 1: `SelectTrigger`** — change the `size` type to `"sm" | "default" | "lg"`, replace the className string with:

```
"flex w-fit items-center justify-between rounded-md border border-figma-border bg-background pl-2 pr-0 text-sm font-medium tracking-ui3 whitespace-nowrap transition-colors outline-none select-none hover:border-figma-border-strong focus-visible:border-figma-border-selected disabled:cursor-not-allowed disabled:border-figma-border-translucent disabled:text-figma-text-disabled aria-invalid:border-figma-border-danger data-placeholder:text-figma-text-secondary h-6 data-[size=lg]:h-8 data-[size=sm]:h-5 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
```

and replace the icon block with a 24 px slot:

```tsx
      <SelectPrimitive.Icon asChild>
        <span className="flex size-6 shrink-0 items-center justify-center text-figma-icon">
          <ChevronDownIcon className="size-4" />
        </span>
      </SelectPrimitive.Icon>
```

- [ ] **Step 2: `SelectContent`** — replace the first className string with:

```
"relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-figma-bg-menu py-2 text-figma-text-menu shadow-menu duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
```

- [ ] **Step 3: `SelectGroup`** className → `"scroll-my-1 p-0"`. **`SelectLabel`** className → `"flex h-6 items-center px-4 text-sm text-figma-text-menu-secondary"`.

- [ ] **Step 4: `SelectItem`** — replace the className string with:

```
"relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md py-0 pr-2 pl-6 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2"
```

and move the indicator to the left: change `"pointer-events-none absolute right-2 flex size-4 items-center justify-center"` to `"pointer-events-none absolute left-1 flex size-4 items-center justify-center"`.

- [ ] **Step 5: `SelectSeparator`** className → `"pointer-events-none my-2 h-px bg-figma-border-menu"`. **`SelectScrollUpButton` / `SelectScrollDownButton`** replace `bg-popover` with `bg-figma-bg-menu text-figma-icon-menu`.

- [ ] **Step 6: Verify** (shared command; `select.test.tsx` asserts behaviour).

- [ ] **Step 7: Parity story**

`apps/storybook/src/stories/UI3/Select.parity.stories.tsx`:

```tsx
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/select.png";

const meta = { title: "UI3/Select", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame portaled reference={ref} caption="Dropdown: Default / Focused / Active / Disabled, default and large, with icon lead">
      <Select defaultValue="a">
        <SelectTrigger className="w-[117px]"><SelectValue placeholder="Value" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Value</SelectItem>
          <SelectItem value="b">Second value</SelectItem>
          <SelectSeparator />
          <SelectItem value="c">Third value</SelectItem>
        </SelectContent>
      </Select>
      <Select><SelectTrigger className="w-[117px]"><SelectValue placeholder="Placeholder" /></SelectTrigger><SelectContent><SelectItem value="x">X</SelectItem></SelectContent></Select>
      <Select disabled defaultValue="a"><SelectTrigger className="w-[117px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">Disabled</SelectItem></SelectContent></Select>
      <Select defaultValue="a"><SelectTrigger size="lg" className="w-[117px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">Large</SelectItem></SelectContent></Select>
    </ParityFrame>
  ),
};
```

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/ui/select.tsx apps/storybook/src/stories/UI3/Select.parity.stories.tsx
git commit -m "feat(ui): UI3 select trigger and dark menu list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Tabs

**Files:**
- Rewrite: `packages/ui/src/components/ui/tabs.tsx`
- Create: `apps/storybook/src/stories/UI3/Tabs.parity.stories.tsx`

- [ ] **Step 1: Replace `tabs.tsx`**

```tsx
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

/**
 * UI3 tabs: pills, 24 px, 8 px padding, 4 px gap; selected = bg-secondary + strong weight,
 * unselected = transparent + secondary text. `line` keeps an underline indicator for the
 * title-bar style used in Figma's left sidebar. Kit refs 2015:27784, _Tab 2015:27759/27765.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center gap-1 text-figma-text-secondary group-data-horizontal/tabs:h-6 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "",
        line: "gap-0 border-b border-figma-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-6 items-center justify-center gap-1 rounded-md border border-transparent px-2 text-sm font-medium tracking-ui3 whitespace-nowrap text-figma-text-secondary transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:bg-figma-bg-hover hover:text-foreground focus-visible:border-figma-border-selected focus-visible:ring-1 focus-visible:ring-figma-border-selected focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:text-figma-text-disabled data-active:bg-figma-bg-secondary data-active:font-semibold data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:hover:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:inset-x-2 group-data-[variant=line]/tabs-list:after:-bottom-px group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:bg-foreground group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
```

- [ ] **Step 2: Verify** (shared command; `tabs.test.tsx` asserts behaviour).

Review outcome: the `line` list gets `group-data-horizontal/tabs:h-auto` and the indicator `after:-bottom-[2px]` so the 2 px bar sits on the divider; `data-active:hover:bg-figma-bg-secondary` keeps the selected pill's fill on hover. The pre-UI3 vertical `line` indicator (side rail) is dropped on purpose: it is not a UI3 pattern and no consumer uses it, so the component comment states `line` is horizontal only.

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Tabs.parity.stories.tsx`:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/tabs.png";

const meta = { title: "UI3/Tabs", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Tabs: 1–4 tabs; selected / unselected / hover / focused">
      <Tabs defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">Active tab</TabsTrigger>
          <TabsTrigger value="proto">Second tab</TabsTrigger>
          <TabsTrigger value="inspect">Third tab</TabsTrigger>
        </TabsList>
        <TabsContent value="design">Design content</TabsContent>
        <TabsContent value="proto">Prototype content</TabsContent>
        <TabsContent value="inspect">Inspect content</TabsContent>
      </Tabs>
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">Layers</TabsTrigger>
          <TabsTrigger value="b">Assets</TabsTrigger>
        </TabsList>
      </Tabs>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/tabs.tsx apps/storybook/src/stories/UI3/Tabs.parity.stories.tsx
git commit -m "feat(ui): UI3 tabs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Badge

**Files:**
- Rewrite: `packages/ui/src/components/ui/badge.tsx`
- Create: `apps/storybook/src/stories/UI3/Badge.parity.stories.tsx`

Variant mapping to the kit's badge-small set: `default` = kit Default (outlined), `secondary` = Brand (tinted), `destructive` = Danger strong, `outline` = alias of default, `ghost` = Default strong (filled secondary), `link` = brand text.

- [ ] **Step 1: Replace `badge.tsx`**

```tsx
import { cn } from "@repo/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

/** UI3 badge small: 16 px, 4 px padding, 5 px radius, body/medium. Kit ref 2012:35028. */
const badgeVariants = cva(
  "group/badge inline-flex h-4 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1 text-sm font-medium tracking-ui3 whitespace-nowrap transition-colors focus-visible:border-figma-border-selected [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-figma-border text-foreground",
        outline: "border-figma-border text-foreground",
        secondary: "bg-figma-bg-selected text-figma-text-brand",
        ghost: "bg-figma-bg-secondary text-foreground",
        destructive: "bg-figma-bg-danger text-figma-text-ondanger",
        link: "text-figma-text-brand underline-offset-2 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 2: Verify** (shared command).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Badge.parity.stories.tsx`:

```tsx
import { Badge } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/badge.png";

const meta = { title: "UI3/Badge", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Badge small: Default, Brand, Invert, FigJam, Component, Danger, Warn, Success… strong and subtle">
      <div className="flex flex-wrap gap-2">
        <Badge>Default</Badge>
        <Badge variant="ghost">Strong</Badge>
        <Badge variant="secondary">Brand</Badge>
        <Badge variant="destructive">Danger</Badge>
        <Badge variant="link">Link</Badge>
      </div>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/badge.tsx apps/storybook/src/stories/UI3/Badge.parity.stories.tsx
git commit -m "feat(ui): UI3 badge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Tooltip

**Files:**
- Modify: `packages/ui/src/components/ui/tooltip.tsx` (`TooltipContent` only)
- Create: `apps/storybook/src/stories/UI3/Tooltip.parity.stories.tsx`

- [ ] **Step 1: Replace `TooltipContent`**

```tsx
/** UI3 tooltip: dark surface, 5 px radius, 8 × 4 padding, 200 px max, 12 × 6 arrow. Kit ref 2015:39096. */
function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-[200px] origin-(--radix-tooltip-content-transform-origin) items-center gap-1 rounded-md bg-figma-bg-tooltip px-2 py-1 text-sm font-medium tracking-ui3 text-figma-text-tooltip shadow-tooltip **:data-[slot=kbd]:text-figma-text-tooltip-secondary data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow width={12} height={6} className="fill-figma-bg-tooltip" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
```

- [ ] **Step 2: Verify** (shared command).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Tooltip.parity.stories.tsx`:

```tsx
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/tooltip.png";

const meta = { title: "UI3/Tooltip", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame portaled reference={ref} caption="Tooltip: eight directions, with hotkey">
      <TooltipProvider>
        <div className="flex gap-4 py-8">
          {(["top", "bottom", "left", "right"] as const).map((side) => (
            <Tooltip key={side} defaultOpen>
              <TooltipTrigger asChild><Button variant="secondary">{side}</Button></TooltipTrigger>
              <TooltipContent side={side}>Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span></TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/tooltip.tsx apps/storybook/src/stories/UI3/Tooltip.parity.stories.tsx
git commit -m "feat(ui): UI3 tooltip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: DropdownMenu (dark menu)

**Files:**
- Modify: `packages/ui/src/components/ui/dropdown-menu.tsx` (class strings only)
- Create: `apps/storybook/src/stories/UI3/Menu.parity.stories.tsx`

Shared menu classes (used verbatim in Tasks 15, 16, 17):

```
MENU_PANEL  = "z-50 min-w-52 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-figma-bg-menu py-2 text-figma-text-menu shadow-menu duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
MENU_ROW    = "relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none focus:bg-figma-bg-menu-selected focus:text-figma-text-menu data-open:bg-figma-bg-menu-selected data-open:text-figma-text-menu data-disabled:pointer-events-none data-disabled:text-figma-text-menu-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              (icons inherit the row colour; the Task 15 review dropped `[&_svg]:text-figma-icon-menu` so disabled and destructive rows tint their icons)
MENU_CHECK  = MENU_ROW + " pl-6 group/<family>-item"   (indicator sits absolutely at left-1; the group name lets shortcuts inside check rows turn white on focus)
MENU_DANGER = "data-[variant=destructive]:text-figma-text-menu-danger data-[variant=destructive]:focus:bg-figma-bg-danger data-[variant=destructive]:focus:text-figma-text-ondanger"
              (uses the menu-specific `--ui3-text-menu-danger` token added in Task 15; `text-figma-text-danger` fails contrast on the dark panel in light mode)
MENU_LABEL  = "flex h-6 items-center px-4 text-sm font-medium tracking-ui3 text-figma-text-menu-secondary"   (16 px aligns with plain rows; Select uses pl-8 because every row has the check gutter)
MENU_SEP    = "my-2 h-px bg-figma-border-menu"
MENU_SHORT  = "ml-auto text-sm tracking-ui3 text-figma-text-menu-secondary group-focus/dropdown-menu-item:text-figma-text-menu"
```

- [ ] **Step 1: Apply to `dropdown-menu.tsx`**

- `DropdownMenuContent`: replace the className string with `MENU_PANEL` but keep the two width/height classes from the original: prepend `max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width)` (note `w-` keeps trigger width; drop `min-w-32`).
- `DropdownMenuItem`: className → `MENU_ROW` plus `group/dropdown-menu-item data-inset:pl-6 data-[variant=destructive]:text-figma-text-danger data-[variant=destructive]:focus:bg-figma-bg-danger data-[variant=destructive]:focus:text-figma-text-ondanger`.
- `DropdownMenuCheckboxItem` and `DropdownMenuRadioItem`: className → `MENU_CHECK`; the indicator `<span>` className → `"pointer-events-none absolute left-1 flex size-4 items-center justify-center"`.
- `DropdownMenuLabel`: className → `MENU_LABEL` + ` data-inset:pl-6`.
- `DropdownMenuSeparator`: className → `MENU_SEP`.
- `DropdownMenuShortcut`: className → `MENU_SHORT`.
- `DropdownMenuSubTrigger`: className → `MENU_ROW` + ` data-inset:pl-6`; keep `<ChevronRightIcon className="ml-auto" />`.
- `DropdownMenuSubContent`: className → `MENU_PANEL` with `min-w-52` replaced by `min-w-40`.

- [ ] **Step 2: Verify** (shared command; `dropdown-menu.test.tsx` asserts behaviour).

- [ ] **Step 3: Parity story (covers dropdown, context and menubar)**

`apps/storybook/src/stories/UI3/Menu.parity.stories.tsx`:

```tsx
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/menu.png";

const meta = { title: "UI3/Menu", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame portaled reference={ref} caption="Menu: simple rows with shortcuts, submenu chevrons, dividers, checkmark rows">
      <DropdownMenu defaultOpen modal={false}>
        <DropdownMenuTrigger asChild><Button variant="secondary">Open menu</Button></DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" align="start">
          <DropdownMenuItem>Copy<DropdownMenuShortcut>⌥⇧⌘O</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Copy / Paste as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuItem>Copy as SVG</DropdownMenuItem><DropdownMenuItem>Copy as PNG</DropdownMenuItem></DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Bring to front<DropdownMenuShortcut>]</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem>Send to back<DropdownMenuShortcut>[</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Options</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>Show rulers</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem>Snap to pixel grid</DropdownMenuCheckboxItem>
          <DropdownMenuItem disabled>Flatten<DropdownMenuShortcut>⌘E</DropdownMenuShortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/dropdown-menu.tsx apps/storybook/src/stories/UI3/Menu.parity.stories.tsx
git commit -m "feat(ui): UI3 dark dropdown menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: ContextMenu

**Files:**
- Modify: `packages/ui/src/components/ui/context-menu.tsx`

Parity: the `UI3/Menu` story from Task 15 is the reference for all three menu families; the existing `Navigation/ContextMenu` story is checked with the theme toggle instead of a new parity story.

- [ ] **Step 1: Apply the shared menu classes** (same mapping as Task 15, with `dropdown-menu` → `context-menu` in the group names and `--radix-dropdown-menu-content-transform-origin` → `--radix-context-menu-content-transform-origin`):

- `ContextMenuContent` (line ~116): className → `MENU_PANEL` (no width classes).
- `ContextMenuItem` (line ~76): `MENU_ROW` + ` group/context-menu-item data-inset:pl-6 ` + `MENU_DANGER`.
- `ContextMenuCheckboxItem` (~138) and `ContextMenuRadioItem` (~167): `MENU_CHECK` with `group/context-menu-item`; the indicator spans (lines ~144, ~172) → `"pointer-events-none absolute left-1 flex size-4 items-center justify-center"`.
- `ContextMenuLabel` (~194): `MENU_LABEL` + ` data-inset:pl-8`.
- `ContextMenuSeparator` (~209): `MENU_SEP`.
- `ContextMenuShortcut` (~220): `MENU_SHORT` with `group-focus/context-menu-item`.
- `ContextMenuSubTrigger` (~97): `MENU_ROW` + ` data-inset:pl-6 group/context-menu-item`.
- `ContextMenuSubContent` (~52): `MENU_PANEL` with `min-w-40`, plus `max-h-(--radix-context-menu-content-available-height)` after `z-50`.

- [ ] **Step 2: Verify** (shared command; `context-menu.test.tsx` has one pre-existing skip).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ui/context-menu.tsx
git commit -m "feat(ui): UI3 dark context menu

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Menubar

**Files:**
- Modify: `packages/ui/src/components/ui/menubar.tsx`

Parity: covered by the `UI3/Menu` story (Task 15) plus the existing `Navigation/Menubar` story under the theme toggle.

- [ ] **Step 1: Bar and triggers**

- `Menubar` (line ~12): className → `"flex h-6 items-center gap-0.5 rounded-md bg-figma-bg-secondary p-0.5"`.
- `MenubarTrigger` (~42): className → `"flex h-5 items-center rounded-[3px] px-2 text-sm font-medium tracking-ui3 outline-hidden select-none hover:bg-figma-bg-tertiary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-figma-border-selected aria-expanded:bg-figma-bg-pressed"` (review outcome: `bg-hover` equals `bg-secondary` in both themes, so hover and focus on the bar were invisible).

- [ ] **Step 2: Menu content** (same shared classes; group name `menubar-item`, origin `--radix-menubar-content-transform-origin`):

- `MenubarContent` (~65): `MENU_PANEL` with `max-h-(--radix-menubar-content-available-height)` after `z-50`; defaults `alignOffset={-2}` and `sideOffset={6}` (review outcome: the old −4/8 were tuned for the bordered 3 px-padded bar).
- `MenubarItem` (~89): `MENU_ROW` + ` group/menubar-item data-inset:pl-6 ` + `MENU_DANGER`.
- `MenubarCheckboxItem` (~111) and `MenubarRadioItem` (~140): `MENU_CHECK` with `group/menubar-item`; their indicator spans (~117, ~145) → `"pointer-events-none absolute left-1 flex size-4 items-center justify-center [&_svg:not([class*='size-'])]:size-4"`.
- `MenubarLabel` (~166): `MENU_LABEL` + ` data-inset:pl-8`.
- `MenubarSeparator` (~179): `MENU_SEP`.
- `MenubarShortcut` (~190): `MENU_SHORT` with `group-focus/menubar-item`.
- `MenubarSubTrigger` (~215): `MENU_ROW` + ` data-inset:pl-6 group/menubar-item`.
- `MenubarSubContent` (~234): `MENU_PANEL` with `min-w-40`, plus `max-h-(--radix-menubar-content-available-height)` after `z-50`.

- [ ] **Step 3: Verify, commit**

```bash
git add packages/ui/src/components/ui/menubar.tsx
git commit -m "feat(ui): UI3 menubar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Command (dark palette)

**Files:**
- Modify: `packages/ui/src/components/ui/command.tsx`
- Create: `apps/storybook/src/stories/UI3/Command.parity.stories.tsx`

- [ ] **Step 1: Class changes**

- `Command`: className → `"flex size-full flex-col overflow-hidden rounded-xl bg-figma-bg-menu text-figma-text-menu"`.
- `CommandDialog` content className → `"top-1/3 w-[320px] translate-y-0 overflow-hidden rounded-xl! border-0 bg-figma-bg-menu p-0 text-figma-text-menu"`.
- `CommandInput` wrapper → `"px-2 pt-2"`; the `InputGroup` className → `"h-6! rounded-md! border-transparent bg-figma-bg-menu-hover dark:bg-figma-bg-menu-hover has-disabled:bg-figma-bg-menu-hover text-figma-text-menu shadow-none! *:data-[slot=input-group-addon]:pl-1.5!"` (review outcome: InputGroup still carries shadcn's `dark:bg-input/30` and `has-disabled:bg-input/50`, which twMerge keeps because the variants differ, so the override must repeat under those variants; `bg-white/10` was a hard-coded colour); the `CommandPrimitive.Input` className → `"w-full bg-transparent text-sm font-medium tracking-ui3 text-figma-text-menu outline-hidden placeholder:text-figma-text-menu-secondary disabled:cursor-not-allowed disabled:opacity-50"`; the `SearchIcon` → `"size-4 shrink-0 text-figma-icon-menu"`.
- `CommandList`: `"no-scrollbar max-h-72 scroll-py-2 overflow-x-hidden overflow-y-auto py-2 outline-none"`.
- `CommandEmpty`: `"py-6 text-center text-sm text-figma-text-menu-secondary"`.
- `CommandGroup`: `"overflow-hidden p-0 text-figma-text-menu **:[[cmdk-group-heading]]:flex **:[[cmdk-group-heading]]:h-6 **:[[cmdk-group-heading]]:items-center **:[[cmdk-group-heading]]:px-4 **:[[cmdk-group-heading]]:text-sm **:[[cmdk-group-heading]]:text-figma-text-menu-secondary"`.
- `CommandSeparator`: `"my-2 h-px bg-figma-border-menu"`.
- `CommandItem`: `"group/command-item relative mx-2 flex min-h-6 cursor-default items-center gap-1 rounded-md px-2 text-sm font-medium tracking-ui3 outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:text-figma-text-menu-disabled data-selected:bg-figma-bg-menu-selected data-selected:text-figma-text-menu [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"`.
- `CommandShortcut`: `"ml-auto text-sm tracking-ui3 text-figma-text-menu-secondary group-data-selected/command-item:text-figma-text-menu"`.

- [ ] **Step 2: Verify** (shared command; `command.test.tsx` asserts behaviour).

- [ ] **Step 3: Parity story**

`apps/storybook/src/stories/UI3/Command.parity.stories.tsx`:

```tsx
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/menu-multiselect.png";

const meta = { title: "UI3/Command", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame reference={ref} caption="Menu multi-select: search input, headings, rows, dividers, footer action">
      <Command className="w-52 shadow-menu">
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Recent">
            <CommandItem>Rectangle<CommandShortcut>R</CommandShortcut></CommandItem>
            <CommandItem>Ellipse<CommandShortcut>O</CommandShortcut></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="All">
            <CommandItem>Frame<CommandShortcut>F</CommandShortcut></CommandItem>
            <CommandItem disabled>Section</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </ParityFrame>
  ),
};
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/command.tsx apps/storybook/src/stories/UI3/Command.parity.stories.tsx
git commit -m "feat(ui): UI3 command palette

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Dialog and AlertDialog

**Files:**
- Modify: `packages/ui/src/components/ui/dialog.tsx`, `packages/ui/src/components/ui/alert-dialog.tsx`
- Create: `apps/storybook/src/stories/UI3/Dialog.parity.stories.tsx`

UI3 modal: 320 px (or 480 px) window, 13 px radius, 40 px header with strong title and a 24 px close button, 1 px dividers, 40 px footer with the secondary + primary button pair right-aligned at 8 px inset. Content padding is the caller's (16 px). Kit refs: header 2327:122027, footer 2327:122061, templates 2327:134405 / 2327:134403.

- [ ] **Step 1: `dialog.tsx` edits**

`DialogOverlay` className → `"fixed inset-0 isolate z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"`.

`DialogContent` gains a `size` prop and new classes:

```tsx
function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  size?: "default" | "lg";
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background text-sm text-foreground shadow-dialog ring-1 ring-figma-border-translucent duration-100 outline-none data-[size=default]:w-80 data-[size=lg]:w-[480px] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" size="icon" className="absolute top-2 right-2" aria-label="Close">
              <XIcon />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
```

`DialogHeader` className → `"flex min-h-10 shrink-0 flex-col justify-center gap-0.5 border-b border-figma-border py-2 pr-10 pl-4"`.

`DialogFooter`: className → `"flex h-10 shrink-0 items-center justify-end gap-2 border-t border-figma-border px-2"`; the built-in close button stays `variant="outline"` (now the translucent secondary).

`DialogTitle` className → `"text-sm leading-4 font-semibold tracking-ui3"`.

`DialogDescription` className → `"text-sm text-figma-text-secondary *:[a]:text-figma-text-brand *:[a]:underline-offset-2 *:[a]:hover:underline"`.

- [ ] **Step 2: `alert-dialog.tsx` edits**

- `AlertDialogOverlay` className → same as the dialog overlay.
- `AlertDialogContent`: `size` type → `"default" | "sm" | "lg"`; className → `"group/alert-dialog-content fixed top-1/2 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-background text-foreground shadow-dialog ring-1 ring-figma-border-translucent duration-100 outline-none data-[size=default]:w-80 data-[size=sm]:w-80 data-[size=lg]:w-[480px] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"`.
- `AlertDialogHeader` className → `"flex min-h-10 shrink-0 flex-col justify-center gap-0.5 border-b border-figma-border px-4 py-2 text-left has-data-[slot=alert-dialog-media]:flex-row has-data-[slot=alert-dialog-media]:items-center has-data-[slot=alert-dialog-media]:gap-3"`.
- `AlertDialogFooter` className → `"flex h-10 shrink-0 items-center justify-end gap-2 border-t border-figma-border px-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2"`.
- `AlertDialogMedia` className → `"inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-figma-bg-secondary *:[svg:not([class*='size-'])]:size-4"`.
- `AlertDialogTitle` className → `"text-sm leading-4 font-semibold tracking-ui3"`.
- `AlertDialogDescription` className → `"text-sm text-figma-text-secondary *:[a]:text-figma-text-brand *:[a]:underline-offset-2 *:[a]:hover:underline"`.
- `AlertDialogCancel` default `variant` stays `"outline"`.

- [ ] **Step 3: Verify** (shared command; `dialog.test.tsx` and `alert-dialog.test.tsx` render Title + Description inside Header and assert roles and text, which still holds).

Review outcome: the default width moved into the base classes (`w-80`, with `data-[size=lg]:w-[480px]` as the only variant) because a variant-prefixed `data-[size=default]:w-80` outranks any caller `w-*`; Content also gets `max-h-[calc(100%-2rem)]` for short plugin windows; the AlertDialog media header is a two-column grid (`grid-cols-[auto_1fr]`, media `row-span-2`, title and description `col-start-2`) instead of a single flex row; Feedback/Dialog story body gets `p-4` and its description moves into the body.

- [ ] **Step 4: Parity story**

`apps/storybook/src/stories/UI3/Dialog.parity.stories.tsx`:

```tsx
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input } from "@repo/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { ParityFrame } from "./_parity";
import ref from "./refs/dialog-320.png";

const meta = { title: "UI3/Dialog", parameters: { layout: "padded" } } satisfies Meta;
export default meta;

export const Parity: StoryObj = {
  render: () => (
    <ParityFrame portaled reference={ref} caption="Modal 320 / Basic: 40 px header with close, body, 40 px footer with Cancel + Action">
      <Dialog defaultOpen modal={false}>
        <DialogTrigger asChild><Button variant="secondary">Open dialog</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename layers</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 p-4">
            <DialogDescription>Give the selected layers a new name.</DialogDescription>
            <Input placeholder="New name" />
          </div>
          <DialogFooter>
            <Button variant="secondary">Cancel</Button>
            <Button>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ParityFrame>
  ),
};
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ui/dialog.tsx packages/ui/src/components/ui/alert-dialog.tsx apps/storybook/src/stories/UI3/Dialog.parity.stories.tsx
git commit -m "feat(ui): UI3 dialog and alert dialog windows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 20: Sampler and plugin window

**Files:**
- Rewrite: `packages/ui/src/app.tsx`
- Modify: `apps/design-plugin/src/plugin/plugin.ts` (two `showUI` calls)

- [ ] **Step 1: Replace `app.tsx`**

```tsx
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Icon,
  IconButton,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  SectionTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./index";

/** Component sampler laid out like a Figma properties panel: 8 px gutters, 24 px rows. */
function App() {
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
        <Tabs defaultValue="design" className="gap-0">
          <div className="flex h-10 items-center justify-between border-b border-figma-border px-2">
            <TabsList>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="proto">Prototype</TabsTrigger>
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton iconProps={{ name: "lucide:plus" }} aria-label="More" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Copy<DropdownMenuShortcut>⌘C</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem>Paste<DropdownMenuShortcut>⌘V</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Group selection<DropdownMenuShortcut>⌘G</DropdownMenuShortcut></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <TabsContent value="design" className="flex flex-col">
            <section className="flex flex-col gap-2 border-b border-figma-border p-2 pb-4">
              <SectionTitle>Layer</SectionTitle>
              <Input placeholder="Layer name" />
              <Textarea placeholder="Description" rows={2} />
              <Select defaultValue="fill">
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fill">Fill container</SelectItem>
                  <SelectItem value="hug">Hug contents</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </section>

            <section className="flex flex-col border-b border-figma-border p-2 pb-4">
              <SectionTitle>Options</SectionTitle>
              <div className="flex h-6 items-center gap-2"><Checkbox id="clip" defaultChecked /><Label htmlFor="clip">Clip content</Label></div>
              <div className="flex h-6 items-center gap-2"><Checkbox id="auto" /><Label htmlFor="auto">Auto layout</Label></div>
              <RadioGroup defaultValue="a">
                <div className="flex h-6 items-center gap-2"><RadioGroupItem value="a" id="r1" /><Label htmlFor="r1">Option A</Label></div>
                <div className="flex h-6 items-center gap-2"><RadioGroupItem value="b" id="r2" /><Label htmlFor="r2">Option B</Label></div>
              </RadioGroup>
              <div className="flex h-6 items-center gap-2"><Switch id="sw" defaultChecked /><Label htmlFor="sw">Enable feature</Label></div>
            </section>

            <section className="flex flex-col gap-2 p-2">
              <SectionTitle>Actions</SectionTitle>
              <div className="flex items-center gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">New</Badge>
                <Tooltip>
                  <TooltipTrigger asChild><Icon name="lucide:info" className="size-4 text-figma-icon-secondary" /></TooltipTrigger>
                  <TooltipContent>Tooltip text <span className="text-figma-text-tooltip-secondary">⌘V</span></TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild><Button variant="secondary">Rename…</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Rename layers</DialogTitle></DialogHeader>
                    <div className="flex flex-col gap-2 p-4">
                      <DialogDescription>Give the selected layers a new name.</DialogDescription>
                      <Input placeholder="New name" />
                    </div>
                    <DialogFooter>
                      <Button variant="secondary">Cancel</Button>
                      <Button>Rename</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button className="flex-1">Create</Button>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="proto" className="p-2 text-figma-text-secondary">Prototype settings go here.</TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

export default App;
```

- [ ] **Step 2: `plugin.ts`** — in both `showUI` calls change `width: 800, height: 650` to `width: 320, height: 480`.

Review outcome: `Icon` only accepts `name`/`spin`/`className`/`style`, so `TooltipTrigger asChild` on it drops Radix's trigger props and the tooltip never opens; the trigger is an `IconButton size="icon-sm"` instead. `html, body, #root { height: 100% }` is added to `@layer base` and the Tabs root/content get `min-h-0 flex-1` + `overflow-y-auto` so the header stays fixed while the body scrolls. The header button uses a new `lucide:ellipsis` icon, dialog buttons are wrapped in `DialogClose`, inputs get `aria-label`s, and `SectionTitle` becomes a 32 px sentence-case UI3 header (`text-sm font-semibold tracking-ui3 text-foreground`).

- [ ] **Step 3: Verify**

Shared command (the `App.test.tsx` asserts the texts "Inputs", "Buttons", "Display", "Layout", "Primary action", "This is a tip for new users."). Update `packages/ui/src/__tests__/App.test.tsx` to the new sampler:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import App from "../app";

describe("App (component sampler)", () => {
  it("renders the panel sections", () => {
    render(<App />);
    expect(screen.getByText("Layer")).toBeInTheDocument();
    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByText("Actions")).toBeInTheDocument();
  });

  it("renders the primary action", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("renders the tab bar", () => {
    render(<App />);
    expect(screen.getByRole("tab", { name: "Design" })).toBeInTheDocument();
  });
});
```

Then run the shared command → `0 fail`. Controller: `bun run --filter @repo/design-plugin build` and load in Figma.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/app.tsx packages/ui/src/__tests__/App.test.tsx apps/design-plugin/src/plugin/plugin.ts
git commit -m "feat(ui): UI3 panel sampler and 320x480 plugin window

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 21: Sweep the unmatched components

**Files:** none planned; fix only what renders broken.

- [ ] **Step 1: Controller builds Storybook and Jonas pages through every existing story in light and dark** using the toolbar toggle. Anything that overflows, clips, or is unreadable at the new scale gets a minimal class fix in its own `fix(ui): …` commit. Known candidates from the Task 4 review: `sheet.tsx:99`, `drawer.tsx:89`, `card.tsx:40` titles are `text-base font-medium` and now equal body text, so change them to `text-lg` or `font-semibold`; `calendar.tsx:77,83` weekday labels are `text-[0.8rem]` (12.8 px) and now larger than the 11 px day numbers, so change to `text-sm`; `input-group.tsx:25` uses `rounded-[calc(var(--radius)-5px)]` which is now 0 px, so change to `rounded-sm`; `input-otp.tsx:55` digits at 11 px may want `text-lg`; `sidebar.tsx` hard-coded widths; every unmatched `text-xs` is now 9 px, check kbd, sidebar badges and chart tooltips. From the Task 19 review: `DialogContent`/`AlertDialogContent` have `max-h-[calc(100%-2rem)]` but no `overflow`, so a tall body still spills; either add `overflow-hidden` to Content (header and footer are `shrink-0`, so only the body shrinks) and document `min-h-0 overflow-y-auto` on the body wrapper, or pick one and apply it to the sampler and parity story. From the Task 18 review: `input-group.tsx` was never restyled (only `InputGroupInput` typing and `h-full` changed in Task 7); give it the Input surface (`h-6 rounded-md border-transparent bg-figma-bg-secondary hover:border-figma-border has-[:focus-visible]:border-figma-border-selected`) and skip those borders inside `[data-slot=command]`; then drop `w-[320px]` from `CommandDialog` since `DialogContent` sizes itself after Task 19, and check Radix's missing-title warning for `CommandDialog` (its `DialogHeader` sits outside `DialogContent`). From the Task 15 review: `select.tsx` SelectItem still uses `data-disabled:text-figma-text-menu-secondary`; switch it to `data-disabled:text-figma-text-menu-disabled` so Select and the menus dim disabled rows alike. Also from the Task 8/10 reviews: `ParityFrame` renders its children twice, so stories that pass `id`/`htmlFor` (Checkbox `c1`–`c5`, Switch `s1`–`s4`) produce duplicate ids and a dark-column label toggles the light-column control; fix by letting `ParityFrame` take a render function that receives a column suffix (`(col) => <Row id={`s1-${col}`} …/>`) and updating those two stories.

- [ ] **Step 2: Verify** shared command plus `bun run lint`.

Sweep outcome (commits `7a9fcc1`…`0bd3560` plus two fix-ups): sheet/drawer/card titles → `text-sm leading-4 font-semibold tracking-ui3`; calendar labels `text-sm`; InputGroup restyled to the Input surface (24 px, `bg-figma-bg-secondary`, hover/focus/invalid borders, Command skips the hover border via `in-data-[slot=command]:`; buttons shrunk to 20 px, addon dims via `group-has-disabled/input-group:`); OTP cells on figma tokens with the active edge painted by a 1 px shadow; small buttons at 11 px; Select disabled rows use the menu disabled token; CommandDialog drops its width override and moves the sr-only header inside Content; Dialog/AlertDialog Content get `overflow-hidden` and body wrappers `min-h-0 overflow-y-auto`; `ParityFrame` children may be a render function so Checkbox/Switch/Radio ids are unique per column. Left as token-level notes: `calendar.tsx` `[&>span]:text-xs` and focus ring, Card/Sheet/Drawer descriptions on `text-muted-foreground`.

---

### Task 22: Changeset, verification, PR

**Files:**
- Create: `.changeset/ui3-alignment.md`

- [ ] **Step 1: Changeset**

```md
---
"@repo/ui": minor
---

Align the component library with Figma's UI3 design system. Tokens now bind to the `--figma-color-*` variables Figma injects (with kit fallbacks), the global scale is 24 px controls / 11 px Inter 450 / 5 px radius, and sixteen components match the UI3 kit: Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog, AlertDialog. Menus are dark in both themes like Figma's. Storybook gains a theme toggle and `UI3/*` parity stories. The plugin window defaults to 320 × 480. Badge `default` is now the neutral outlined kit style (it was a filled brand pill); `secondary` is the selected tint with brand text; `ghost` is the filled secondary.
```

- [ ] **Step 2: Full verification (controller)**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile
bun run lint && bun run types && bun run test && bun run --filter @repo/design-plugin build
bunx turbo run build-storybook --filter=@repo/storybook
grep -c "font/woff2;base64" apps/design-plugin/dist/index.html; wc -c apps/design-plugin/dist/index.html
```

Expected: all green; font inlined; bundle size noted in the PR.

- [ ] **Step 3: Final Figma check (Jonas)**: run the plugin in light and dark; switch themes while open and confirm colours change without reload; open the menu, the dialog and the tooltip.

- [ ] **Step 4: Commit, push, PR**

```bash
git add .changeset/ui3-alignment.md
git commit -m "chore: add changeset for UI3 alignment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/ui3-alignment
gh pr create --base master --title "feat(ui): align components with Figma UI3" --body "$(cat <<'PRBODY'
## Summary
- Token layer bound to Figma's injected `--figma-color-*` variables with UI3 kit fallbacks; `figma-*` Tailwind namespace for kit tokens; global scale 24 px / 11 px Inter 450 / 5 px radius; Inter variable font inlined
- Sixteen components edited to kit specs (Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog, AlertDialog); menus dark in both themes
- Storybook theme toolbar + `UI3/*` parity stories with kit reference PNGs
- Sampler restyled as a Figma panel; plugin window 320 × 480

Spec: docs/superpowers/specs/2026-10-29-ui3-alignment-design.md
Plan: docs/superpowers/plans/2026-10-29-ui3-alignment.md

## Test plan
- [ ] CI green
- [ ] Every `UI3/*` parity story signed off in light and dark
- [ ] Plugin colours switch live with Figma's theme
- [ ] Unmatched components reviewed in Storybook at the new scale

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```
