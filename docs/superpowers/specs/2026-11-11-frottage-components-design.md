# Frottage components with props and variants: design

## Intent

An imported page should read like a design system, not a picture of one: a button on the page is an instance of a `Button` component set whose Variant, Size and State come from the site's own code, with the label as a text property. A designer changes `outline` to `default` in the right panel and the button changes, as in a library they built themselves.

Today Frottage makes components only from repeated page structure (`packages/figma-mapper/src/components.ts`): identical subtrees become one main with instances and text overrides, and a captured hover becomes a `State=Default` / `State=Hover` set. It has no props and no variants beyond hover, because the page structure alone doesn't say which differences are a variant and which are a different component.

The code does say it. Measured on live production sites on 2026-11-11 (Chromium, script in the page's own JavaScript world):

- **React** (mainline-nextjs-template, ui.shadcn.com, the Mainline Astro template's React islands): every rendered element carries its React fiber; walking up gives the component and its props. Names are often minified (`o`, `s`), some survive (`Card`, `CardContent`, `CarouselItem`, Radix `Primitive.div`), and props survive: the Mainline button is `{ variant: "outline", size: "icon", disabled }`.
- **shadcn v4** marks the DOM itself: `data-slot="button"`, `card`, `card-content`, `accordion-item`, … (all three React sites); ui.shadcn.com also `data-variant`, `data-size`.
- **Mainline buttons** (measured per button): Next.js 11 `data-slot="button"`, all with fibers, 7 with `variant`/`size` props (`outline`, `default`, `icon`); Astro 9, 6 in React islands with props, 3 static HTML with only `data-slot`.
- **Vue 3** (vuejs.org, nuxt.com): the app's root element holds the whole component tree with real names (`VTLink`, `VTSocialLink`, `ULink`, `UIcon`) and props (`size: "small"`, `icon: "github"`). Nuxt UI marks `data-slot` too.
- **Svelte** (svelte.dev): nothing per element. **Angular** (angular.dev, v22): custom-element tag names only (`docs-text-field`).
- The extension can read this with its current permissions: `chrome.scripting.executeScript` with `world: "MAIN"` under `activeTab` read the Mainline button's `variant` and `size`; the default isolated world (where the capture runs today) sees nothing.

## Goals

1. **Button first, fully right**, on the owner's test sites (Mainline in Next.js and in Astro): one `Button` component set; variant properties from the code's props (`Variant`, `Size`, and `Disabled` when it varies); a `Label` text property; an `Icon` instance-swap property and a `Show icon` boolean when some buttons have an icon and others don't; every button on every device frame an instance with its properties set.
2. **Then the same path for** Badge, Input, Card (header, content, footer as nested instances) and Accordion item, enough to prove the approach on both Mainline templates.
3. **Only what the page shows:** a component set holds the property combinations that occur on the page, never the full cross product the code allows. Names come from the site (a readable component name or a `data-slot`), never invented.
4. **Fallback stays:** where no code or marker identifies a component (Svelte, Angular, static HTML), today's repeated-structure components are made exactly as now.

## Non-goals

- Every combination the code allows; reading a component's source or prop types.
- Svelte and Angular code-reading; React class names restored from minified builds.
- Focus, active and open states (hover stays as today, see below).
- Figma slot properties (the Plugin API can define `SLOT` properties but `setProperties` can't fill them on instances yet); Card's parts are nested instances in this stage.
- Code Connect or exporting components back to code.

## Anti-goals

- A component set nobody asked for: variants from props that don't change the look (`asChild`, `type="button"`, `aria-*`, handlers).
- Leaking the user's data into the file through props: only token-like prop values are recorded (see Privacy).
- An import that's slower or bigger for pages without components than today.

## How it works

### 1. In the page: a component probe (new package)

`packages/component-probe` holds code that runs in the page's own world (`world: "MAIN"`), injected by the extension's service worker right before the capture of each size, with one adapter per source:

- **react** — from each element's `__reactFiber$…` key, walk `return` to the nearest function, forwardRef or memo component; name = `displayName || name` (unwrapping forwardRef/memo), props = `memoizedProps`.
- **vue** — from the element holding `__vue_app__`, walk the vnode tree (`component.subTree`, `children`, suspense branches); each component's root element is `vnode.el`; name = `type.name || type.__name`; props = `component.props`.
- **markers** — `data-slot` (name), `data-variant`, `data-size`, `data-state`, and custom-element tag names (`docs-text-field`), readable without any framework.

The probe tags each identified component's root element with a temporary attribute (`data-frottage-c="<n>"`) and returns, per `n`: `{ source, name, props }`. The capture (isolated world, as today) reads the attribute onto the captured node; the attributes are removed when the capture ends, on every path. Several sources on one element merge: a readable name from code wins over a `data-slot`, a minified name (≤ 2 characters, or matching `^[a-zA-Z_$][\w$]?$`) loses to a `data-slot`, and props from code join `data-variant`/`data-size`.

### 2. In the file: a bounded `component` field

`schemaVersion` stays 1. A captured element node may carry `component?: { name: string; source: "react" | "vue" | "marker"; props: Record<string, string | number | boolean> }`; name ≤ 40 characters, at most 16 props, keys ≤ 40, string values ≤ 24. Older files have none and import as today.

**Privacy (fixed rule, amended 2026-11-11):** a prop is kept only if its value is a boolean, a finite number with |n| ≤ 10000, or a string matching `^[A-Za-z0-9_-]{1,24}$`; keys `children`, `className`, `class`, `style`, `key`, `ref`, `id`, `href`, `src`, `alt`, `title`, `value`, `placeholder`, `name`, `label`, `defaultValue`, `text`, `content`, `description`, `email`, `query`, `search`, `initials`, `username`, any key starting `on`, `aria-`, `data-` (other than the marker props above) or `user`, any key ending `Id`, `ID`, `Name` or `name`, and any key holding `=`, `,` or `|` (they break Figma variant names) are never kept. One word can still be a person's (`label: "Jonas"`), so keys that hold words are refused whatever the value. The rule is zod-free in `@repo/capture-schema/component-rules`; the probe uses it and the schema refuses a file whose `component.props` break it. Labels never come from props; they come from the captured text, as today.

### 3. In the mapper: component sets from props

For each component name on a page (across all device captures, in the page's own language):

- **Variant properties** are the kept props whose values differ between that component's occurrences and whose occurrences differ in look (fills, strokes, effects, padding, size class, text style). A prop that varies without changing the look is dropped from the variants. Property names are the prop names capitalised (`variant` → `Variant`, `size` → `Size`, `disabled` → `Disabled` with values `true`/`false`); values as written.
- **One variant per distinct combination seen**, built from its first occurrence (widest device first, as today's mains).
- **Text property** `Label`: the component's main text layer when occurrences differ in it (the text's own Language binding, if any, stays on each instance).
- **Icon**: when occurrences differ in having an svg child, a `Show icon` boolean; when they differ in which svg, the icons become components themselves (one per distinct svg markup, named from the svg's `data-icon`, class or `aria-label`, else `Icon <n>`) and the button gets an `Icon` instance-swap property.
- **Hover** stays as captured: a variant captured with a hover adds `State=Hover` beside `State=Default` for that combination only.
- Layers inside a variant bind to Theme tokens exactly as today's mains do.
- Components identified by code or markers are taken out before today's repeated-structure pass, which then runs on what's left.

**Settled after the builder check:**

- **Which named components become sets (owner, 2026-11-11):** a component named by code or a marker becomes a component set only when it occurs at least twice on one device frame (buttons, cards, accordion and carousel items on Mainline). One that occurs once per frame (Navbar, Hero, layout wrappers) stays plain layers, as today. Framework pass-through wrappers (Radix `Primitive.*`, Next's `__next_*` boundaries, `Slot`) are never sets themselves; their props pass to the component they wrap.

- **One set per page, shared by every device frame.** Component sets are built in the device merge (`mergeDevices`), not per capture, and live in one Section below the frames. A main binds to Theme tokens like today's mains, and those tokens already resolve per Breakpoint and Device mode, so an instance on the Phone frame (Breakpoint `base`) shows the Phone padding and text size without a Device variant. A difference between devices that the tokens don't explain is treated as in the next point.
- **Same props, different look → not joined.** An occurrence whose props match a variant but whose look or structure differs from it (a class tweak, an extra child) does not become an instance of it; it stays as today (a structural component if it repeats, else plain layers), and the report counts it: `2 buttons look different from their Button variant and stay as they are.` The import never changes how something looks to fit a set.
- **A missing prop is the code's default.** Measured on both Mainline templates: the default button carries no `variant` prop. When some occurrences have a prop and others don't, the missing value is named `default`.
- **Occurrences without props** (Astro's static buttons, measured: 3 of 9 have only `data-slot="button"`) join the variant whose look and structure they match exactly; otherwise as the point above.
- **Re-import matches only Frottage's own sets**, tagged in shared plugin data like the collections (`<host>#component:<name>`); a user's own `Button` set is never touched. New combinations are added as variants; existing variants and their instances stay.
- **Stage 2 Card** is planned in its own design pass; this design only requires that Stage 1 doesn't block nested instances.

### 4. In Figma

The sandbox makes each component set with `combineAsVariants`, adds the `Label` / `Show icon` / `Icon` properties with `addComponentProperty` and binds them to their layers (`componentPropertyReferences`), and sets every instance's properties with `setProperties` (the `#id` suffix for text, boolean and swap). Sets go where today's mains go (the Section below the frames). Re-import into a file that already has a set of that name adds missing variants to it and keeps the rest.

### 5. What the user sees

- Popup: nothing new.
- "What's in this file": the existing Components option; its line gains a count, e.g. `Components: Button (4 variants), Card, Badge`.
- Report: `Button: 4 variants from the page's code (Variant, Size).`; `3 components named by shadcn markers.`; a minified name replaced: `A component named "o" in the code was named Button from its data-slot.`

## Constraints

- No new extension permissions; the MAIN-world probe runs under `activeTab`, before each size's capture, and must not change what the page shows (only the temporary attributes).
- Bundle boundaries: the probe is its own injected script, small, no Zod; `scripts/check-bundles.sh` gains a limit for it.
- Mode limits, Language bindings, Color Mode and Breakpoint behaviour unchanged; a variant main opens on its frame's Device, Breakpoint, Color Mode and Language modes like today's mains.

## Decided by the owner

- Start with the button and get it fully right; then Badge, Input, Card, Accordion item (2026-11-11, "follow your recommendation").
- Only the combinations the page shows, not every combination the code allows.
- Read the code where the site exposes it; keep today's structural components as the fallback; no debugging tools.
- A named component becomes a set only when it occurs at least twice on one device frame.

## Calls made by the author (owner may change)

- The probe tags elements with a temporary attribute rather than passing DOM paths, because the capture and the probe run in different JavaScript worlds and paths drift between them.
- `Disabled` is a variant property, not a boolean property: Figma's boolean properties only show or hide layers, and disabled changes colours.
- Card's parts are nested instances, not slots (slots can't be set on instances through the Plugin API yet).
- The prop privacy rule above (token-like values only).
- The minified-name rule (≤ 2 characters) for preferring a `data-slot`.

## Left to the builder

- How the React walk stops (depth limit, skipping framework internals such as Next's `__next_*_boundary__`, `Primitive.*` wrappers that only pass props down).
- How "differ in look" is computed from the existing op signatures in `components.ts`.
- Layout of variants inside a set (a grid by property, as Figma users expect, is preferred).
- The exact report wording beyond the lines above, keeping the codebase's style.

## Stages

1. Probe + schema field + Button component set end to end on Mainline (Next.js and Astro), owner's Figma check.
2. Badge, Input, Card (nested parts), Accordion item; Vue adapter checked on a Nuxt UI page.
