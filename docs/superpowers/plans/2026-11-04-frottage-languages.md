# Frottage Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The popup detects a page's languages and offers them as checkboxes; a run captures every ticked language at every ticked device; the plugin pairs the texts across languages into a **Language** collection of string variables, so switching the Language mode on a page's Section swaps its text.

**Architecture:** The popup's page probe also reads the page's languages (hreflang, then URL pattern, then switcher links). The offscreen run, after the current language's sizes, loads each other language in the held tab and captures it at the device widths, then returns the tab to its address. Each capture records its language. The mapper pairs each other-language capture's texts to the same device's current-language capture by their place in the page structure (links also by target), builds a Language collection of STRING variables, and puts a `textKey` on paired text ops; the sandbox binds those texts' `characters` and sets the Language mode on the Section. A device whose language page pairs under 80% gets that language as its own frames.

**Tech Stack:** As before. No new required permissions; other-site languages use the existing `optional_host_permissions`.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-devices-themes-languages-design.md` (Stage 3; "Languages are detected", "Pairing texts across languages", "Captures per language", "Language variables are shared across devices", "Under-80% frames").

## Facts measured 2026-11-04 (Chromium, built extension, `Extensions.triggerAction` on `http://localhost:4173/en/`)

| Route to the other language | `executeScript` |
|---|---|
| Same tab, same origin (`/en/` → `/sv/`), and back | works |
| New background tab, same origin | refused |
| Same tab, other origin (`127.0.0.1`) | refused, and stays refused after returning to the first origin |
| Worker `fetch` of `/sv/` | fails (no host access) |

`chrome.tabs.query({url})` also needs host access. Figma's plugin typings list `characters` in `VariableBindableNodeField` (Context7, `/figma/plugin-typings`).

## Global Constraints

- Branch `feat/frottage-languages` from `feat/frottage-light-dark` (PR #10, not merged); rebase onto master once #10 merges. Conventional commits with the Co-Authored-By trailer; never `--no-verify`. One changeset `.changeset/languages.md` (minor).
- `schemaVersion` stays 1; new capture fields optional and bounded. `version.kind: "language"` typed labels keep importing through the Stage 3 path, unchanged.
- Same-origin languages load in the held tab (the run's own small window). Other-origin languages need `chrome.permissions.request({ origins })` for exactly those origins, asked from the Capture click; when refused, those languages are left out with `Svenska needs access to sv.example.com, so it was left out.`
- Language mode names are each language's own name with a capital first letter, from `new Intl.DisplayNames([code], { type: "language" })` (`sv` → `Svenska`, `en` → `English`); the code itself when that fails. At most 8 languages detected (`MAX_LANGUAGES = 8`).
- Popup copy, exactly: a `Languages` group with one checkbox per language, labelled with its name, the current one ticked; hidden when only one or none is found. With more than one ticked, the Capture button reads `Capture <n> sizes` as today, and a line under it reads `<n> captures: <d> devices × <l> languages, plus <e> for breakpoints` (the `plus …` part only when extras exist; `1 device`, singular when 1).
- Breakpoint extras run in the current language only. Every ticked language is captured at every ticked device width.
- Pairing: by structural path; a link by its target too. A text binds only when its runs share one style in both languages (Figma restyles a bound text as a whole); mixed ones stay plain and are counted.
- Report copy, exactly: `3 texts exist only in Svenska and weren't added.`; `4 texts have no Svenska version and stay in English.`; `2 texts with mixed styles stay in English.`; `The Svenska page differs too much from English to share one frame on Phone.`; `Svenska couldn't be loaded, so it was left out.` (number words: `1 text`/`n texts`; the language and device names fill in).
- Plugin "What's in this file": a `Languages` group, checkboxes per language the file holds, all ticked; the current language can't be unticked (its frames are the frames). The collections line gains `Language <n>`.

## Review Focus

1. **The page navigates itself away during a language pass** (a redirect from `/sv/` to `/sv-se/` or a consent page): the run checks the address after load against the language's own origin, not the home address, and a same-origin redirect is accepted; a change of origin skips that language with the `couldn't be loaded` line and the run continues. Test in Task 3.
2. **The tab must end where it started**: after language passes (including a cancel or a failure mid-language), the tab is back on the address it had before Capture, before it is released. Test in Task 3.
3. **A language whose page has an extra banner** (one more section before the shared content): pairing by path must not shift every later text; paths are anchored on element tag + class + index among same-tag siblings, and an unmatched subtree only loses its own texts. Test in Task 4.
4. **The same label repeated** (`Learn more` ×6 with different Swedish wording on two of them): variables dedupe by all their language values together, never by the English text alone. Test in Task 5.
5. **Re-import of a file with a new language into a file that already has a Language collection**: the collection gains the mode, nothing is removed or renamed, and the report lists the mode added. Test in Task 6.

---

### Task 1: The probe finds the page's languages

**Files:** Create `apps/chrome-extension/src/languages.ts`; modify `apps/chrome-extension/src/probe.ts` (`probePage` gains `languages`, in its own try/catch), `breakpoints-entry.ts`, `service-worker.ts` (reply passes it through); tests `__tests__/languages.test.ts`, `probe.test.ts`.

**Interfaces — Produces:**
- `type PageLanguage = { code: string; name: string; url: string; current: boolean }`, exported from `@repo/capture-schema` (Task 3's `Capture.language` uses the same shape), so the mapper never imports from the extension
- `findLanguages(doc: Document, here: string): PageLanguage[]` — at most 8, current first, then in page order; `[]` when fewer than two are found.
- `languageName(code: string): string` (exported for the mapper's fallback too — put it in `@repo/capture-schema/css-values` beside `breakpointName`).
- probe reply `{ ok: true; breakpoints: number[]; dark: boolean; languages: PageLanguage[] }`.

Detection, first that yields two or more languages: (1) `<link rel="alternate" hreflang>` in `head`, `x-default` skipped, URLs resolved against `here`; current = the one whose URL equals `here` without hash, else the one matching `<html lang>`'s primary subtag; (2) URL pattern: `here`'s first path segment matches `^[a-z]{2}(-[a-z]{2,4})?$`i and the page links (`a[href]`) to the same path with another such first segment; (3) switcher links: `a[hreflang]` or `a[lang]` to a same-site URL. Codes lowercase, deduped by code (first wins); only `http(s)` URLs.

- [ ] **Step 1: Failing tests** — hreflang `en`, `sv`, `x-default` on `/en/` → `[{code:"en",name:"English",current:true,…},{code:"sv",name:"Svenska",url:"https://site.test/sv/",current:false}]`; `/en/pricing` with a link to `/sv/pricing` and no hreflang → both found by pattern; `a[hreflang=de]` switcher found; a page with one hreflang → `[]`; 12 hreflangs → 8; `languageName("sv")` → `Svenska`, `languageName("zz-qq")` → `zz-qq`; a probe whose language read throws still returns breakpoints and dark with `languages: []`.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/chrome-extension test && bun run --filter @repo/capture-schema test` (PASS).
- [ ] **Step 5: Commit** `feat: find the page's languages when the popup opens`

### Task 2: Languages in the popup

**Files:** `apps/chrome-extension/src/popup/popup.tsx`, `apps/chrome-extension/src/page.ts` (`initialLanguages(reply)`, `captureCountLine(devices, languages, extras)`, `otherOrigins(languages, here)`; `rerunRequest` keeps `languages`), `messages.ts` (`viewport-start` gains `languages?: PageLanguage[]`, the ticked ones, current first); tests `page.test.ts`, popup tests.

**Interfaces — Consumes:** Task 1's reply. **Produces:** `viewport-start.languages`.

The Capture click, before sending, calls `chrome.permissions.request({ origins: otherOrigins(...) })` when any ticked language is on another origin (pattern `https://host/*`); refused origins' languages are dropped from the request and named in the popup's status with the exact copy from the Global Constraints. The touched-flag rule from the Light/Dark checkboxes applies: a late probe never changes boxes the user changed.

- [ ] **Step 1: Failing tests** — reply with `en` (current) and `sv` shows `Languages` with `English` ticked and disabled, `Svenska` unticked; ticking Svenska with 3 devices and 2 extras shows `8 captures: 3 devices × 2 languages, plus 2 for breakpoints`; 1 device, no extras → `2 captures: 1 device × 2 languages`; one language → no group, no line; Capture sends `languages` (current first); a ticked `https://sv.site.test/` asks for `https://sv.site.test/*` and, refused, sends only English and shows `Svenska needs access to sv.site.test, so it was left out.`; a re-run from an older saved status without `languages` still runs.
- [ ] **Step 2–4:** run (FAIL), implement with `@repo/ui` `Checkbox`/`Label`, run `bun run --filter @repo/chrome-extension test` (PASS).
- [ ] **Step 5: Commit** `feat: choose languages in the popup`

### Task 3: A run captures each language

**Files:** `apps/chrome-extension/src/viewport-run.ts` (after the current language's sweep, one sweep per other language over the device widths only), `offscreen.ts` / `service-worker.ts` (new deps `navigate(url): Promise<void>` that waits for `complete`, `address(): Promise<string | null>`), `capture-entry.ts` + `service-worker.ts` start message (window global `__frottageLanguage`), `packages/capture-schema/src/schema.ts` (+ bounded parse, JSON schema); tests `viewport-run.test.ts`, `capture-schema` tests.

**Interfaces — Produces:** `Capture.language?: { code: string; name: string; url: string; current: boolean }` (code ≤ 20, name ≤ 40, url ≤ 2048). Status labels `Laptop · Svenska`. Captures of the current language record it too when the run had languages.

Rules: a language pass navigates the held tab to its URL, waits for load and settle, then requires the tab's origin to equal the language URL's origin (a same-origin redirect is fine); otherwise that language is skipped (`Svenska couldn't be loaded, so it was left out.`) and the run goes on. The home-address check applies per pass to that pass's address. Before release — always, including cancel and errors — the tab navigates back to the address it had when the run began, if it isn't there.

- [ ] **Step 1: Failing tests** — fake deps: widths Laptop, Phone + 1 extra, languages en (current), sv: captures in order Laptop·en, Phone·en, extra·en, Laptop·sv, Phone·sv (widest first within a pass, as today); each sv capture records `language.code === "sv"`; a redirect to another origin skips sv with the line and still saves en; a cancel during sv returns the tab to the `/en/` address before `release`; a failure in `navigate` returns it too; schema accepts `language`, refuses a 3000-char url, older captures parse.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/chrome-extension test && bun run --filter @repo/capture-schema test && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` (PASS).
- [ ] **Step 5: Commit** `feat: capture each ticked language at every device`

### Task 4: Pairing texts across languages

**Files:** Create `packages/figma-mapper/src/languages.ts`; test `languages.test.ts`.

**Interfaces — Produces:**
- `textPath(root: CaptureNode, id: string): string | null` — `/`-joined steps from the root, each `tag.className#n` for an element (`n` = index among siblings with the same tag and className) and `text#n` for a text (index among text siblings).
- `pairTexts(base: Capture, other: Capture, hrefMap: (href: string) => string): TextPairing` where `TextPairing = { pairs: Map<string, string>; mixed: Set<string>; onlyOther: number; onlyBase: number; rate: number }` — `pairs` maps a base text node id to the other language's text; texts pair by equal path, then (for a link text unpaired by path) by `hrefMap(otherHref) === baseHref`; `mixed` holds base ids whose runs, in either language, differ in family, weight, style, size or color; `rate = pairs.size / count of base texts` (visible, non-empty after trim); 1 when there are none.
- `languageHrefMap(languages: NonNullable<Capture["language"]>[]): (href: string) => string` — swaps a URL's language prefix/origin for the base language's, from the captures' `language.url`s.

- [ ] **Step 1: Failing tests** — identical structure with translated texts → rate 1, every id paired; an extra banner section before `main` in sv → texts inside `main` still pair (path anchored on `main` class/tag indices), banner texts counted in `onlyOther`; a nav link `Pricing` → `/en/pricing`, `Priser` → `/sv/priser` with `hrefMap` from hreflang pairs; a text with a bold run → in `mixed`; a page with no texts → rate 1.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test` (PASS).
- [ ] **Step 5: Commit** `feat: pair a page's texts across languages`

### Task 5: The Language collection

**Files:** `packages/figma-mapper/src/plan.ts` (`PlanCollectionKind` gains `"language"`; text op gains `textKey?: string`), `layering.ts` (`COLLECTION_ORDER`, `COLLECTION_NAMES.language = "Language"`, placed after Color Mode, before Theme), `devices.ts` (`mergeDevices` groups entries by `capture.language`; options gain `languages?: string[]` (codes to keep); `DeviceMerge` gains `languageFrames: DeviceFrame & { language: string }[]` and `languages: string[]` (mode names, current first)), report lines; tests `devices.test.ts`, e2e `walk.spec.ts` with a two-language fixture.

Rules: the current language's entries make the frames as today. For each other language and device, `pairTexts` against that device's current entry; at rate ≥ 0.8 every paired non-mixed text gets a STRING variable in Language (values per mode, current first; scopes `["TEXT_CONTENT"]`; description `From the page in <names joined>`), named `<section>/<layer name>` where the text sits in a named section (the nearest ancestor op named after a landmark or section), else `<layer name>`, freed by the existing `free`; a variable whose values in every language equal another's reuses it (across devices too); the text op gets `textKey`. Under 0.8 that device's entry for that language becomes a `languageFrames` entry and the report says so. The collection exists when at least one text binds. Entries for languages not in `options.languages` are dropped.

- [ ] **Step 1: Failing tests** — two devices × en/sv, all paired: Language modes `["English","Svenska"]`, one variable per distinct en+sv pair, Laptop and Phone texts with the same pair share the key; `Learn more` ×6 with two Swedish wordings → 2 variables; a Phone sv page at 0.6 → `languageFrames` has Phone·sv and the line `The Svenska page differs too much from English to share one frame on Phone.`, Laptop still binds; report lines for onlyOther, onlyBase and mixed in the exact copy; `options.languages: ["en"]` → no Language collection; a file without `language` on any capture → unchanged output (snapshot of an existing test).
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test && bun run --filter @repo/capture-dom test:e2e` (PASS).
- [ ] **Step 5: Commit** `feat: build a language collection from paired texts`

### Task 6: The sandbox binds texts and sets the Language mode

**Files:** `apps/design-plugin/src/plugin/tokens.ts` (STRING variables in the Language collection, mode settling as for Breakpoint, re-import appends modes), `applier.ts` (after a text's characters are set, `node.setBoundVariable("characters", variable)` when `textKey` resolves; Section gets the current language's Language mode beside Color Mode; `languageFrames` go into their own Section `<page> — <language>`, placed right of the main one, with Color Mode and that Language mode set); tests in `apps/design-plugin/src/plugin/__tests__/`.

- [ ] **Step 1: Failing tests** — fake Figma: a merge with Language `["English","Svenska"]` creates the collection with those modes and STRING variables holding both values; a text op with `textKey` has `boundVariables.characters` pointing at it; the Section's explicit modes include Language → English; a `languageFrames` entry lands in a Section named `Home — Svenska` with Language → Svenska; a mode limit of 1 on Language keeps English only, binds nothing, and reports `Language has room for 1 mode, so Svenska wasn't made.`; re-import with a new `de` appends `Deutsch`, keeps the rest, reports `Added Language mode: Deutsch.`
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test` (PASS).
- [ ] **Step 5: Commit** `feat: bind texts to the language collection in figma`

### Task 7: Languages in "What's in this file"

**Files:** `packages/ui/src/import/contents.tsx`, `import-flow.ts` (contents `languages: { code; name; on; current }[]` from the file's captures; decision passes `languages` (ticked codes) to `mergeDevices`; a lone device with two languages shows the review), `app.tsx` (collections line `Language <n>`); tests `App.test.tsx`, `import-flow.test.ts`.

- [ ] **Step 1: Failing tests** — a file with en+sv shows `Languages` with `English` (ticked, disabled) and `Svenska` (ticked); unticking Svenska imports with no Language collection and the line lacks `Language`; both ticked → line contains `Language 2`; a file with one language shows no group.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test` (PASS).
- [ ] **Step 5: Commit** `feat: choose languages in what's in this file`

### Task 8: Docs, changeset and the gate

- [ ] **Step 1:** `apps/docs/content/docs/index.mdx` and `README.md`: how languages are found, the permission asked for other-site languages, the capture count, pairing and the 80% rule, mixed-style texts staying plain.
- [ ] **Step 2:** `.changeset/languages.md` (minor) for capture-schema, chrome-extension, figma-mapper, design-plugin, ui: "Finds a page's languages, captures the ones you tick, and pairs their texts into a Language collection so switching its mode swaps the text."
- [ ] **Step 3:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 4: Commit** `docs: describe language capture`

### Task 9: [Owner] Check in Chrome and Figma

- [ ] **Step 1 (agent, before the owner):** drive the real popup in Chromium on a local two-language site (same origin) and one other-origin pair: the group, the count line, the permission prompt, the tab returning to its address, and the captures' `language` fields; record in `docs/superpowers/specs/2026-11-04-frottage-languages-results.md`.
- [ ] **Step 2 [Owner]:** `bun run build`; reload extension and plugin; capture a real two-language site with both ticked; import; switch the Section's Language mode and confirm the texts swap and keep their style.
- [ ] **Step 3 (agent, read-only via the Desktop Bridge):** count Language variables and bound texts, check a mixed-style text stayed plain, and that switching mode keeps a single-style text's font; add to the results file.
