# Frottage design

Date: 2026-10-31. Status: approved by the owner on 2026-10-31, including the recommended answers on positioning and on this repository becoming Frottage.

The owner skipped the question round and asked for the document directly. So apart from the starting point in the brief, **the product decisions below began as the author's calls**, which the owner reviewed in approving this document. Those calls are collected in [Calls to confirm](#calls-to-confirm). API facts were checked against Context7 and vendor documentation on 2026-10-31; anything not confirmed there is listed under [Unverified](#unverified-settled-by-phase-0).

## Problem statement

Designers often need to start from a page that already exists: to redesign it, extend it, or fix the gap between the shipped product and the Figma file. Rebuilding it by hand takes days, and an import is only worth it if the file needs little cleanup afterwards.

Frottage, named after the art technique of taking a rubbing from a textured surface, captures a rendered page in Chrome and rebuilds it in Figma as a file a designer can keep working in.

### The market is crowded, and that shapes this design

- **Figma** ships a free capture of its own, through the Figma Chrome extension and the `generate_figma_design` MCP tool. Per Figma's help page, captures are plain layers, some variables can bind when a library is present, and mapping to components and styles is on the roadmap but not available.
- **html.to.design** offers 10 free imports per 30 days, then Pro. It has URL import, several viewports, and a Chrome extension that uses the browser's debugger permission. Its own pages also claim auto layout and local styles on the free plan, font mapping, variables as an import option, and generated components with hover variants, the last on an unspecified plan. These are vendor claims. Independent measurements of their quality were not found.
- **Others** exist, including Web to Figma, Export to Figma, and Codia.

Consequences:

- **Getting pixels into Figma is commoditised.** A personal or open source tool cannot beat a free first-party feature on that alone.
- **Better structure than Figma's capture is plausible, but better than html.to.design is unproven.** Phase 0 tests this head to head before any product code is written.
- **The defensible position today is the combination:** free and unlimited, open source, an open format, and verifiably local. How html.to.design handles capture data was not established, so no comparative privacy claim is made here.
- **The gap may close.** Figma has said component and style mapping is coming. See [Risks](#risks).

## Target users

Author's call, inferred from the brief's emphasis on usable files:

- **Primary: a product designer or design engineer working from a live product they have access to**, including logged-in pages and local dev servers, who will keep editing the result.
- **Secondary: the owner**, as a personal tool. This repository becomes the Frottage product and stops being a template.
- **Not the target:** people who want a quick visual reference (Figma's free capture is enough), or who need to convert public URLs in bulk.

## What good output means

Frottage's measure is "how little cleanup does the file need?", not "how close is the screenshot?". Visual match is a floor, not the goal.

Targets for a v1 release, measured on the fixture corpus (numbers are provisional and may be tuned once Phase 2 produces real data):

| Measure | Target |
|---|---|
| Visible text that arrives as editable text nodes, not images | 100% of DOM text |
| Frames with auto layout on flex-based fixtures | at least 70% |
| Layers with a meaningful name, not a bare tag fallback such as `Div` | at least 80% of frames |
| Repeated text treatments and colours turned into text styles and variables | every value used 3 or more times |
| Visual difference from a Chromium screenshot, with fixture fonts installed | at most 3% of pixels at a 0.1 pixelmatch threshold |
| Import of a 5,000-node page | under 60 s, no single block of Figma's UI over 2 s, progress shown, cancel available |
| Anything Frottage could not convert is reported | always; nothing is silently dropped |

When structure and pixels conflict, **pixels win where the conflict is a layout error, and structure wins where it comes from text measurement**. A frame whose children are in the wrong place stays absolute. A frame that shifts only because a substituted font is wider stays in auto layout, as a designer would want (see [Layout inference](#layout-inference)). The pixel target applies only with fonts installed. A second run with fixture fonts missing must keep the auto layout target.

## Goals, non-goals and anti-goals

### v1 goals

1. Chrome extension (Manifest V3) captures the current tab's rendered DOM at its current size, including logged-in pages, SPAs in their current state, and local dev servers.
2. The capture is saved as a versioned `.frottage` file, which the plugin imports.
3. The plugin produces a Figma frame with semantic layer names, editable text, images, SVG vectors, effects, and auto layout where verified.
4. The plugin creates text styles and a colour variable collection from repeated values.
5. An import report lists substituted fonts, placeholders and unsupported features.
6. No backend, no account, no telemetry, and `networkAccess` stays `["none"]`.

### v1 non-goals

- **URL import from inside the plugin.** It needs a hosted headless browser, because the plugin cannot render or even fetch arbitrary pages. That also rules out logged-in pages, which are the point. It may come in v2.
- **Multi-viewport capture.** One capture at the window's current size. Responsive output means running two captures, which also gives a useful way to try a narrow layout using DevTools device mode (see Unverified).
- **Component detection and variants.** v2. Doing it badly creates more cleanup than it saves.
- **CSS grid mapped to Figma grid auto layout.** The API exists (`layoutMode = "GRID"`), but v1 keeps grid containers absolute and takes this up first in v1.1.
- **Re-import or sync** into an existing frame.
- **Mapping to the user's Figma libraries.**
- **Faithful reproduction of animations, hover states, or video playback.** The capture is one frozen state.
- **FigJam.** `editorType` becomes `["figma"]`.
- **Non-Chromium browsers.**
- **Element-level capture.** v1.1.

### Anti-goals

These would make v1 a failure even if it technically worked:

- Sending page content anywhere. A capture may contain private data from a logged-in session. It stays on the user's machine, in a file they control.
- Requesting the `debugger` permission. Its install warning reads "Read and change all your data on all websites" and Chrome shows a debugging banner on the page.
- Requesting `<all_urls>` at install. It stays optional and is requested only when needed, with an explanation.
- Mutating the captured page in a way that outlives the capture, other than scroll position, which is restored.
- Capturing the value of a password field. `input[type=password]` values are never read, in any mode.
- A file that looks perfect but is a pile of absolute layers. Figma's free capture already covers that need.

## Decisions

### Capture surface: Chrome extension only

The extension sees what the user sees: rendered DOM, resolved styles, loaded fonts, and session state. Logged-in pages, SPAs and `localhost` come free. The plugin has no way to do this. Author's call: extension only for v1.

Capture sequence:

1. The user clicks the toolbar action; the popup opens, which grants `activeTab` for that tab.
2. Optional pre-pass, on by default: scroll through the page to trigger lazy content, then return to the top. The original scroll position is restored afterwards.
3. `scripting.executeScript` injects the capture script in the isolated world, in the main frame.
4. The walker builds the capture tree, reading computed styles, boxes and text geometry.
5. Assets are collected and normalised to PNG, JPEG or GIF, at most 4096 px per side (Figma's limit), with a downscale noted in the report.
6. The container is built and downloaded as `<hostname>-<date>.frottage`.

### Transport: a local `.frottage` file

| Option | Backend | Privacy | Friction | Verdict |
|---|---|---|---|---|
| **File download, then pick or drop in the plugin** | none | best: local file | one extra step | **v1** |
| Clipboard paste into the plugin | none | good, but the clipboard is shared with other apps | low | Rejected for v1: paste in the plugin iframe is undocumented, and the payload can be tens of MB with images |
| Direct bridge: content script on figma.com talks to the plugin iframe | none | good | lowest | v2 candidate. Browser Figma only, since the desktop app is outside Chrome. It needs a figma.com host permission and relies on Figma's undocumented iframe structure |
| Localhost bridge | a native helper | good | install a helper | Rejected: plugin `allowedDomains` would need localhost plus `reasoning`, and users must run a second program |
| Hosted relay plus account | yes | worst: page content leaves the machine | low after sign-up | Rejected: it adds a running service and conflicts with the first anti-goal |

**Decision (author's call): local file.** It works identically in Figma desktop and browser, needs no server, and lets the plugin keep `networkAccess: ["none"]`, a privacy property anyone can verify by reading the manifest. html.to.design offers a similar `.h2d` file route, so the flow has precedent.

Dropping a file on the iframe's DOM is unverified: Figma's documentation covers drops onto the canvas, not onto the UI itself. The plugin always offers an `<input type="file">` picker, and drag and drop is added if Phase 0 shows it works.

The `.frottage` file is a ZIP (via `fflate`) holding:

```
capture.json              the capture tree, validated against the schema
assets/<sha256>.<ext>     PNG, JPEG or GIF bytes, de-duplicated by hash
```

A ZIP avoids base64's 33% inflation and lets images load one at a time. Limits on import (author's call): 256 MB uncompressed total, 64 MB for `capture.json`, 20,000 nodes. The file is treated as untrusted input, because people may share them: the entire capture is schema-validated, and entry sizes are checked while decompressing rather than trusted from the ZIP headers.

### Intermediate format: `@repo/capture-schema`

A versioned, documented format is the contract between the two halves and the piece worth keeping stable.

- **Definition:** Zod 4 schemas, with TypeScript types inferred from them. The recursive tree uses Zod's getter pattern. A JSON Schema is generated with `z.toJSONSchema()`, committed, and published on the docs site.
- **Version:** an integer `schemaVersion`, independent of the package version. Any breaking change increments it and adds a migration function. The plugin reads every older version, and on a newer version shows "update Frottage", never a partial import.
- **Validation:** runs in the plugin UI iframe. Zod does not ship in the plugin sandbox bundle. It is used by the extension only in tests, so the injected capture script stays small.

The schema records **resolved, measured values**. It holds what the browser computed, not CSS source, and no Figma concepts. Translation to Figma lives entirely in the mapper.

```
Capture
  schemaVersion, capturedAt, tool { name, version }
  source   { url, title, viewport {w, h}, scrollSize {w, h}, devicePixelRatio, colorScheme }
  tokens   { cssCustomProperties: name -> resolved value }   // from readable stylesheets and :root
  fonts    [ { family, weight, style, loadedAsWebFont } ]
  assets   [ { hash, mime, width, height, sourceUrl, downscaledFrom? } ]
  warnings [ { code, nodeId?, detail } ]
  root     Node

Node = ElementNode | TextNode | ImageNode | SvgNode | PlaceholderNode

common   id, box {x, y, w, h}  // page coordinates, untransformed layout size
         paintOrder, visible, opacity, blendMode, transform? (2D matrix)
         semantic { tag, role?, ariaLabel?, headingLevel?, landmark?, href?, alt? }

ElementNode  style: background layers, borders per side, radii, box and inset shadows,
                    filters, backdrop filter, overflow, clip
             layout: display, position, flex direction, wrap, justify, align, align-self,
                     gap, padding, margin, order, grow, shrink
             children: Node[]
TextNode     text, lines [box], runs [ { start, end, family, weight, style, size, lineHeight,
             letterSpacing, color, decoration, transform, align } ]
ImageNode    assetHash?, fit (cover, contain, fill, none, tile), objectPosition
SvgNode      markup   // serialised with computed styles, currentColor resolved, <use> inlined
PlaceholderNode  kind (canvas, video, cross-origin-iframe, blocked-image), sourceUrl?, assetHash?
```

Coverage of the sources the brief listed:

| Source | v1 handling |
|---|---|
| Computed styles, boxes | Captured for all rendered elements. Elements with `display: none` or zero area and no visible overflow are skipped |
| Text runs | Inline elements merge into one text node with style runs where they sit in the same block. Line boxes are recorded via `Range.getClientRects()` |
| Fonts | Family, weight and style. `CSS.getPlatformFontsForNode` needs the debugger, so the rendered family is inferred: the first family in the stack that is loaded or passes `document.fonts.check`, then a map for generics |
| Images | `<img>`, `<picture>` current source, `background-image`. Fetched in the page, or from the service worker if the optional host permission is granted |
| SVG | Inline SVG serialised to markup. SVG used as an image is inlined when its source is readable, otherwise rasterised at twice its display size |
| Pseudo-elements | `::before` and `::after` become synthetic children. Positions come from computed values, so in-flow cases are approximate. `::marker` is mapped to text. Layout may not be exact; the count is reported |
| Shadow DOM | Traversed, flattened by slot assignment. Closed roots use `chrome.dom.openOrClosedShadowRoot`, passed in as a function so Playwright runs can substitute open-only access |
| Iframes | Same-origin: traversed. Cross-origin: placeholder with URL, because `activeTab` covers the tab's origin only |
| Canvas | `toDataURL` if untainted, otherwise a placeholder |
| Video | `poster` if present, otherwise the current frame if untainted, otherwise a placeholder |
| Form controls | Value or placeholder as text, but never a password value |

### Cross-origin images

Content scripts obey the page's CORS rules even if the extension holds host permissions; a service worker with host permissions does not. `activeTab` only covers the tab's own origin, and many sites serve images from a CDN. So:

1. Fetch in the page context. This covers same-origin images and CDNs that send CORS headers.
2. If any fail, the popup explains the count and offers one action: **Allow image access**, requesting optional `<all_urls>` at runtime. The service worker then fetches the blocked images.
3. If declined, they become `PlaceholderNode` with size and source URL retained, and the import report lists them.

### Monorepo shape

New workspaces follow the existing rules: apps under `apps/`, logic under `packages/`, JIT source-only, `@repo/*` imports.

```
apps/
  chrome-extension/     new. MV3 extension: chrome.manifest.ts, build.ts, popup, service worker
  design-plugin/        extended: import pipeline applier in src/plugin/
packages/
  capture-schema/       new. @repo/capture-schema: Zod schema, types, migrations, JSON Schema
  capture-dom/          new. @repo/capture-dom: DOM walker. No chrome.* imports; capabilities are injected
  figma-mapper/         new. @repo/figma-mapper: Capture -> LayerPlan. Pure, no figma.* or DOM
  common/               extended: import events in networkSides.ts
  ui/                   extended: Frottage plugin screen replaces the sampler app.tsx
```

**`LayerPlan` is the key seam.** It is a plain-data description of the Figma tree: layer names, Figma paints, auto layout settings, plus styles and variables to create. Everything hard and testable lives in `@repo/figma-mapper`: layout inference, naming, token extraction, font matching. The sandbox applier is a thin loop that turns a plan into `figma.*` calls.

Where work runs:

| Step | Runs in | Why |
|---|---|---|
| Unzip, validate, migrate, map to `LayerPlan` | Plugin UI iframe | It has full browser APIs, Zod can live here, and the heavy work stays out of the sandbox |
| Font availability | Sandbox, requested by UI | Only `figma.listAvailableFontsAsync` knows |
| Create nodes, load fonts, images, verify layout | Sandbox | Only the sandbox has `figma.*` |

The UI streams the plan and image bytes to the sandbox in batches over monorepo-networker, never as one message, and the sandbox reports progress with typed events. New events in `networkSides.ts`, roughly: `PLUGIN.listFonts()`, `PLUGIN.importBegin(meta)`, `PLUGIN.importBatch(ops)`, `PLUGIN.importImage(hash, bytes)`, `PLUGIN.importCancel()`, `PLUGIN.importEnd()`, `UI.importProgress(done, total)`, `UI.importResult(report)`. Exact shape is left to the builder.

#### Extension build

`apps/chrome-extension/build.ts` follows `apps/design-plugin/build.ts`: same flags (`--watch`, `--analyze`), same `NODE_ENV` behaviour, `Bun.build` and `bun-plugin-tailwind`, and `chrome.manifest.ts` mirroring `figma.manifest.ts`. Outputs to `dist/`, picked up by Turborepo's existing `build` and `dev` tasks.

**It must not copy the plugin's UI build unchanged.** The plugin's `compile: true` produces a single HTML file with inline scripts, and Manifest V3 extension pages forbid inline scripts (`script-src` may only be `self`, `none` or `wasm-unsafe-eval`). The popup is built as an HTML entrypoint with external files. The service worker is built as its own bundle, and the capture script as an IIFE. Like the plugin, the extension includes all code in the package, since remotely hosted code is prohibited.

The extension may need a small dedicated popup entry. `@repo/ui` exports components, and the popup imports those plus `@repo/ui/styles.css`. It must not import `app.tsx` or `app.network.tsx`, which are plugin-only.

#### Extension permissions

| Permission | Why | Install warning |
|---|---|---|
| `activeTab` | Temporary access to the tab the user invoked it on | none |
| `scripting` | Inject the capture script | none |
| `downloads` | Save the `.frottage` file reliably after the popup closes | "Manage your downloads" (to confirm in Phase 0) |
| `offscreen` | Create a Blob URL for the download; the service worker cannot | none |
| Optional `<all_urls>` | Fetch cross-origin images, on request only | shown at grant time |

No `debugger`, no `tabs`, no static host permissions, no `storage` unless the builder finds a need.

#### Repository housekeeping

- This repository becomes Frottage (owner decision). The sampler `app.tsx` is removed, not preserved.
- The checkout is `bromso/figma-plugin-frottage`, but `.changeset/config.json` points `changelog` at `bromso/figma-plugin-template`, and the docs use `/figma-plugin-template` paths. Fix both when Frottage work begins. The docs site deploys from this repository and hosts the privacy policy and capture format, so it needs a stable URL.
- Rewrite the template-focused docs, README and CONTRIBUTING for Frottage, and retire or rewrite the `build-figma-plugin` skill and its references.
- `figma.manifest.ts`: `name: "Frottage"`, a new plugin `id` of the owner's, `editorType: ["figma"]`. `networkAccess` stays `["none"]`; update its comment to explain that this is deliberate.
- `plugin.ts`: remove the sampler `setInterval` ping and FigJam branch, retitle the window. Keep `themeColors: true`.
- Changesets: `@repo/design-plugin` currently sits in `ignore`, and an extension needs a real version in its manifest. Remove it from `ignore`, and add a second `fixed` group for Frottage: `@repo/design-plugin`, `@repo/chrome-extension`, `@repo/capture-schema`, `@repo/capture-dom`, `@repo/figma-mapper`. `chrome.manifest.ts` reads `version` from `package.json`.
- Update `README.md`, `CONTRIBUTING.md`, `.claude/CLAUDE.md` and `apps/docs` with the new workspaces, and add docs pages for the capture format and privacy.

### Layout inference

Auto layout is the main source of both value and wrong output. The rule is **propose, verify, fall back**.

**1. Propose.** The mapper chooses a layout per element from the captured `layout` data:

| CSS | Figma | Condition |
|---|---|---|
| `display: flex`, row or column | `layoutMode` HORIZONTAL or VERTICAL | All in-flow children are visually ordered along the axis |
| `row-reverse`, `column-reverse`, `order` | Children reordered by visual position | |
| `gap` | `itemSpacing`, and `counterAxisSpacing` for wrap | |
| `padding` | Padding fields | Uniform margins on children are folded into padding or spacing |
| `flex-wrap: wrap` | `layoutWrap = "WRAP"` | HORIZONTAL only |
| `justify-content` start, center, end, space-between | `primaryAxisAlignItems` | `space-around` and `space-evenly` use absolute unless spacing can be expressed exactly as padding plus gap |
| `align-items` | `counterAxisAlignItems`, with `stretch` as `layoutSizing* = "FILL"` | `baseline` is mapped where the API allows, otherwise start |
| `flex-grow > 0`, or child width 100% of parent content box | `layoutSizing* = "FILL"` | |
| Parent size equals sum of children plus spacing | `layoutSizing* = "HUG"` | Otherwise FIXED |
| `position: absolute` or `fixed` inside a flex parent | `layoutPositioning = "ABSOLUTE"` on that child | |
| Normal-flow block stack | VERTICAL | Children do not overlap, are in visual order, and the gaps are equal |
| Unequal gaps in a block stack | Absolute | Spacers are not invented in v1 |
| CSS grid, tables, floats, inline-block runs | Absolute | Grid is v1.1 |
| Overlapping in-flow children, negative margins | Absolute | |

Text nodes use auto height at their measured width, and width "hug" only for single-line text in a hugging parent.

**2. Verify.** Verification checks each frame's **internal arrangement, relative to the frame itself**, not page coordinates, so errors do not accumulate down a stack. After a frame's children are placed, the sandbox compares with the capture:

- child order along the axis;
- gaps between adjacent children, and offsets from the frame's padding edge, within 1 px;
- alignment on the cross axis, within 1 px;
- size of non-text children, within 1 px, unless the child is HUG and contains text.

A difference that is fully explained by text is not a failure. A text node's own size is compared only to report drift (`text-drift` in the import report), and ancestors that HUG inherit that change without failing. All thresholds here are the author's call.

**3. Fall back.** If verification fails, that frame reverts to absolute positioning: `layoutMode = "NONE"`, children at captured offsets. Children keep their own auto layout, so a failure stays local. The reason is counted in the report. Stacking order overrides auto layout: where the paint order disagrees with the visual order, that frame stays absolute.

Depth is reduced where it adds nothing: a wrapper with no paint, one child and matching box is collapsed into its child. Semantic information from the wrapper transfers.

Fixed and sticky elements appear at the position they hold with the page scrolled to the top, as absolute children of the root frame.

### Hard cases

| Case | v1 behaviour |
|---|---|
| **Missing fonts** | Match in order: exact family and style from `listAvailableFontsAsync`, nearest weight in that family, then a user-chosen substitute, with Inter as default. Import shows a substitution table before creating nodes. Text keeps its measured box, and wrapped-line changes are counted in the report |
| **Text wrapping** | Each block is one text node with style ranges. It is not split per line, because that destroys editing. Browser and Figma wrap differently; a one-line overflow is accepted over per-line nodes |
| **Transforms** | Translate and scale are baked into position and size. 2D rotation is applied to the node. Skew and 3D keep the layout box and are reported |
| **Filters** | `blur()` to layer blur, `drop-shadow()` to drop shadow, `backdrop-filter: blur()` to background blur. Others are ignored and reported |
| **Blend modes, opacity** | `mix-blend-mode` to `blendMode`. `opacity` to node opacity |
| **Gradients** | Linear, radial, conic to Figma gradient paints with computed transforms. `repeating-*` uses the first cycle and is reported |
| **Multiple backgrounds** | Several fills in reversed order |
| **Background image** | Cover to FILL, contain to FIT, repeat to TILE. Other sizes and offsets are approximated by a child layer with crop |
| **Shadows** | `box-shadow` and inset map to drop and inner shadow, with spread |
| **Borders** | Uniform or per-side weight with `individualStrokeWeights`. Mixed colours per side use the most common colour, reported. Dashed and dotted map to dash patterns. Elliptical radii are approximated |
| **Overflow** | `hidden`, `clip`, `scroll` become `clipsContent = true` at the visible box. Scroll content stays in the layer tree. Outer pages expand to full height |
| **Canvas, video, cross-origin iframe** | Placeholder frame with the right size, or a frame image when readable; named with the source |
| **Very long pages** | Node cap: warn at 5,000, stop at 20,000 with an option to reduce depth by collapsing decorative wrappers. Images over 4096 px are downscaled |
| **Sandbox performance** | Batches of about 200 nodes with a yield between them, one font load per family and style up front, image creation de-duplicated by hash. `figma.commitUndo` after import, so one undo removes everything if the API allows it (Phase 0). Cancel removes the partial root frame |

### Naming, tokens, accessibility

**Layer names**, in priority order: `aria-label` or `aria-labelledby` text; landmark or role (`Header`, `Navigation`, `Main`, `Footer`); heading with text (`H1 - Get started`); interactive with text (`Button - Sign up`, `Link - Pricing`); `Image - <alt>`; a readable class or `id`, excluding hashed-looking values; repeated siblings as `Item 1`, `Item 2`; capitalised tag as the last resort. Long values are truncated at 40 characters.

**Alt text and semantics.** The brief proposed layer descriptions, but `description` only exists on components, component sets and styles. So alt text goes in a Dev Mode annotation (`node.annotations`, supported on frames, rectangles and text) where the alt is non-empty, and the raw semantics (`tag`, `role`, `href`, `alt`) are kept in `setSharedPluginData` under the `frottage` namespace. Annotation labels use the plain `label` field, never `labelMarkdown`, because the text comes from the page.

**Text styles.** Cluster text runs by family, weight, size, line height and letter spacing. Clusters used 3 or more times become text styles named `heading/<n>` and `body/<n>`, ordered by size.

**Colour variables.** A collection named after the hostname, with one mode. Values used 3 or more times become variables, bound through `setBoundVariableForPaint`. Names come from matching CSS custom properties where the resolved value matches (`--color-primary` to `color/primary`), otherwise `color/<n>`. Alpha colours stay as plain paints in v1. Gradient stops are not bound. Spacing and radius variables are v2.

**Repeat imports and cancel.** Two captures in one file are expected, since that is how v1 handles responsive work, so tokens must not duplicate. The mapper emits token definitions with their values and proposed names, and the sandbox resolves them against the file, because only it can read existing tokens. Frottage reuses any style or variable it created earlier (found through shared plugin data) with an identical value, and otherwise adds a new one, continuing the numbering. The collection is per hostname. Tokens created by the user or other plugins are not touched. Cancel removes the partial root frame and any tokens created by that import that nothing else uses. (Author's call.)

**UI accessibility.** WCAG 2.2 AA for the plugin screen and the popup: full keyboard operation, visible focus, progress announced via `role="status"`, and error text linked to its control. The `@repo/ui` scale of 11 px text is a Figma convention that this project keeps, with contrast checked against both themes. The popup follows `prefers-color-scheme` by toggling the `dark` class, because `--figma-color-*` is absent there. `@repo/ui`'s CSS fallbacks handle the rest.

### Testing

| Layer | How | Runs in |
|---|---|---|
| `capture-schema` | Accepts and rejects valid and hostile samples, migrations, JSON Schema drift check | `bun test` in CI |
| `capture-dom` | Playwright with Chromium loads local fixture pages and runs the walker; output is normalised and snapshot-tested | CI, in a new job |
| `figma-mapper` | Capture fixtures to `LayerPlan` snapshots, plus focused tests per layout rule and naming rule | `bun test` in CI |
| Sandbox applier | `bun test` against a small in-memory fake of `figma.*`: correct calls and fallback logic | `bun test` in CI |
| Plugin UI, popup | happy-dom component tests, as elsewhere in `@repo/ui` | `bun test` in CI |
| **Real Figma output** | A local script plus the `figma-console` MCP: imports each fixture into a test file, exports PNGs, compares with Playwright screenshots via `pixelmatch`, and computes the metrics in [What good output means](#what-good-output-means) | Locally, before each release; not CI, because Figma has no headless plugin runtime |

Fixtures are local static pages in the repository, one for each row of the hard-case and layout tables, plus three composed pages: marketing landing page, dashboard with tables, and a long article. Real sites are not used as fixtures, since they change and may not be redistributed. Fixture fonts are open source and installed locally for the Figma comparison.

### Distribution and business

Author's call: **free and MIT licensed, like the template, with no accounts.** Running a free tool with no backend costs almost nothing, and a paid tier would need licensing and support while competing with a free Figma feature. `figma.payments` remains an option later.

- **Figma Community:** requires the plugin security disclosure form. `networkAccess: ["none"]` keeps the answer short. Later updates publish without review.
- **Chrome Web Store:** single purpose ("capture a web page to a file for import into Figma"), a justification for each permission, and a privacy policy, hosted on the docs site, stating that nothing leaves the device.
- **Content rights:** the store listings and docs state that users are responsible for rights to the pages they capture.
- **File sensitivity:** docs and the popup state that a `.frottage` file contains the page's content, including anything visible in a logged-in session, and should be shared accordingly.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **html.to.design's output is already as good** as Frottage's target | Unknown: no independent data found | High | Phase 0 head-to-head before product code. If it wins, v1 either shrinks or stops, per the [gate](#roadmap) |
| **Figma ships structured capture** and removes the reason to exist | Medium to high: component and style mapping is on its roadmap | High | Keep v1 small. Open format, local-only design and transparency remain differentiators. Decide on v2 only after seeing Figma's next release |
| Auto layout inference fails on real sites more than on fixtures | High | High | Local fallback in place. Phase 2 tests private real-world sites early, and the 70% target is measured before v1 is called done |
| Text wrapping differs between browser and Figma | High | Medium | Tolerances and reporting. Accept the difference over per-line nodes |
| Rendered font cannot be identified without the debugger | Medium | Medium | Stack inference, substitution table shown before import |
| Import freezes Figma on large pages | Medium | High | Batching, caps and a Phase 0 benchmark before committing to budgets |
| File step feels clumsy compared with paste | Medium | Medium | Direct bridge is a v2 candidate, and the `.frottage` format carries over unchanged |
| Pages with CSP or strict frames | Low | Low | Isolated-world scripts are not bound by the page's CSP; fetch failures become placeholders |
| Chrome Web Store rejection over optional `<all_urls>` | Low to medium | Medium | Narrow single purpose, clear justification. Worst case: ship without it, and blocked images stay placeholders |
| Scope creep from the size of CSS | High | High | Every case is fixture-backed, and anything unlisted is reported, not chased |

## Roadmap

**Phase 0: competitor check and spikes (throwaway, about a week).** Spikes are permitted by approval of this document; they do not ship.

- **Competitor check, first, as a go/no-go.** The owner imports the three composed fixtures and three real pages into html.to.design and Figma's capture, using free tiers. Measure for each: share of frames in auto layout, nesting depth, meaningful names, text styles and variables created, plus the owner's estimate of cleanup minutes. Check html.to.design's privacy policy and Chrome listing for where capture data goes. **If html.to.design already meets the [targets](#what-good-output-means), the decision returns to the owner:** ship a smaller Frottage competing on free, open and local, or stop.
- **Technical spikes.** Resolve each item under [Unverified](#unverified-settled-by-phase-0). Exit: a capture-to-frame walkthrough on one fixture, and a 5,000-node benchmark meeting the budget. If benchmarks or layout verification fail, this document is revised before Phase 1.

**Phase 1: pipeline, walking skeleton.** Workspaces and builds, schema v1, walker for boxes, text and images, `.frottage` file, plugin import with absolute layout only, report screen. Exit: a landing-page fixture imports with editable text and correct positions.

**Phase 2: usable output.** Layout inference with verification, semantic names, text styles, colour variables, annotations, token reuse, and font matching with the substitution table. Exit, on structural targets only: auto layout, names, tokens and text, on fixtures with fonts both installed and missing. The owner also runs three real pages of their choice, private if they like, and shares the import report's numbers, not the pages. Fixtures measure the targets; real pages reveal failures, and any failure pattern becomes a new fixture.

**Phase 3: hard cases.** Pseudo-elements, shadow DOM, SVG refinement, gradients, filters, transforms, optional image permission, node caps, cancel. Exit: all targets, including pixel difference and the import budget.

**Phase 4: v1 release.** Accessibility pass, docs, privacy policy, and a packaging step producing the extension ZIP in the release workflow. Done means release-ready: build artifacts, listing copy and permission justifications prepared. Creating the plugin ID and the Chrome Web Store account, and submitting, are the owner's steps.

**v1.1.** Grid auto layout, element-level capture, spacing and radius variables.

**v2 candidates, chosen on evidence after v1.** Component detection from repeated structures, direct bridge transport, multi-viewport capture, mapping to existing libraries, spacer inference for unequal gaps, URL import.

## Unverified, settled by Phase 0

These affect the design, and documentation did not confirm them:

1. A plugin iframe can read a user-chosen file with `<input type="file">` in both desktop and browser Figma, and whether OS file drops reach the iframe's DOM. Without the picker, transport needs rethinking.
2. Auto layout results can be read back synchronously in the sandbox, which verification depends on. If not, the check needs a yield per frame, which affects performance.
3. monorepo-networker carries `Uint8Array` payloads efficiently through Figma's `postMessage`.
4. Actual time and stability for 5,000 and 20,000 nodes.
5. `figma.commitUndo` makes an import undoable as one step, and annotations work on all plans.
6. `activeTab` access survives the popup-driven flow through multiple asynchronous steps, including after the service worker sleeps.
7. The walker gets correct geometry in DevTools device mode.
8. Runtime message size limits between the capture script and the extension.

## Left to the builder

Internal `LayerPlan` shape, walker internals, popup and plugin screen layouts within `@repo/ui` conventions, exact event signatures, gzip and ZIP settings, the exact `fflate`, Playwright and `pixelmatch` versions, fixture contents, and thresholds marked provisional, once measured.

## Calls to confirm

1. Audience: product designers and design engineers working from products they can access, not bulk public-URL conversion.
2. Differentiation (owner decision): Frottage is the free, open source, local-only importer, with no accounts, no backend and no import limit. Usable structure is the quality goal, measured by the Phase 0 check, and becomes a selling point only if that check supports it.
3. Extension only in v1, with no URL import.
4. Local `.frottage` file transport, with no backend and `networkAccess: ["none"]`.
5. No `debugger` permission, which gives up exact font detection and viewport emulation.
6. One capture at one viewport in v1.
7. Component detection and CSS grid mapping are out of v1.
8. Free, MIT, no accounts, no telemetry.
9. Alt text in Dev Mode annotations, not layer descriptions.
10. The name "Frottage" (owner decision). No name or trademark check has been done.

## Sources

Checked 2026-10-31.

- Context7: Figma Plugin docs (`/websites/developers_figma_plugins`), Chrome Extensions docs (`/websites/developer_chrome_extensions`), Bun 1.4.2 (`/oven-sh/bun`), Zod 4.6.5 (`/colinhacks/zod`).
- [Figma: turn coded screens into editable design layers](https://help.figma.com/hc/en-us/articles/40826832449303-Turn-webpages-into-editable-design-layers)
- [Figma MCP tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Figma: creating a user interface](https://developers.figma.com/docs/plugins/creating-ui/)
- [html.to.design](https://html.to.design/home/), its [features docs](https://html.to.design/docs/free-features/), [variables post](https://html.to.design/blog/new-feature-create-variables/) and [Chrome Web Store listing](https://chromewebstore.google.com/detail/htmltodesign/ldnheaepmnmbjjjahokphckbpgciiaed)
