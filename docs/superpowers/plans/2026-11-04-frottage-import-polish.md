# Frottage Import Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the owner's first real import of Mainline showed: radii bind to a Border radius collection named after the site's classes, border-only paddings stop counting as raw spacing, palette colours that are Tailwind's own get Tailwind's names, collections and modes read smallest to largest, and the report says "colors".

**Architecture:** Small, independent fixes in capture (radius class names), mapper (stroke inset, palette names, ordering), sandbox (ascending mode creation) and UI copy.

**Tech Stack:** As before. No new dependencies or permissions.

**Spec:** `docs/superpowers/specs/2026-11-04-frottage-devices-themes-languages-design.md` and `2026-11-04-frottage-layered-collections-design.md` (fidelity: names are the site's own; framework knowledge may recognise what is there, never invent).

## Facts measured 2026-11-04 (owner's import, file `fvVQO0c4ISMC2GemBjOZQq`)

- 530 non-zero corner radii, 0 bound, no radius variable. Values 12, 16, 6, 24, 32 and 33554400 (`rounded-full`).
- Mainline CSS defines only `--radius: 8px`; classes: `.rounded-sm{calc(var(--radius) - 4px)}`, `.rounded-md{calc(var(--radius) - 2px)}`, `.rounded-lg{var(--radius)}`, `.rounded-xl{calc(var(--radius)*2 - 4px)}`, `.rounded-2xl{calc(var(--radius)*2)}`, `.rounded-3xl{…*3}`, `.rounded-4xl{…*4}`, `.rounded-full{3.40282e+38px}`, corner variants `.rounded-t-2xl`, `.rounded-tl-sm`, `.rounded-b-2xl`, and literal `.375rem`, `.3125rem`, `4px`. The capture recorded refs `--radius*2/3/4` but the mapper resolves `*n` only for `--spacing`.
- Spacing: 773 bound, 92 raw; most raw are 1 px (border-only frames whose padding equals the border width) and border-plus-padding sums on non-uniform borders (17, 25).
- Colour names like `gray/50` and `gray/50-2` are shadcn values equal to Tailwind's own `neutral` palette.

## Global Constraints

- Branch `feat/frottage-layered-collections`; local commits only. Conventional commits with the Co-Authored-By trailer; never `--no-verify`. Add one changeset `.changeset/import-polish.md` (patch) for the packages touched.
- `schemaVersion` stays 1; capture additions optional and bounded.
- Never invent tokens: a Tailwind name is used only for a colour exactly equal to that Tailwind default (within 1/255 per channel, alpha included); a radius name only from the class that set it.
- UI copy uses American spelling ("color").

## Review Focus

1. **A corner-specific radius class** (`rounded-t-2xl` with bottom corners 0): the two top corners bind to `radius/2xl`, the bottom stay 0. Test in Task 1.
2. **Two classes giving the same px** (`rounded-md` and a literal `.375rem` both 6 px): `radius/md` exists from the class; the literal one binds to it by exact value only if it is the unique 6 px radius variable. Test in Task 1.
3. **Re-import of an older file without radius class names**: radii stay raw as before, nothing breaks. Test in Task 1.
4. **A file whose plan allows fewer Breakpoint modes than needed**: the frames' modes are created, shown smallest to largest. Test in Task 4.
5. **A site colour one step off a Tailwind value**: keeps its family/step name, not Tailwind's. Test in Task 3.

---

### Task 1: Radii bind to a Border radius collection named after the site's classes

**Files:** `packages/capture-dom/src/token-refs.ts`, `packages/capture-schema/src/schema.ts` (+ bounded parse, JSON schema), `packages/figma-mapper/src/catalogue.ts` / `bind.ts` (radius resolution), tests in each package (`token-refs.test.ts`, `parse.test.ts`, `bind.test.ts` or `catalogue.test.ts`), e2e `walk.spec.ts` with fixture rules copied from the measured Mainline CSS above.

**Interfaces:**
- Produces (schema, optional): `tokenRefs.radiusClass?: [string | null, string | null, string | null, string | null]` — per corner (top-left, top-right, bottom-right, bottom-left), the name from the winning rule's selector when it is a single class matching `^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?(?:-([a-z0-9.]+))?$`; the captured name is group 1, or `DEFAULT` for bare `rounded`. Each ≤ 20 chars.
- The mapper resolves a corner with a class name to a radius primitive `radius/<name>` (`DEFAULT` → `radius/default`) whose value is that corner's computed px (`rounded-full` and any value ≥ 9999 → 9999). Two corners or elements with the same name but different px: the first (widest capture) wins and the mismatch is reported once (`radius/md has different values on this page.`). Corners without a class name keep today's path (`--radius*n` refs now resolve too, named `radius/x<n>`; else unique exact value; else raw).

- [ ] **Step 1: Write failing tests** — capture: `.rounded-md` gives `radiusClass: ["md","md","md","md"]`; `.rounded-t-2xl` gives `["2xl","2xl",null,null]`; `.rounded-full` gives `full`; a rule with two classes or an id gives null. Mapper: frames with those classes bind to `radius/md` (6), `radius/2xl` (16), `radius/full` (9999) in a `Border radius` collection via Theme tokens; a literal 6 px corner with no class binds to `radius/md` by unique exact value; an older capture without `radiusClass` behaves as before; `--radius*2` with no class resolves to `radius/x2`.
- [ ] **Step 2: Run** the three packages' tests — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run test && bun run --filter @repo/capture-dom test:e2e` — PASS.
- [ ] **Step 5: Commit** `fix: bind radii to a border radius collection named after the site's classes`

### Task 2: Border-only paddings are not raw spacing

**Files:** `packages/figma-mapper/src/bind.ts` (`strokeInset`), test `bind.test.ts`.

A frame with a uniform stroke whose padding on a side equals the stroke weight (CSS padding 0 inside a border) sets `layout.strokesIncluded`, uses padding 0 on that side, and counts nothing raw. A non-uniform stroke keeps today's behaviour (raw, counted).

- [ ] **Step 1: Write failing tests** — a 1 px bordered frame with padding 1 on every side: no raw spacing, `strokesIncluded`, padding fields 0; a 1 px bordered frame with padding 17 and ref `--spacing*4`: binds `spacing/4` as today; a non-uniform border frame: raw as today.
- [ ] **Step 2: Run** `bun run --filter @repo/figma-mapper test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `fix: stop counting border-only padding as raw spacing`

### Task 3: Tailwind's own colors get Tailwind's names

**Files:** Create `packages/figma-mapper/src/tailwind-palette.ts` (Tailwind v4 default palette: 22 families × 11 steps as `oklch()` strings, parsed once with `parseCssColor`); modify `packages/figma-mapper/src/infer.ts` (`primitiveName`) and `layering.ts` (synthesised Palette entries); test `tailwind-palette.test.ts`, `layering.test.ts`.

**Interfaces:** `tailwindName(rgba: Rgba): string | null` → `"neutral/950"` when exactly equal (1/255 per channel, opaque only), else null. Palette names use it first, then the family/step rule. Site-named colours keep the site's names.

- [ ] **Step 1: Write failing tests** — shadcn `oklch(14.5% 0 0)` → `neutral/950`, `oklch(98.5% 0 0)` → `neutral/50`, `oklch(97% 0 0)` → `neutral/100`; a value one 8-bit step away → null and keeps the family/step name; translucent values → null; on the shadcn fixture the Color Mode `background` Dark aliases `palette:neutral/950`.
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run --filter @repo/figma-mapper test` (PASS).
- [ ] **Step 5: Commit** `fix: name palette colors after Tailwind when they are Tailwind's own`

### Task 4: Smallest to largest

**Files:** `packages/figma-mapper/src/devices.ts` and `layering.ts` (order variables within each collection: numeric names ascending, then by value; Breakpoint modes in the plan ascending by min-width, with a separate `priority: string[]` listing frame-used modes first), `packages/figma-mapper/src/plan.ts` (`PlanCollection.priority?: string[]`), `apps/design-plugin/src/plugin/layers.ts` (`settleModes`: choose labels by `priority`, create them ascending; on a first `Limited to N modes only` refusal in a collection this import created, remove the modes it just added, remember N, and re-add the first N priority labels ascending), report lines sorted ascending; tests in `devices.test.ts`, `layers.test.ts`.

- [ ] **Step 1: Write failing tests** — Mainline-like plan: Breakpoint modes created `base, sm, md, lg, xl, min 1400`; Spacing variables `spacing/0_5, 1_5, 2, 2_5, 3, 4, 5, …` ascending; Typography groups ordered by breakpoint ascending; with a fake limit of 4 on a fresh file: created modes are the frame-used ones (`base`, `md`, `min 1400` plus the next priority) in ascending order and every frame keeps its mode; a re-import into an existing collection appends new modes (unchanged rule).
- [ ] **Step 2–4:** run (FAIL), implement, run `bun run test` (PASS).
- [ ] **Step 5: Commit** `fix: show modes and variables smallest to largest`

### Task 5: "colors", changeset and the gate

**Files:** `packages/ui/src/app.tsx`, `packages/ui/src/import/import-flow.ts`, `packages/figma-mapper/src/*` report strings (every user-facing "colour" → "color"), tests that assert copy, `.changeset/import-polish.md`.

- [ ] **Step 1:** Replace user-facing "colour(s)" with "color(s)"; update copy tests.
- [ ] **Step 2:** Changeset (patch) for `@repo/capture-schema`, `@repo/capture-dom`, `@repo/figma-mapper`, `@repo/design-plugin`, `@repo/ui`: "Binds radii to a Border radius collection named after the site's classes, names Tailwind's own colors after Tailwind, orders modes and variables smallest to largest, and stops counting border-only padding as raw spacing."
- [ ] **Step 3:** Run `bun run lint && bunx turbo run types --force && bun run test && bun run --filter @repo/capture-dom test:e2e && bun run --filter @repo/design-plugin build && bun run --filter @repo/chrome-extension build && bash scripts/check-bundles.sh && bun run --filter @repo/docs build` — all exit 0.
- [ ] **Step 4: Commit** `fix: say colors in the report`
