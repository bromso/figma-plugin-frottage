# Frottage intent capture: design

Date: 2026-11-03. Status: approved by the owner on 2026-11-03. Builds on `2026-10-31-frottage-v2-design.md` (Stages 1 to 3, shipped) and `2026-11-01-frottage-one-press-capture-design.md` (shipped in PR #5).

## Intent

Frottage today imports a page as faithful, editable layers with auto layout, shared tokens, repeated-element components and one frame per captured width. The next step is to recover the *intent* behind the page: the component model, the token architecture and the responsive behaviour a developer wrote, and rebuild it with native Figma constructs. Framework conventions (shadcn, Tailwind, later Bootstrap, MUI and others) are the means; the result should feel like the coded site was rebuilt in Figma, not traced.

The plugin serves three groups, all equally:

- teams bringing their own coded design system into Figma,
- designers reverse-engineering someone else's product,
- auditors checking a site against its own system.

Where their needs conflict, **fidelity to what the site actually contains wins over tidiness**. Cleaning up is the user's job, not Frottage's.

## Decisions by the owner

These came out of the brainstorming session on 2026-11-03.

**Fidelity**
- Near-identical values stay separate. Two blues that differ slightly become two variables, and the difference is pointed out.
- Component sets include every variant the site's stylesheets support, including ones the captured pages don't show. A variant whose styles aren't in the site's CSS is left out, never rebuilt from a framework's stock look. Framework knowledge may be used to *recognise* what is in the stylesheet (for example, matching shadcn's known Button variant class lists against Tailwind's generated CSS), never to invent.

**Several pages in one import**
- The user starts from one page. The extension suggests 5–10 more pages, taken from `sitemap.xml`, else from the main navigation, else from links found on the page. The user accepts or declines each and can add more by hand.
- All accepted pages go into one import. A component found on several pages is built once.
- Links between captured pages become prototype connections (click navigates to the target page's frame).
- Pages are captured in the user's own browser, so logged-in pages work.

**Component naming**, first source that gives a real word wins:
1. the real component name, when the page exposes one (development builds, explicit `displayName`, Vue or Angular names),
2. the framework's own DOM markers (`data-slot="button"`, `MuiButton-root`, `ant-btn`, `chakra-button`, `mantine-Button-root`, `.btn`, `.card`),
3. ARIA role or element (`role="dialog"` → Dialog, `<button>` → Button, `<nav>` → Navigation),
4. Frottage's existing Stage 2 names.

Minified names (`Xe`) are never used. Each component's description records where its name came from.

**Component properties**
- An optional part that looks the same every time it appears becomes a boolean property (a Card's top image).
- An area whose content differs between uses becomes a slot (a Card's body). Measured: `component.createSlot()` works, the slot appears as a property, and instances accept content in it.
- Nested components (an Input inside a Card) are nested instances.

**Modes over variants**
- Size, colour and other captured component choices become mode-based variable collections (a "Size" collection with `sm`, `md`, `lg`; a "Button colour" collection with `primary`, `destructive`, …) instead of extra variants. These collections alias into the theme layer.
- Interactive states (hover, pressed, focus, disabled, open) stay **variants**, because Figma's prototype interactions switch variants. A size or colour change that alters structure, not just values, also stays a variant.
- The extension always captures everything. The plugin discovers the file's real mode limit at import time (Figma throws `Limited to N modes only`) and builds the overflow as variants, so nothing is lost. Plan limits are not hard-coded; Figma's published numbers have changed over time (Professional 10, Organization 20, Enterprise unlimited with extended collections, per Figma's plans page in November 2026).

**Variables and theme**
- Names are the site's own, with the framework prefix removed (`--bs-primary` → `primary`).
- Layers: primitives (raw colour, spacing, radius, type) → theme (semantic: `background`, `foreground`, `primary`, `border`, `ring`…) → component collections (size, colour). The theme holds the light/dark modes. Components bind to the theme or component collections.
- On a site with no named tokens, Frottage infers only clearly evidenced theme roles (`background`, `foreground`, `border`, `primary`, `muted`, `muted-foreground`). A colour that doesn't clearly fill a role binds directly to its primitive. Each variable's description says "From the site" or "Inferred: <evidence>", for example "Inferred: used on 82% of body text".
- Dark mode is read from the stylesheets automatically (`.dark { … }`, `[data-theme=dark]`, `@media (prefers-color-scheme: dark)` blocks). When none is found, the report says so and points to the Stage 3 capture-and-label route as the fallback.

**Responsive: one frame per page**
- Each page is one frame driven by a **Breakpoints** collection with one mode per breakpoint, using the framework's own breakpoints (Tailwind: 640, 768, 1024, 1280, plus site-specific ones like 1400).
- Use everything Figma offers to behave like coded responsive layout: auto layout fill/hug, min/max width and height, wrap, grid layout, layout grids, and breakpoint variables bound to widths, padding, gaps, type sizes, layout-grid columns and visibility.
- Measured limit: layout direction, wrap on/off, alignment and a grid layout's column/row count **cannot** be bound to variables. Parts that change those between breakpoints reflow through wrapping where possible; otherwise both versions are kept and toggled by a breakpoint boolean (last resort). The import report lists every section that needed duplication.
- This reverses the v2 non-goal "Morphing one frame between breakpoints". The Stage 3 one-frame-per-width import stays available for files that already exist and as the fallback when merging fails.

**Accessibility as annotations**, in plugin-created annotation categories:
- **Role and name** ("Button: Get started", "Navigation: Main"),
- **Images** (alt text, or "Decorative"),
- **Headings** (level h1–h6),
- **Focus order** (a number per focusable element, in tab order),
- **State** (expanded/collapsed, checked, disabled, current page),
- **Contrast** (text/background pair, ratio, WCAG AA pass or fail).

Where the plan doesn't allow annotations, the same text goes into layer descriptions and the report says so. This absorbs the v2 Stage 4 handoff annotations (alt text, link targets, landmarks, headings).

**Reveal and restore during capture**
- The extension may briefly interact with the page to reveal states that don't exist until a user acts: open a closed accordion item, open the mobile menu, toggle a disclosure. It records the revealed DOM, then restores the page exactly as it was (attributes, classes, open/closed state, scroll position).
- Interactions are limited to non-destructive reveals: no form submission, no typed input, no navigation, nothing that sends data. An element whose reveal can't be restored is skipped and reported.
- Dark mode is still read from the stylesheet first; toggling the theme class is the fallback where the stylesheet route finds nothing.

**Where the new import applies**
- The intent import becomes the default for every site. Tokens and theme, breakpoints (detected from any site's media queries, not only Tailwind's) and accessibility run everywhere. Framework adapters add component recognition where they recognise a framework; elsewhere, components come from Stage 2's existing tag-and-signature rule plus the naming chain above.
- Today's one-frame-per-width import stays available as an option on the import screen and as the fallback when merging into one frame fails. The existing options (Components, Hover components, Use existing local styles) are kept and extended, not removed.

**First version scope**
- Framework: shadcn on Tailwind v4.
- Reference sites: the Mainline template, built twice: https://mainline-nextjs-template.vercel.app/ (Next.js) and https://mainline-astro-template.vercel.app/ (Astro). Both must give the same components and variables, so recognition must work without React internals.
- Components: Button (all six stock variants: default, destructive, outline, secondary, ghost, link), Card, Accordion, Switch, Navigation.
- Other frameworks come later through the same adapter shape.

## Done means

On both Mainline builds:

1. **Components.** Buttons arrive as one Button component offering all six shadcn styles (each as a mode of the "Button variant" collection, or as a variant where the style changes structure, per the author's call below) plus hover, focus and disabled states as variants. Every button on every page is an instance of it.
2. **Theme.** Switching the page frame from Light to Dark changes the whole page correctly, with no colour left behind.
3. **Breakpoints.** Switching the frame from the 1280 mode to the 640 mode changes widths, spacing and type, shows the mobile navigation and hides the desktop one. Any section that can't reflow is named in the report.
4. **Bindings.** Almost no layer carries a raw colour, spacing or radius value. The report counts those that do.
5. **Prototype.** Clicking "Pricing" in the prototype goes to the Pricing frame.
6. **Same result on both builds.** The Next.js and Astro imports produce the same components and variables.
7. **Accessibility.** Contrast and focus-order annotations are present and match the site.

## Stages

Each stage gets its own plan and is checked against Mainline with the matching items above.

1. **Tokens and theme.** Primitives, the site-named or inferred theme layer, dark mode from the stylesheet, text styles bound to type variables, shadows as effect styles bound to variables, gradients as paint styles. Checks 2 and 4.
2. **Components.** The shadcn adapter: naming, variants from the stylesheet, size and colour as modes, states as variants, booleans, slots, nesting, the mode-limit fallback. Checks 1 and 4.
3. **Responsive single frame.** Breakpoints collection, reflowing layout, last-resort duplication listed in the report. Check 3.
4. **Several pages.** Suggestions from sitemap or navigation, accept/decline/add, one import, components built once, prototype links. Begins by measuring whether the extension can load and capture other pages with its current permissions. Checks 5 and 6.
5. **Accessibility annotations.** Check 7.

## Goals, non-goals, anti-goals

**Goals:** the decisions above, for shadcn on Tailwind v4, meeting the seven checks.

**Non-goals for this version:**
- Bootstrap, MUI, Ant Design, Chakra, Mantine and DaisyUI adapters (designed for, not built).
- Inventing variants or tokens the site doesn't contain.
- Mapping to a team's published Figma libraries.
- Crawling a site without the user accepting each page.
- The `debugger` permission, so no forced `prefers-color-scheme` or forced pseudo-states through DevTools. States come from stylesheet rules and framework state attributes, as hover does today.

**Anti-goals (a failure even if it technically works):**
- Silently merging near-identical values or dropping anything. Anything dropped appears in the report.
- Minified or meaningless names.
- Component sets so large that Figma becomes slow to browse, because sizes or colours were multiplied into variants instead of modes.
- Prototype hover interactions that stop working because states became modes.
- A password or typed value reaching any file (v2 anti-goal, unchanged).
- Editing a user's existing styles, variables or components (v2 anti-goal, unchanged).

## Constraints

- All v2 and one-press constraints stand: `networkAccess: ["none"]` in the plugin, no `debugger`, per-file limits (20,000 nodes, depth 256, 64 MiB JSON, 180 MiB assets), batches of 50, `*Async` APIs under `dynamic-page`, no typed values, URLs without query, fragment or userinfo.
- Extension permissions stay minimal (`activeTab` and the current set). If Stage 4 shows other pages can't be captured without host permission, that is brought to the owner before adding any permission; an optional, per-site permission request is the expected route.
- `schemaVersion` stays 1 while every addition is an optional field; existing files still import.
- Figma facts measured on 2026-11-03 in the owner's file (Professional plan): 10 modes per collection; bindable node fields are size and min/max, gaps (including grid row/column gap), padding, corner radii, stroke weights, opacity, visibility and text content; layout grids bind `count`, `gutterSize`, `offset`, `sectionSize`; effects bind colour, radius, spread and offsets; mode switching on a frame re-lays it out; `component.createSlot()` creates a working slot. Confirmed against Figma's plugin typings via Context7.
- Reference site content stays out of the repository. Repository fixtures reproduce Mainline's patterns (shadcn `data-slot` markers, Radix `data-state`, a `.dark` block, Tailwind v4 breakpoints), following the Volvo precedent.

## What the Mainline sites showed (fetched 2026-11-03, raw HTML and CSS only)

- Both use Tailwind v4 (4.1.14 Next.js, 4.3.3 Astro) with the identical stock shadcn theme variables in `:root` and exactly one `.dark { … }` block. Neither homepage shows a theme toggle.
- Breakpoints in both: 640, 768, 1024, 1280, 1400 px.
- Astro has `sitemap-index.xml` with 14 pages; Next.js has no sitemap, so its navigation (about, contact, FAQ, login, pricing, privacy) is the suggestion source.
- Next.js raw HTML: 11 `data-slot="button"`, an accordion with Radix `data-state` (29 closed items) and two switches. Astro raw HTML: 3 buttons and one card with `data-slot`, no Radix state; whether the rest appears after client-side rendering is unmeasured.
- Both stylesheets contain the class patterns of all six stock shadcn Button variants.

## Calls made by the author (owner may override)

- Gradients become paint styles (Figma has no gradient variables). Shadows become effect styles whose values bind to variables. Text styles bind to the type variables.
- Primitive colours on sites without named tokens are named by colour family and lightness step, from the site's own palette.
- When a sitemap has many pages, the 5–10 suggestions are chosen to cover different kinds of page (one blog post, not five).
- How "pointed out" works for near-identical values: a line in the import report plus a note in each variable's description naming its near twin.
- Each breakpoint is captured at a width inside its range (for example the breakpoint's minimum width), detected from the stylesheet's media queries; the one-press device list stays for Stage 3-style imports.
- A component found on several pages is matched by name source, framework marker and structural signature together.
- **Button styles under "modes over variants".** A style that differs from the others only in bindable values (fills, stroke colour and weight, padding, radius, opacity) is a mode of a "<Component> variant" collection. A style that needs something no variable can drive (text decoration, a different child structure) stays a variant. For shadcn's Button: default, destructive, secondary, outline and ghost become modes; link (underlined text, no padding box) is a variant. The builder confirms this split against the measured stylesheet.
- **Breakpoint modes include the base range.** Tailwind is mobile-first, so the range below the first breakpoint is a real layout. The Breakpoints collection has a `base` mode, captured at 390 px, plus one mode per breakpoint (Mainline: base, 640, 768, 1024, 1280, 1400 = 6 modes). Check 3 switches from 1280 to `base`.
- **Existing variables and earlier imports.** v2's rules stand: a value that exactly matches one of the user's own local variables or styles binds to it and creates nothing, and the user's items are never edited. Frottage's own collections, styles and components from an earlier import of the same hostname are reused and extended (new pages, new modes, new variants), never duplicated. This covers importing Astro after Next.js into one file only when hostnames match; different hostnames get separate sets.
- **Check 6 sameness.** "Same" means the same component names, variant and mode sets, and variable names. Values may differ where the two builds' generated CSS differs, and each difference is listed in the report. Components the Astro build doesn't mark with `data-slot` are recognised from class fingerprints and structure (naming steps 2 to 4), which Stage 2 must support anyway for sites without markers.

## Left to the builder

- The internal adapter interface (detect → extract tokens → identify components → infer variants and properties → emit), and how work splits between the extension (capture: everything that needs the DOM and stylesheets) and the plugin (build: everything that needs Figma). Adapters must compose, so shadcn runs on top of a Tailwind adapter.
- Thresholds for "clearly evidenced" theme roles and for "looks the same every time" versus "differs between uses".
- How the near-twin threshold is defined for pointing out near-identical values.
- Task breakdown within each stage.

## Unverified

- Whether `activeTab` allows loading and capturing other pages of the same site (Stage 4 measures first).
- Whether Astro's accordion and switch appear in the rendered DOM in Chrome.
- Which reveals restore cleanly on Mainline (Radix accordion, mobile menu sheet), measured at the start of Stage 2.
- Annotation categories and annotations on the Starter plan.
- Slot `preferredValues` and `slotSettings` behaviour in real Figma beyond creation and appending content.
- How a grid layout behaves when its frame is resized across breakpoints.
