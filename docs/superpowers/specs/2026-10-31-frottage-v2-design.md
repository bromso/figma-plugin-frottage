# Frottage v2 design: usable, complete, multi-version imports

Date: 2026-10-31. Status: approved by the owner on 2026-10-31.

Builds on `2026-10-31-frottage-design.md` and the Phase 0 and Phase 1 results in this folder. Decisions there stand unless changed here. This assumes PR #1 (Phase 1) merges first.

## Intent

The owner wants Frottage to match the import features of html.to.design (screenshots from the owner: multi-import options, import options, font mapping, file import), and to use newer Figma features: variables, collections, modes, annotations and specs. The test page is `https://www.volvogroup.com/en/`, a real site the owner doesn't own.

Success is importing that page and having a file a designer can work in straight away.

## Decisions by the owner

- Build the feature set below.
- **URL import and sending from AI tools are parked.** Frottage stays local: no backend, `networkAccess: ["none"]`.
- **No `debugger` permission for now.** Chrome doesn't allow it as an optional permission, so every user would see "Read and change all your data on all websites" at install. Multi-version capture takes a few more clicks instead. If that proves annoying, a separate debugger-based capture extension can be added later using the same file format.

## What volvogroup.com showed (measured 2026-10-31 at 1664 px)

| Finding | Effect |
|---|---|
| 297 shadow roots: `vcdk-system-icon` 178, `vcdk-link` 97, `vcdk-theme-provider` 11, others. 790 elements inside, 121 slots | Phase 1 skips shadow DOM, so most of this page would be missing. **Shadow DOM moves to Stage 1.** |
| 1,350 light-DOM elements, depth 23, 5,720 px tall | Within limits |
| 271 flex, 4 grid, 448 block elements | Auto layout has real work to do |
| 472 CSS custom properties readable | Good source for variable names |
| Images on `assets.volvo.com`, read with CORS, served as WebP | Expected to import without extra permissions |
| 27 background images, one video with a poster | Background and poster handling matter |
| Fonts are Volvo Novum, a brand font | Not in Figma unless installed, so the font table matters |
| No `prefers-color-scheme` rules, no `hreflang` links | Dark mode and languages have no automatic route on this page |

The `vcdk-*` tag names are an honest source of component detection: a custom element is a component by the site's own definition.

## Goals by stage

Each stage ships on its own. Order is the author's call.

### Stage 1: usable structure

- Shadow DOM traversal, open and closed, with slots flattened.
- Auto layout: propose, verify, fall back, as in the original design, including its verification rules. Simple CSS grids map to Figma `GRID`.
- Readable layer names by the original naming rules. **HTML layer names** is an option, off by default.
- Text styles and colour variables, reusing Frottage's own on repeat imports.
- **Use existing local styles:** on, matches by value to the file's styles and variables, and doesn't change them.
- **Hyperlinks:** on, using `setRangeHyperlink` for text. Query strings stay removed, per the Phase 1 privacy rule, so links point to the bare page.
- **Font table:** shows each missing font, and the user picks a replacement before import.
- SVG as real vectors, pseudo-elements, video poster frames.

Exit: volvogroup.com imports with all visible text, at least 70% auto layout on its flex sections, and readable names on at least 80% of frames.

### Stage 2: complete capture

- **Components from custom elements:** repeated custom elements become one component with instances, so 97 `vcdk-link` elements give one component.
- **Hover components:** read `:hover` rules from readable stylesheets, apply them to a copy of the computed style, and build a variant. No debugger is needed. Rules in unreadable cross-origin stylesheets are skipped and reported.
- Optional image permission for CDNs without CORS, as in the original design.
- Gradients, filters, transforms and `z-index`.
- **High-res images:** capture at device pixel ratio, up to the 4096 px limit. Free.

### Stage 3: multiple versions

- **Viewports:** the popup offers widths. Frottage resizes the window for widths Chrome allows, and captures each. For narrow phone widths, the popup explains DevTools device mode, then captures that view.
- **Themes and languages:** the user switches them on the site, then captures. Frottage labels each capture.
- **Combining:** the plugin accepts several `.frottage` files for one page and creates one frame per version, side by side.
- **One shared token set:** one variable collection, with one mode per version. Colour, spacing and type values differ by mode where the versions differ.

Limits to be honest about:

- Modes change values, not structure. A desktop and a phone layout stay separate frames; one frame doesn't morph between them.
- Figma's Starter plan has no variable modes, Professional allows up to 10 per collection, Organization up to 20. On `Limited to N modes`, Frottage keeps the frames, uses the first version's values, and says so in the report. It never fails the import.
- Languages are separate frames in this stage. String variables per language are a later idea.

### Stage 4: handoff

- Annotations on frames: alt text, link targets, landmark and heading roles, in Dev Mode.
- Specs: spacing, radius and type token names as pinned annotation properties on key frames.
- Mark imported root frames with `devStatus` only if the owner later wants it. Off by default.
- Dev Mode needs a paid plan to view. Annotation data is written on every plan where the API allows it, with shared plugin data as a fallback.

## Import options screen (author's call)

Grouped like the reference screens, using `@repo/ui`, remembered per domain with `figma.clientStorage`:

| Option | Default |
|---|---|
| Auto layout | On |
| Create styles and variables | On |
| Use existing local styles | On |
| Components | On |
| Hover components (slower) | Off |
| Hyperlinks | On |
| HTML layer names | Off |

## Non-goals

- URL import, any backend, and AI tool connections.
- The `debugger` permission.
- Paid tiers: every option is free.
- Importing `.html`, `.mhtml`, `.zip` or email files.
- Rendering Figma Make or Slides output.
- Mapping to a team's published libraries.
- Morphing one frame between breakpoints.

## Anti-goals

- A password or typed value reaching any file, in any version.
- Editing a user's existing styles or variables.
- Silent loss: anything dropped appears in the report.
- Duplicated tokens on repeat imports. The Volvo import shouldn't repeat html.to.design's 257 text styles for three pages.

## Constraints

- All Phase 1 constraints stand: limits, permissions, `networkAccess: ["none"]`, batch size 50, auto layout set during creation.
- Text widening stays, and auto layout verification must allow for it.
- `schemaVersion` moves to 2 only if a change breaks v1 files. Multi-version data lives in file metadata: `{ groupId, label, kind: "viewport" | "theme" | "language" }`.
- Volvo Group's page and brand font stay out of the repository. Fixtures reproduce its patterns, such as shadow DOM with slots.

## Settled details (author's calls)

**Relation to the original roadmap.** v2 replaces the original Phases 2 and 3. Their items sit in the stages above; the Cancel button and node-limit UI join Stage 2. The original Phase 4 release follows Stage 4. Browser Figma stays open until a private plugin exists.

**Measuring Stage 1.** Automated tests use a repository fixture that copies the Volvo patterns: nested shadow roots with slots, `vcdk`-style custom elements, CDN-style images and a missing font. The real check is manual: the owner captures volvogroup.com, keeps the file private, and an agent measures the import through the Desktop Bridge. "Flex sections" means frames from `display: flex` or `inline-flex` elements. "Frames" means every frame in the import. "All visible text" means every string in `document.body.innerText` that the capture is expected to hold appears in a text node, with exceptions reported.

**Components.** A component is defined by tag name plus a structural signature: the child tag tree, with text and image content excluded. Same signature means one main component; other instances differ by overrides for text and images. Different signatures under one tag become separate components named `tag / 1`, `tag / 2`. Icons compare by SVG markup, so each distinct icon is its own component. A hover state is a variant on that component set, with a `State` property of `Default` and `Hover`.

**Multi-version files.** One capture makes one `.frottage` file. Each file holds `{ label, kind }` from the extension. The plugin groups the files the user picks, using the page URL, and creates the group. Mode values match in this order: same CSS custom property name, then same role for text styles (`heading/1` to `heading/1`), then same colour value. Anything unmatched stays a plain value in its own frame. `schemaVersion` stays 1 while additions are optional fields.

**Tokens.** Matching to existing local styles is exact by value, with no fuzzy matching. A match binds to the user's style and creates nothing. With no match, Frottage creates its own. The collection stays per hostname, and versions add modes to it.

**Font table.** The table appears only when fonts are missing, and it pre-fills the nearest match. It never blocks import: Import proceeds with those choices. Choices are remembered per family name in `clientStorage`.

**Viewports.** Preset widths are 1512, 1440, 834, 393 and 390, and each is editable. The extension changes a normal window with `chrome.windows.update`, which needs no new permission, and restores it afterwards. A maximised or minimised window is set to normal first. If Chrome gives a different width, the capture is kept, labelled with the real width, and the popup says so.

**Hover.** The capture stores hover differences on each element as an optional field, because the plugin has no DOM. `:hover` rules are read in the page, including inside shadow roots and `adoptedStyleSheets`, and only for elements in repeated components, to keep files small.

## Left to the builder

Internal layout of the plan additions, the exact auto layout thresholds if testing shows better values, popup layout, and how each stage is split into tasks.

## Risks

| Risk | Mitigation |
|---|---|
| Figma ships structured capture | Local, open and free remain the case for Frottage |
| Auto layout fails on real pages | Local fallback, tested on Volvo in Stage 1 |
| Chrome won't resize windows to a requested width | Report the real width, and fall back to the DevTools route |
| Heavy pages with several versions are slow | Measure in Stage 3, with the 20,000-node limit per version |
| `:hover` rules can't reproduce script-driven hovers | Those are skipped and reported |
