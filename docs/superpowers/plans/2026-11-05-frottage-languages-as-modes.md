# Frottage Languages as Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ticked language becomes a mode of the Language collection, however much of the page pairs; the popup finds languages on more real sites and names them simply; breakpoints show as rows like devices; boundaries a pixel or two apart count as one breakpoint; the plugin labels Devices and Breakpoints separately.

**Architecture:** Changes in five places: the extension's language finder (`languages.ts`), the page's breakpoint reader (`capture-dom/breakpoints.ts`), the popup's size planning and UI (`plan-widths.ts`, `popup.tsx`), the mapper's language merge (`devices.ts`, which loses its separate-frames path, as do the sandbox and UI), and the plugin's "What's in this file" (`contents.tsx`).

**Tech Stack:** As before. No new permissions or dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-devices-themes-languages-design.md` (Stage 3), amended by the owner on 2026-11-05: languages are always collections and modes, never separate frames. This plan replaces the spec's "Under 80%" and "Under-80% frames" paragraphs.

## Facts measured 2026-11-05 (real Chromium, built extension)

- **su.se** (`/` Swedish, `/english`): 94% of texts pair on every device; imports as Language Svenska/English, 123 variables, 3 frames. Breakpoints read as `min 999`, `min 1000`, `min 1001` (three boundaries a pixel apart) and `min 1`.
- **kth.se** (`/` Swedish, `/en`): the two start pages carry different content (Swedish news vs English study information); only header, menus and footer pair: 35% on Laptop, 31% on Phone. The owner's import got a separate `… — British English` Section and no Language collection. Breakpoints include `md` 768 and `min 769`. Language names showed as `Svenska (Sverige)` and `British English`.
- **riksbank.se/sv/** and **kth.se** list only their *other* language in `hreflang` (`en-gb`); the page's own language is only in `<html lang="sv">`. Riksbank therefore shows no languages.
- **apple.com/se/** lists dozens of regional `hreflang` variants (`ar-AE`, `ar-BH`, …); the first 8 in page order are all Arabic.
- **mainline-nextjs-template.vercel.app** has one language (`<html lang="en">`, no alternates): no Languages group, correctly.

## Global Constraints

- Branch `feat/frottage-languages-modes` from `feat/frottage-languages` (PR #11, stacked on #10, neither merged); rebase onto master once they merge. Conventional commits with the Co-Authored-By trailer; never `--no-verify`. One changeset `.changeset/languages-as-modes.md` (minor) for the packages touched.
- `schemaVersion` stays 1; no schema field changes.
- Language names: the primary subtag's own name, first letter upper-cased (`sv-SE` → `Svenska`, `en-GB` → `English`), via `languageName(primary)`. Codes stay full (`sv-se`).
- Popup copy, exactly: a `Breakpoints` group under the device list, one row per breakpoint range: the range name (`sm`, `min 576`, `base`), the width it is captured at, and either a checkbox (ticked by default) or, when a ticked device's width falls in the range, the text `Laptop` (that device's name, the widest such device) in place of the checkbox. The line `Also captures … for the … breakpoints` is removed. The group is hidden when the page records no breakpoints.
- Plugin copy, exactly: "What's in this file" groups `Devices` (rows `Laptop 1512`), then `Breakpoints` (rows `sm 640`; a name that already holds its width reads alone: `min 576`) with the existing note `Breakpoint captures make no frames. They give the Breakpoint values.` under it, then `Themes`, then `Languages`.
- Report copy, exactly, per device whose pairing is under 80%: `Only 35% of the English page matches Svenska on Laptop.` (whole percent, rounded down). The existing summed lines stay: `83 texts exist only in English and weren't added.`, `29 texts have no English version and stay in Svenska.`, mixed and repeated-part lines.
- Removed copy: `The Svenska page differs too much from English to share one frame on Phone.`

## Review Focus

1. **A page that pairs 0% in another language** (two unrelated pages): Language is still made only if at least one text binds; with none, no collection and the report says why (`Only 0% of the English page matches Svenska on Laptop.` plus the summed lines). Test in Task 4.
2. **A boundary cluster spanning a Tailwind name** (`767`, `768`, `769`): the kept boundary is `768` (`md`), and every rule's range still maps to one Breakpoint mode. Test in Task 2.
3. **Unticking a breakpoint row, then ticking a device that covers it**: the row turns into the device's name; unticking the device brings the row back with the user's earlier choice (unticked). Test in Task 3.
4. **Two variants of one language with no current-region match** (`en-US`, `en-AU` on a `sv-SE` page): exactly one English entry, the first in page order. Test in Task 1.
5. **A file captured by PR #11's build with an under-80% language**: imports with Language modes (no separate Section), the low-match line per device. Test in Task 4.

---

### Task 1: Find more languages, one per language, plain names

**Files:** `apps/chrome-extension/src/languages.ts`; test `apps/chrome-extension/src/__tests__/languages.test.ts`.

**Interfaces:** `findLanguages(doc, here): PageLanguage[]` unchanged in shape.

Rules, applied in this order after the existing readers collect candidates:
1. **Add the page's own language** when the candidates have at least one entry, none is identified as current, and `<html lang>` is present with a primary subtag none of the candidates has: add `{ code: htmlLang (lowercase), url: here (hash dropped), current: true }`.
2. **One per primary language:** for each primary subtag keep the current entry if it has that language; else the entry whose region equals the current entry's region; else one with no region; else the first in page order.
3. Current first, then page order, at most 8, `[]` when fewer than two.
4. Names from `languageName(primary subtag)`.

- [ ] **Step 1: Failing tests** — Riksbank-like page (`<html lang="sv">`, only `hreflang="en-gb"` to `/en-gb/`) → `[Svenska (current, url here), English]`; KTH-like (`lang="sv-SE"`, `hreflang="en-GB"`) → names `Svenska`, `English`, codes `sv-se`, `en-gb`; Apple-like `sv-SE` page with `ar-AE`, `ar-BH`, `en-AE`, `en-SE`, `de-DE`, `de-AT` → `Svenska`, `العربية` (ar-AE), `English` (en-SE), `Deutsch` (de-DE); `en-US`, `en-AU` on `sv-SE` → one English, `en-us`; a page whose hreflang includes itself behaves as today.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/chrome-extension test` (PASS).
- [ ] **Step 5: Commit** `fix: find a page's own language and one entry per language`

### Task 2: Breakpoints a pixel or two apart are one

**Files:** `packages/capture-dom/src/breakpoints.ts` (`readBreakpoints`); tests `packages/capture-dom/src/__tests__/breakpoints.test.ts` (or the existing breakpoint test file).

Rule: after counting uses, boundaries whose neighbours are within 2 px form a cluster (chain: 999, 1000, 1001 is one cluster). A cluster keeps one boundary: a Tailwind-named width (`breakpointName(w)` not starting with `min `) if any, else the most used, ties the smaller. Its uses are the cluster's total. Then the existing top-8 cut and ascending sort.

- [ ] **Step 1: Failing tests** — rules at `max-width: 999px`, `min-width: 1000px`, `max-width: 1000px` (boundaries 1000, 1000, 1001) plus `min-width: 999px` → one boundary `1000`; `max-width: 767px` + `min-width: 768px` + `max-width: 768px` → `768`; `640` and `768` stay apart; a cluster's summed uses decide the top-8 cut.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/capture-dom test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh` (PASS).
- [ ] **Step 5: Commit** `fix: count breakpoints a pixel or two apart as one`

### Task 3: Breakpoints as rows in the popup

**Files:** `apps/chrome-extension/src/plan-widths.ts` (`planWidths` also returns `ranges: { name: string; at: number; coveredBy?: string }[]` for every range, and takes `skip?: string[]` — range names the user unticked — leaving those out of `extras`; `extrasLine` is removed), `apps/chrome-extension/src/popup/popup.tsx` (the `Breakpoints` group; unticked names kept in state by name, so they survive device changes), `page.ts` (count line and button use the planned extras); tests `plan-widths.test.ts`, `popup.test.tsx`.

- [ ] **Step 1: Failing tests** — Mainline-like breakpoints `[640, 768, 1024, 1280, 1536]` with Laptop 1512, Tablet portrait 834, Phone portrait 390 ticked: rows `base 390 Phone portrait`, `sm 640 ☑`, `md 768 Tablet portrait`, `lg 1024 ☑`, `xl 1280 Laptop`, `2xl 1536` — compute `at` and `coveredBy` with the existing range rules and assert them; unticking `sm` drops it from the capture count and the request; Review Focus 3 sequence; no breakpoints → no group; the `Also captures` text appears nowhere.
- [ ] **Step 2–4:** run (FAIL), implement with `@repo/ui` `Checkbox`/`Label`, matching the device rows' look (UI3 tokens only), run `bun run --filter @repo/chrome-extension test` (PASS).
- [ ] **Step 5: Commit** `feat: show breakpoints as rows in the popup`

### Task 4: Languages are always modes

**Files:** `packages/figma-mapper/src/devices.ts` (remove the `rate < 0.8` branch and `languageFrames`; every pairing binds its paired, non-mixed texts; a device under 0.8 adds the `Only n% …` line), `apps/design-plugin/src/plugin/applier.ts` (remove the language-Section path: `sectionFor` and what only it uses), `packages/ui/src/import/import-flow.ts` and `packages/common/src/networkSides.ts` (remove the `languageFrames` plumbing and `device.language`); tests in `devices.test.ts`, the sandbox tests, `import-flow.test.ts`, and the e2e language test.

- [ ] **Step 1: Failing tests** — a Phone pairing at 0.6 binds its paired texts into Language and adds `Only 60% of the Svenska page matches English on Phone.`; no `languageFrames` field on the merge; Review Focus 1 and 5; the KTH-like case (35%) makes Language `Svenska/English` with the paired header texts bound; the old `differs too much` copy appears nowhere.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test && bun run --filter @repo/capture-dom test:e2e && bunx turbo run types --force` (PASS).
- [ ] **Step 5: Commit** `feat: always make languages modes of the language collection`

### Task 5: Devices and Breakpoints in "What's in this file"

**Files:** `packages/ui/src/import/contents.tsx`; tests `packages/ui/src/__tests__/App.test.tsx`.

- [ ] **Step 1: Failing tests** — headings `Devices` and `Breakpoints` in that order before `Themes`; rows `Laptop 1512`, `sm 640`, `min 576`; the note sits under the Breakpoints group; a file with no breakpoint captures shows no `Breakpoints` heading.
- [ ] **Step 2–4:** run (FAIL), implement (UI3 tokens only, same heading style as `Themes`), run `bun run --filter @repo/ui test` (PASS).
- [ ] **Step 5: Commit** `feat: label devices and breakpoints in what's in this file`

### Task 6: Docs, changeset and the gate

- [ ] **Step 1:** `apps/docs/content/docs/index.mdx` and `README.md`: languages always become modes (unmatched texts stay in the page's own language, the low-match line), language detection from `<html lang>`, one entry per language and plain names, breakpoint rows in the popup, merged near-boundaries, the plugin's Devices and Breakpoints groups; remove the separate-frames text.
- [ ] **Step 2:** `.changeset/languages-as-modes.md` (minor) for the packages whose source changed: "Languages always become modes of the Language collection; the popup finds more languages, names them simply and lists breakpoints as rows; breakpoints a pixel apart count as one."
- [ ] **Step 3:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 4: Commit** `docs: describe languages as modes and breakpoint rows`

### Task 7: Checks on real sites

- [ ] **Step 1 (agent, real Chromium):** capture kth.se (Svenska + English), riksbank.se/sv/ and su.se with the built extension; record the popup's languages and breakpoint rows, the files' breakpoints, and each file through grouping and merge (Language modes, bound texts, report lines) in `docs/superpowers/specs/2026-11-05-frottage-languages-as-modes-results.md`.
- [ ] **Step 2 [Owner]:** `bun run build`; reload; capture kth.se with English ticked; import; switch the Section's Language mode and confirm the header and menus swap while the news stays Swedish.
- [ ] **Step 3 (agent, Desktop Bridge, read-only):** count Language variables and bound texts in the owner's file; add to the results file.
