# Figma UI3 Component Alignment — Design

**Date:** 2026-10-29
**Status:** Approved, awaiting implementation plan
**Source of truth:** Figma community file "UI3: Figma's UI Kit", file key `tumaLvnU1CE6fZgCVc68wb`
**Predecessor:** `docs/archive/2026-04-plans/2026-04-23-ui3-theming-design.md` (token swap + CSS-only overrides, superseded by this spec)
**Depends on:** PR #16 (Bun build; `themeColors: true` so Figma injects `--figma-color-*` into the plugin iframe)

## Goal

Make the plugin UI indistinguishable from Figma's own UI3 panels: the kit's sizes,
type, radii, surfaces and states, in light and dark, with colours that track the
user's Figma theme live. Components that have a UI3 counterpart match the kit
exactly; the rest inherit the shared tokens and scale.

## Decisions (made during brainstorming)

| Question | Decision |
|---|---|
| Fidelity | **Faithful UI3.** 24 px default controls, 11 px Inter at weight 450, 5 px radius, filled inputs. shadcn's `size` prop stays; `lg` maps to the kit's 32 px size. |
| Scope | **Full fidelity for the 15 UI3-matched components; token-level only for the other ~35.** Nothing is removed from the library. |
| Editing shadcn files | **Allowed.** `packages/ui/src/components/ui/*.tsx` are project-owned; class lists and cva variants change directly. |
| Colour source | **Figma's injected variables first, kit palette as fallback.** `var(--figma-color-bg-brand, #0d99ff)` etc. Fallbacks apply in Storybook and tests only. |
| Menus | **Dark in both themes** (Figma's menu surface `#1e1e1e`), for dropdown, context menu, menubar, select list and command palette. |
| Proof of done | **Side-by-side parity stories in Storybook** (component next to the kit's reference PNG, light and dark), signed off visually. Unit tests keep passing. |
| Structure | **Token layer first, then per-component pass.** Each component is its own commit. |

## UI3 facts extracted from the kit

Values below come from `get_design_context` on master variants (node ids kept for
the plan). Kit CSS variable names are shown; Figma injects the same names with a
`--figma-` prefix (to be confirmed by the spike).

### Typography

- `body/medium`: Inter Medium, 11 px / 16 px, weight **450**, letter-spacing 0.5 % (0.055 px). Used by every control label.
- `body/medium/strong`: Inter Semi Bold, 11 px / 16 px, weight **550**. Selected tab, dialog title.
- Figma's iframe does not inherit Figma's font. Weights 450/550 need the **Inter variable font**; it is inlined (Latin subset, woff2, ~100 KB) in the single-file build.

### Spacing, radii, elevation

- Spacers: 4 px grid (`--spacer-1` 4, `--spacer-2` 8, `--spacer-6` 40).
- Radii: `--radius-medium` **5 px** (controls, menu rows, checkbox, badge), `--radius-large` **13 px** (menus, dialogs), `--radius-full`.
- Elevation: tooltip `0 1px 3px rgba(0,0,0,.10), 0 5px 12px rgba(0,0,0,.13), 0 0 .5px rgba(0,0,0,.15)`; menu panel `0 2px 5px rgba(0,0,0,.15), 0 10px 16px rgba(0,0,0,.12), 0 0 .5px rgba(0,0,0,.12)`.

### Colour tokens used by the matched components (light values)

| Kit variable | Light | Role |
|---|---|---|
| `color-bg` | `#ffffff` | page, dropdown trigger, dialog |
| `color-bg-secondary` | `#f5f5f5` | text input fill, selected tab, disabled button |
| `color-bg-hover` | `#f5f5f5` | hover surface |
| `color-bg-selected` | `#e5f4ff` | selected/brand-tinted surface |
| `color-bg-brand` | `#0d99ff` | primary button, checked checkbox, switch on |
| `color-bg-menu` | `#1e1e1e` | menu surface (both themes) |
| `color-bg-menu-selected` | `#0d99ff` | menu row hover |
| `color-bg-tooltip` | `#1e1e1e` | tooltip |
| `color-text` | `rgba(0,0,0,.9)` | body text |
| `color-text-secondary` | `rgba(0,0,0,.5)` | descriptions, unselected tab |
| `color-text-brand` | `#007be5` | link-style actions |
| `color-text-onbrand` | `#ffffff` | text on brand |
| `color-text-menu` / `-secondary` | `#fff` / `rgba(255,255,255,.7)` | menu text / shortcuts |
| `color-text-menu-disabled` / `-danger` | `rgba(255,255,255,.4)` / `#ffafa3` | disabled menu rows / destructive rows (same in both themes; the page-level danger text fails contrast on the dark panel) |
| `color-text-tooltip` / `-secondary` | `#fff` / `rgba(255,255,255,.7)` | tooltip text / hotkey |
| `color-border` | `#e6e6e6` | dropdown trigger, badge, dialog dividers |
| `color-bordertranslucent` | `rgba(0,0,0,.1)` | secondary button |
| `color-border-strong` | `rgba(0,0,0,.8)` | unchecked checkbox / radio |
| `color-border-selected` | `#0d99ff` | input focus |
| `color-border-selected-strong` | `#007be5` | checked checkbox border |
| `color-border-menu` | `#383838` | menu divider |

Figma injects no menu, tooltip or `border-translucent` variables (checked against the plugin docs on 2026-10-29), so those tokens are static kit values in both themes; `packages/ui/src/figma-variables.md` lists which tokens bind and which stay static.
| `color-icon-onbrand` | `#ffffff` | switch knob |

Dark values are whatever Figma injects; the fallback dark palette is taken from the kit's dark frames during the token task.

### Matched component specs (kit node ids)

| Component | Kit node | Spec |
|---|---|---|
| Button primary | `2012:48558` | h 24, px 8, radius 5, bg brand, text onbrand, body/medium |
| Button secondary | `2012:48574` | transparent, 1 px `bordertranslucent`, text `color-text` |
| Button large | Buttons page, Size=Large | h 32 (maps to `size="lg"`) |
| Text input default | `2028:79256` | h 24, px 8, radius 5, bg `bg-secondary`, no border |
| Text input focus | `2028:79258` | + 1 px `border-selected` |
| Text input large | `2028:79301` | h 32 |
| Dropdown (Select trigger) | `2028:36590` | h 24, bg `bg`, 1 px `border`, radius 5, pl 8, 24 px chevron slot; Stroke=False variant is borderless |
| Checkbox checked | `2012:55462` | 16 px, radius 5, bg brand + 1 px `border-selected-strong`, white 16 px check; label gap 8; row h 24 |
| Radio on | `2015:20366` | 16 px circle; plan extracts ring/dot from the SVG |
| Switch on | `2015:24698` | track 32 × 16 radius full bg brand; knob 14 px `icon-onbrand`, 1 px inset; row h 24, label gap 8 |
| Tabs | `2015:27784`, `_Tab 2015:27759/27765` | each tab h 24, px 8, radius 5, gap 4; selected bg `bg-secondary` + strong weight; unselected transparent, `text-secondary` |
| Badge small | `2012:35028` | h 16, px 4, radius 5, 1 px `border`, body/medium |
| Tooltip | `2015:39096` | bg tooltip, radius 5, px 8 py 4, max-w 200, 12 × 6 arrow, tooltip elevation |
| Menu panel | `2327:96374` | bg menu, radius 13, py 8, menu elevation; rows min-h 24, px 8 inside px 8 gutter, radius 5; hover bg `menu-selected`; divider 1 px `border-menu` in a 16 px row |
| Modal header | `2327:122027` | h 40, title strong weight at 16 px inset, 24 px close button, 1 px bottom `border` |
| Modal footer | `2327:122061` | h 40, CTAs right with 8 px gap and inset, secondary + primary buttons, 1 px top `border` |
| Modal sizes | Templates `2327:134405` (320), `2327:134403` (480) | widths 320 / 480, body padding 16 |

## Architecture

### 1. Token layer (`packages/ui/src/styles.css`)

1. **shadcn tokens bind to Figma variables.** Example mapping (fallback = kit light value):
   `--background → --figma-color-bg`, `--foreground → --figma-color-text`, `--primary → --figma-color-bg-brand`, `--primary-foreground → --figma-color-text-onbrand`, `--secondary → --figma-color-bg-secondary`, `--muted → --figma-color-bg-secondary`, `--muted-foreground → --figma-color-text-secondary`, `--accent → --figma-color-bg-hover`, `--border → --figma-color-border`, `--input → --figma-color-bg-secondary`, `--ring → --figma-color-border-selected`, `--destructive → --figma-color-bg-danger`, `--popover → --figma-color-bg`, `--popover-foreground → --figma-color-text` (Figma popovers are light; only menus are dark, and the menu components set `bg-figma-bg-menu` explicitly), `--card → --figma-color-bg`.
2. **`figma` namespace for tokens shadcn lacks**, exposed through `@theme inline` as `--color-figma-*` so Tailwind utilities like `bg-figma-bg-secondary`, `text-figma-text-secondary`, `border-figma-border-translucent` exist. One `--color-figma-*` per row of the colour table above.
3. **Fallback palettes.** `:root` carries the light fallbacks; `.dark` carries the dark fallbacks (Storybook, tests). `html.figma-dark` shares the `.dark` fallback block; inside Figma the injected values win regardless, so the block only matters for any variable Figma does not inject. The current OKLCH palette and the `data-slot` override block from April are removed.
4. **Global scale.** `@theme` overrides: `--text-xs: 9px/12px` (small), `--text-sm` and `--text-base: 11px/16px` (body; shadcn uses `text-base` for input bodies), `--text-lg: 13px/20px` (large), `--text-xl: 15px/24px`; `--radius-sm: 2px`, `--radius-md` and `--radius-lg: 5px` (shadcn puts `rounded-lg` on controls), `--radius-xl: 13px` (panels); `--font-weight-medium: 450`, `--font-weight-semibold: 550`; `--spacing` stays 4 px. These make unmatched components shrink and round consistently without edits.
5. **Font.** `@font-face` for Inter variable (Latin subset, woff2) with `font-weight: 100 900`, inlined by the Bun build as a data URI. `--font-sans: "Inter", system-ui, sans-serif`. Letter-spacing utility `tracking-ui3` = 0.005em.
6. **Elevation tokens:** `--shadow-tooltip`, `--shadow-menu`, `--shadow-dialog` in `@theme`.
7. **shadcn base variants.** `styles.css` imports `shadcn/tailwind.css`, which defines the `data-open`, `data-closed`, `data-checked`, `data-unchecked`, `data-selected`, `data-disabled`, `data-active`, `data-horizontal` and `data-vertical` custom variants (mapping to Radix `data-state`/`data-orientation` attributes), the accordion keyframes and the `no-scrollbar` utility. Without it, 220 variant usages across the shadcn components compile to selectors Radix never emits; this was a pre-existing gap found during Task 8 and fixed in the token layer.

### 2. Component pass (`packages/ui/src/components/ui/*.tsx`)

Fifteen component families (sixteen files; Dialog and AlertDialog share a spec) are edited to the kit specs above: `button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `tabs`, `badge`, `tooltip`, `dialog`, `alert-dialog`, `dropdown-menu`, `context-menu`, `menubar`, `command`. Rules:

- Keep Radix primitives, props and exported names unchanged. Only class lists, cva variants and small structural tweaks (e.g. a 24 px chevron slot) change.
- `size` variants: `default` = kit default (24 px), `lg` = kit large (32 px), `sm` = 20 px, `icon` = 24 × 24. Buttons: `default` = primary, `secondary` = translucent border, `ghost` = transparent with `bg-hover` on hover, `destructive` = `bg-danger`, `outline` = alias of secondary, `link` = `text-brand`.
- Icons: 16 px glyphs inside 24 px slots; lucide stroke-width 1.5 to approximate UI3's 1 px icons (an approximation, noted in the parity story).
- Menus (dropdown, context, menubar, select content, command) share one set of classes: dark panel, radius 13, 8 px gutter, 24 px rows, blue hover with white text, 16 px divider rows, shortcut text at 70 % white.
- Dialog and AlertDialog gain `DialogHeader`/`DialogFooter` styling of 40 px bars with dividers; content widths default 320 with a `size="lg"` of 480.

The remaining components (Label, Separator, Skeleton, Progress, Slider, Toggle, ToggleGroup, Popover, HoverCard, Sheet, Drawer, Alert, Card, Avatar, Table, Accordion, Collapsible, ScrollArea, Resizable, Breadcrumb, Pagination, NavigationMenu, Carousel, Chart, Calendar, Sidebar, InputOTP, InputGroup, AspectRatio, Sonner) are not edited beyond what the global scale and tokens change. If one renders broken (overflow, unreadable) after the scale change, the fix is limited to the offending class.

### 3. Storybook parity stories (`apps/storybook`)

- New section `UI3/<Component>` with one story per matched component: left the live component in its main states, right the kit's reference PNG, repeated in a light frame and a `.dark` frame. Reference PNGs are exported once via the Figma MCP (`get_screenshot` on the kit nodes above) into `apps/storybook/src/stories/UI3/refs/`.
- A global theme toolbar toggle (`light` / `dark`) that sets `.dark` on the preview root, so every existing story can be checked in dark too.
- Existing stories keep working; their defaults simply render smaller.

### 4. Plugin sampler (`packages/ui/src/app.tsx`)

Restyled to read as a Figma panel: section headers in strong weight, 8 px gutters, controls in 24 px rows, one dialog and one menu trigger so the dark menu and the 40 px dialog bars can be checked live. `showUI` size changes to 320 × 480 to match the kit's panel width. No new behaviour.

## Sequencing

1. **Spike (first task, in Figma desktop):** run the plugin, dump every `--figma-*` custom property on `document.documentElement` in light and in dark, and check `document.fonts.check('450 11px Inter')`. Output: the authoritative variable list committed as `packages/ui/src/figma-variables.md`, and the font decision confirmed (inline Inter unless the iframe already provides it).
2. Token layer, global scale, font, elevation; remove the April override block. All tests green; Storybook builds.
3. Storybook theme toggle + parity story scaffold + reference PNG export.
4. Components, one commit each, in this order: Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog + AlertDialog. Each commit: `.tsx` edit, test updates if a test asserted old classes, parity story.
5. Sampler restyle and `showUI` size.
6. Changeset (`minor` for `@repo/ui`), PR.

## Testing

- `bun run test`: all 92 tests pass. Tests that assert specific Tailwind classes are updated in the same commit as the component.
- `bun run types`, `bun run lint`, `bun run build`, Storybook build: green.
- Visual: every parity story signed off by Jonas in light and dark; final run of the plugin in Figma desktop in both themes.

## Risks and limits

- The injected variable names may not match the kit's names one to one (e.g. `bordertranslucent`). The spike produces the real list; any gap gets a documented fallback.
- Radix structure can keep a few components within a pixel or two of the kit rather than exact (Select trigger chevron, menu sub-trigger). Recorded in the parity story.
- Inter inlining adds ~100 KB to `dist/index.html`. Acceptable; revisit only if the bundle crosses 1 MB.
- Lucide icons are 2 px-stroke by design; 1.5 px is an approximation of UI3's 1 px icon set. Replacing the icon set is out of scope.

## Out of scope

- New UI3 primitives the project does not have (numeric input, colour input, segmented control beyond ToggleGroup, comments, notifications/visual bells).
- Icon set replacement.
- Dependency majors, docs drift, structural cleanup (streams 2 and 3).

## Acceptance

- All fifteen matched component families have an approved parity story in light and dark.
- Unmatched components render without breakage at the new scale.
- Colours in the running plugin change live when Figma's theme is switched, with no reload.
- `bun run test`, `types`, `lint`, `build` and the Storybook build pass; a changeset exists.
