---
name: build-figma-plugin
description: Build a complete Figma plugin from a plain English description. Handles all code generation, message wiring, UI, and build validation. Designed for non-programmers.
---

# Build Figma Plugin

You are helping a **non-programmer** build a Figma plugin. They will describe what they want in plain English. You generate all the code, validate it builds, and guide them through installing it in Figma.

## Hard Rules

- **Never ask the user to write code.** You write everything.
- **Never show raw error output.** If something fails, explain what went wrong in plain language and fix it.
- **Always validate your work.** Run the four checks in Step 3 after generating code. If any fails, fix it before responding.
- **Always end with installation instructions** when the build succeeds.

## Workflow

### Step 1: Understand the Plugin Idea

Ask **2-3 short clarifying questions** (multiple choice when possible). Focus on:
- What Figma action should the plugin perform? (e.g., rename layers, change colors, export images)
- What should the plugin UI look like? (e.g., a single button, a form with inputs, a settings panel)
- Any edge cases? (e.g., what happens if nothing is selected?)

Do NOT ask about technology, architecture, or implementation. The user doesn't know or care about those.

### Step 2: Generate Code

You MUST modify these files (read the reference docs first):

| File | What to change |
|------|---------------|
| `packages/common/src/networkSides.ts` | Add message types for your plugin's events |
| `apps/design-plugin/src/plugin/plugin.ts` | Set the window title and bootstrap logic. Keep `width: 320, height: 480` unless the UI needs more, and always keep `themeColors: true` |
| `apps/design-plugin/src/plugin/plugin.network.ts` | Register Figma API handlers for each message |
| `packages/ui/src/app.tsx` | Build the React UI using `@repo/ui` components |
| `packages/ui/src/__tests__/App.test.tsx` | Replace the sampler tests with tests for the new UI (renders the main controls; key interactions) |
| `apps/design-plugin/figma.manifest.ts` | Update plugin `name` (keep existing `id` for dev) |

**Before writing code**, read these references:
- `@references/architecture.md` — How the two-process model works
- `@references/figma-api-patterns.md` — Common Figma API operations
- `@references/ui-components.md` — Available UI components from `@repo/ui`
- `@references/message-patterns.md` — How to define and handle messages

### Step 3: Build & Validate

Run these commands and verify they all pass:

```bash
bun run build      # Must succeed — produces dist/index.html, dist/plugin.js, dist/manifest.json
bun run types      # Must succeed — no TypeScript errors
bun run lint       # Must succeed — no Biome errors
bun run test       # Must succeed — all tests pass
```

If any command fails, **fix the issue yourself** and re-run. Do not ask the user to fix anything.

The existing `App.test.tsx` tests the template's component sampler; rewrite it for the new UI rather than restoring the sampler.

### Step 4: Installation Guide

After a successful build, print this guide (customize the plugin name):

---

**Your plugin is ready!** Here's how to install it in Figma:

1. Open the **Figma desktop app** (plugins can't be loaded in the browser)
2. Open any Figma file
3. Go to **Plugins > Development > Import plugin from manifest...**
4. Navigate to this project folder: `apps/design-plugin/dist/`
5. Select **manifest.json**
6. Your plugin now appears under **Plugins > Development > [Plugin Name]**

To test changes: run `bun run build` again, then re-run the plugin in Figma (no need to re-import).

---

### Step 5: Create a Changeset

After the plugin is built and working, create a changeset to track this change:

Run `bun changeset` and when prompted:
- Select `@repo/ui` as the changed package (`@repo/common` is versioned with it automatically; the plugin app `@repo/design-plugin` is ignored by changesets)
- Choose `minor` (new plugin feature)
- Write a one-line summary of the plugin (e.g., "Add layer rename plugin")

If you are on `master`, first create a branch (`git checkout -b feat/<plugin-name>`), then commit the changeset with `git add .changeset/ && git commit -m "chore: add changeset"`.

## When the User Asks to Change Something

Follow the same flow: understand what they want to change, modify the relevant files, run the Step 3 checks, and confirm it works.

## When the User Reports a Bug

1. Ask them to describe what happened vs. what they expected
2. Check the relevant code (plugin side for Figma API issues, UI side for display issues)
3. Fix it, rebuild, and confirm

## Important Architecture Constraints

- **Plugin code** (`plugin.ts`, `plugin.network.ts`) runs in Figma's sandbox. It can access `figma.*` API but has NO DOM and NO `window` (it does have `fetch`, limited by the manifest's `networkAccess`).
- **UI code** (`app.tsx`) runs in an iframe. It can use React and DOM but has NO access to `figma.*`. It communicates with the plugin via messages.
- **The build output is a single HTML file** (`dist/index.html`) with all JS/CSS inlined. No external files or network requests at runtime.
- **UI components** come from `@repo/ui`. Always import from there — never install new UI libraries.
- **The UI follows Figma's UI3 design.** Build screens like `packages/ui/src/app.tsx`: a 40 px header, sections divided by `border-b border-figma-border` with `p-2`, and 24 px rows (`flex h-6 items-center gap-2`). Controls are 24 px by default; use `size="lg"` (32 px) on Button, Input or Select only inside a dialog when larger targets help, and keep `Dialog` at its default 320 px width unless the window is widened.
- **Color only through tokens.** Use the `figma-*` utilities (`text-figma-text-secondary`, `bg-figma-bg-secondary`, `border-figma-border`) or the shadcn aliases the components already apply. Never write hex or `rgba()` colors, and never add `dark:` variants: the theme comes from Figma's variables through `themeColors: true`.
- **Menus and tooltips are dark in both themes** by design. Do not restyle them.
- **Read `@references/ui-components.md`** for the component inventory and the layout pattern before writing any UI.
