# Frottage components: results

Plan: `docs/superpowers/plans/2026-11-11-frottage-components.md`, Task 7.

## Measured before building (2026-11-11, Chromium, page's own JavaScript world)

| Site | What can be read |
|---|---|
| mainline-nextjs-template.vercel.app | React fibers on every element; Button props `variant`, `size`, `disabled`; minified names (`o`, `d`), some readable (`Card`, `CarouselItem`); `data-slot` markers |
| mainline-astro-template.vercel.app | React islands with props (6 of 9 buttons), 3 static buttons with only `data-slot` |
| ui.shadcn.com | `data-slot`, `data-variant`, `data-size` |
| vuejs.org, nuxt.com | Vue 3 app tree with real names and props (`VTLink`, `UButton`, `UBadge`); Nuxt UI `data-slot` names parts |
| svelte.dev | nothing per element |
| angular.dev | custom-element tag names only |

`chrome.scripting.executeScript({ world: "MAIN" })` under `activeTab` reads the props; the extension's isolated world does not.

## Step 1 (agent, real Chromium with the built extension)

- The probe, run live: Mainline Next.js 100 components tagged (Button ×7 with props, plus 4 static `data-slot` buttons, Card, CardContent, CarouselItem, accordion parts); Astro 118; nuxt.com `UButton` ×31, `UBadge` ×28, `UPageCard` ×19. `executeScript` returns the count; the capture's world sees every tag.
- A 6-size Mainline capture: every size records its components (Laptop: Button ×11 with props and `codeName`, Card ×3, CarouselItem ×8, …); no `data-frottage-component` attribute left on the page. Astro: Button ×9 per size, Card ×12.
- Both files through the plugin UI's import (`runImports`, fake sandbox):
  - Mainline: `Components: Button (4 variants), CarouselItem, Card, CardContent, Switch, SwitchThumb, Accordion, Collapsible, CollapsibleTrigger, NavigationMenuItem`; `Button: 4 variants from the page's code (Variant, Size, Disabled).`; `A component named "d" in the code was named Button from its data-slot.`; Button instances Laptop 26, Tablet 13, Phone 8–15 (after the arrow-icon and resize rules).
  - Astro: `Button (3 variants)` (Variant, Size), four renames from `data-slot`.
- Known: many cards and carousel items on Tablet and Phone stay separate ("look different") because a fixed-size child changes size with the screen (an image 328 vs 288 px tall). Open owner decision: treat such child-size-only differences as instance resizes.

The full gate (lint, forced types, all tests, capture-dom e2e, plugin, extension and docs builds, bundle check) exited 0 at the PR head.

## Step 2 (owner): pending

`bun run build`; reload; capture and import Mainline; in Figma change a button instance's Variant and Label in the right panel; switch the Section's Breakpoint mode by device and check a Phone button keeps Phone spacing.

## Step 3 (agent, Desktop Bridge): pending

Also to check in real Figma (assumed by the test fake): binding a variant's text to the set's `Label` property keeps each variant's own text; `setProperties` with an icon component id for the swap; instance mode inheritance from mains.
