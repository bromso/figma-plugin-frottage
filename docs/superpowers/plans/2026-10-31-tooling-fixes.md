# Tooling and Small Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Storybook joins `bun run types`, the dead root version goes, the docs manifest follows the base-path switch, and the Calendar week-number cell stops leaking a prop.

**Architecture:** Five independent changes on one branch, one commit each. The Storybook check is a new `types` script that Turborepo's existing `types` task picks up; the docs base path becomes one exported constant; the Calendar fix is a one-line destructure proven by a test.

**Tech Stack:** Bun 1.4.2, Turborepo, TypeScript 7.0.2, Storybook 10.6.5 on Vite 8, Next 16 docs app, react-day-picker 10 via `@daypicker/react`, bun test with happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-31-tooling-fixes-design.md`

## Global Constraints

- Branch `chore/tooling-fixes` from master `94f28ad` (PR #27 merged); conventional commits. The open version PR #28 holds the pending `@repo/ui` 2.0.0; this bundle's patch changeset stacks on it.
- Dev-dependency ranges copied from `packages/ui` and `apps/docs`: `typescript` `^7.0.2`, `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`, `@types/node` `^26.0.0`.
- No `any`, no `@ts-expect-error`, no `@ts-ignore` in story files; no new `skipLibCheck`-style escapes beyond the `skipLibCheck: true` the Storybook tsconfig already has.
- With `GITHUB_PAGES=true` the docs manifest output must be byte-identical to today's.
- Run `bun test` from `packages/ui` (the preloads in `packages/ui/bunfig.toml` are skipped from the repo root). If a test file adds its own `afterEach`, call `cleanup()` first.
- One patch changeset for `@repo/ui` (fixed group bumps `@repo/common` too). Root, Storybook and docs are in the changesets `ignore` list.

## Review Focus

1. `bun run types` from the repo root must now include a `@repo/storybook#types` line and exit 0 (Task 2 verifies).
2. `bun run build-storybook` must still succeed after the tsconfig changes; Vite ignores `tsconfig` `paths`, so the `@/` alias in `.storybook/main.ts` stays (Task 1 verifies).
3. The docs manifest with `GITHUB_PAGES` unset must have root-relative paths (`/docs`, `/android-chrome-192x192.png`) so the local dev server serves them (Task 4 verifies).
4. `bun changeset status` must still run with no root version (Task 3 verifies).
5. `showWeekNumber` must still render the week-number column after the fix (Task 5's test asserts the cells exist, not only that the attribute is gone).

---

### Task 1: Storybook type-check runs

**Files:**
- Modify: `apps/storybook/package.json` (scripts, devDependencies)
- Modify: `apps/storybook/tsconfig.json`
- Modify: `apps/storybook/.storybook/preview.ts:1`
- Modify: `.claude/CLAUDE.md:62`

**Interfaces:**
- Produces: `bun run --filter @repo/storybook types` exists and reports only story-level errors (Task 2 fixes those).

- [ ] **Step 1: Record the baseline**

Run from `apps/storybook`: `../../packages/ui/node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"`
Expected: 146 (on master `94f28ad`).

- [ ] **Step 2: Add the script and dev-dependencies**

In `apps/storybook/package.json` add `"types": "tsc --noEmit"` to `scripts` and these `devDependencies`: `"@types/node": "^26.0.0"`, `"@types/react": "^19.3.0"`, `"@types/react-dom": "^19.3.0"`, `"typescript": "^7.0.2"`. Run `bun install` from the repo root.

- [ ] **Step 3: Extend the tsconfig**

In `apps/storybook/tsconfig.json` set `compilerOptions.paths` to:

```json
{
  "@repo/ui": ["../../packages/ui/src"],
  "@repo/ui/*": ["../../packages/ui/src/*"],
  "@/*": ["../../packages/ui/src/*"]
}
```

and add `"types": ["vite/client", "node"]` to `compilerOptions` (`vite/client` declares the `*.css` side-effect import; naming `types` disables automatic `@types/*` inclusion, so `node` is listed for `.storybook/main.ts`). Leave `include` as is.

- [ ] **Step 4: Fix the preview import**

In `apps/storybook/.storybook/preview.ts` line 1 change `from "storybook"` to `from "@storybook/react"`.

- [ ] **Step 5: Run the check and classify what is left**

Run from the repo root: `bun run --filter @repo/storybook types 2>&1 | grep "error TS" | cut -d'(' -f1 | sort | uniq -c`
Expected: no `TS2307`, `TS7016`, `TS2882` or `TS7026` errors remain; no error in `.storybook/`; no error under `../../packages/ui/`. Only `src/stories/**` files with `TS2322` (render-only stories) may remain.

- [ ] **Step 6: Confirm Storybook still builds**

Run from the repo root: `bun run --filter @repo/storybook build-storybook 2>&1 | tail -3`
Expected: exits 0 with the "Preview built" line.

- [ ] **Step 7: Update the command description**

In `.claude/CLAUDE.md` line 62 change "Type-check the plugin, `ui`, `common` and the docs app" to "Type-check the plugin, `ui`, `common`, Storybook and the docs app".

- [ ] **Step 8: Commit**

```bash
git add apps/storybook/package.json apps/storybook/tsconfig.json apps/storybook/.storybook/preview.ts .claude/CLAUDE.md bun.lock
git commit -m "chore(storybook): type-check with tsc under bun run types"
```

---

### Task 2: Stories type-check clean

**Files:**
- Modify: `apps/storybook/src/stories/DataDisplay/Chart.stories.tsx:5-9`
- Modify: `apps/storybook/src/stories/Inputs/InputOTP.stories.tsx:4-8`
- Modify: `apps/storybook/src/stories/Inputs/ToggleGroup.stories.tsx` (meta block)
- Modify: `apps/storybook/src/stories/Surfaces/Accordion.stories.tsx` (meta block)
- Modify: any other `src/stories/**` file Task 1 Step 5 listed

**Interfaces:**
- Consumes: the `types` script from Task 1.
- Produces: `bun run types` from the root exits 0 including `@repo/storybook#types`.

- [ ] **Step 1: Run the check and list the failing files**

Run from the repo root: `bun run --filter @repo/storybook types 2>&1 | grep "error TS" | cut -d'(' -f1 | sort -u`
Expected: the four files above (and possibly a few more); every error is `TS2322` on a story that uses `render` without `args` for a component whose props have required members.

- [ ] **Step 2: Fix the render-only stories**

In each listed file change the meta declaration from the `satisfies` form

```ts
const meta = { component: X, title: "…", tags: ["autodocs"] } satisfies Meta<typeof X>;
```

to the annotated form

```ts
const meta: Meta<typeof X> = { component: X, title: "…", tags: ["autodocs"] };
```

Keep `type Story = StoryObj<typeof meta>;` and every story body unchanged. The annotated form makes story `args` optional, which is what render-only stories need; the Docs tab still infers controls from `component`. If a file mixes render-only stories with `args`-driven ones, prefer adding the required `args` to the meta instead so the `satisfies` form stays.

- [ ] **Step 3: Run the Storybook check**

Run from the repo root: `bun run --filter @repo/storybook types`
Expected: exits 0, no `error TS` lines.

- [ ] **Step 4: Run the root check and lint**

Run from the repo root: `bun run types 2>&1 | grep -E "storybook#types|Tasks:"` then `bun run lint 2>&1 | tail -3`
Expected: a `@repo/storybook#types` task line, `Tasks: N successful, N total` with no failures; lint exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/src/stories
git commit -m "fix(storybook): render-only stories type-check against meta with optional args"
```

---

### Task 3: Root version removed

**Files:**
- Modify: `package.json:3`
- Modify: `apps/docs/content/docs/project/versioning.mdx:45`

- [ ] **Step 1: Delete the field**

Remove the line `"version": "1.3.0",` from the root `package.json`.

- [ ] **Step 2: Update the docs sentence**

In `apps/docs/content/docs/project/versioning.mdx` line 45 replace the final sentence "The root `package.json` version is not bumped by Changesets." with "The root `package.json` has no version field; the template's version is the version of those two packages."

- [ ] **Step 3: Verify install and changesets**

Run from the repo root: `bun install --frozen-lockfile && bun changeset status`
Expected: install exits 0 (if it reports the lockfile needs updating, run `bun install` and commit `bun.lock`); `changeset status` prints the pending changesets, or "No changesets present", without an error about the root package.

- [ ] **Step 4: Confirm nothing reads the root version**

Run from the repo root: `grep -rn '"version": "1.3.0"\|1\.3\.0' package.json .github apps/docs/src apps/design-plugin README.md CONTRIBUTING.md .claude/CLAUDE.md apps/docs/content`
Expected: only `versioning.mdx` lines that describe the 1.0.0 to 1.3.0 changelog range.

- [ ] **Step 5: Commit**

```bash
git add package.json apps/docs/content/docs/project/versioning.mdx bun.lock
git commit -m "chore: drop the unused root package.json version"
```

---

### Task 4: Docs base path in one place

**Files:**
- Create: `apps/docs/src/lib/base.ts`
- Modify: `apps/docs/src/app/layout.tsx:9`
- Modify: `apps/docs/src/lib/layout.shared.tsx:3`
- Modify: `apps/docs/src/app/manifest.ts:10,16,21`

**Interfaces:**
- Produces: `export const BASE: string` in `apps/docs/src/lib/base.ts`, value `"/figma-plugin-template"` when `process.env.GITHUB_PAGES === "true"`, else `""`.

- [ ] **Step 1: Capture today's manifest**

Run from `apps/docs`: `GITHUB_PAGES=true bun run build >/dev/null 2>&1 && cp out/manifest.webmanifest /tmp/manifest-before.webmanifest`
Expected: the file exists and contains `"/figma-plugin-template/docs"`. (Use the session scratchpad directory instead of `/tmp` when one is given.)

- [ ] **Step 2: Create the constant**

Create `apps/docs/src/lib/base.ts` containing exactly the `BASE` expression from `layout.tsx` line 9, exported.

- [ ] **Step 3: Import it in the three files**

- `layout.tsx`: delete line 9, add `import { BASE } from "@/lib/base";` (match the alias the file already uses for `@/lib/...`; if it uses relative imports, use `../lib/base`).
- `layout.shared.tsx`: delete line 3, import `BASE` the same way (`./base` relative).
- `manifest.ts`: import `BASE`; `start_url: \`${BASE}/docs\``; icon `src` values `\`${BASE}/android-chrome-192x192.png\`` and `\`${BASE}/android-chrome-512x512.png\``.

- [ ] **Step 4: Verify both modes**

Run from `apps/docs`: `GITHUB_PAGES=true bun run build >/dev/null 2>&1 && diff /tmp/manifest-before.webmanifest out/manifest.webmanifest && echo SAME`
Expected: `SAME`.
Then: `bun run build >/dev/null 2>&1 && grep -o '"start_url":"[^"]*"\|"/android-chrome-192x192.png"' .next/server/app/manifest.webmanifest.body 2>/dev/null || grep -rho '"start_url":"[^"]*"' .next | head -1`
Expected: `"start_url":"/docs"`. (If the non-Pages build has no static manifest file, run `bun run dev` briefly and `curl -s localhost:3000/manifest.webmanifest`.)

- [ ] **Step 5: Type-check and lint the docs app**

Run from the repo root: `bun run --filter @repo/docs types && bun run --filter @repo/docs lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/docs/src/lib/base.ts apps/docs/src/app/layout.tsx apps/docs/src/lib/layout.shared.tsx apps/docs/src/app/manifest.ts
git commit -m "fix(docs): web manifest derives its paths from the shared BASE constant"
```

---

### Task 5: Calendar week-number cell

**Files:**
- Modify: `packages/ui/src/components/ui/calendar.tsx:127-134`
- Test: `packages/ui/src/components/ui/calendar.test.tsx`
- Create: `.changeset/calendar-week-number-prop.md`

- [ ] **Step 1: Write the failing test**

Append to the `describe` block in `calendar.test.tsx`:

```tsx
it("renders week-number cells without a stray week attribute", () => {
  const { container } = render(<Calendar month={new Date(2025, 0, 1)} showWeekNumber />);
  const cells = container.querySelectorAll(".rdp-week_number");
  expect(cells.length).toBeGreaterThan(0);
  for (const cell of cells) {
    expect(cell.hasAttribute("week")).toBe(false);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run from `packages/ui`: `bun test src/components/ui/calendar.test.tsx`
Expected: FAIL on `hasAttribute("week")` being `true` (today each cell renders as `<td week="[object Object]" …>`). React 19 logs no warning for this, which is why the test checks the attribute rather than `console.error`.

- [ ] **Step 3: Implement the fix**

In `calendar.tsx` change the `WeekNumber` override signature from `({ children, ...props })` to `({ children, week: _week, ...props })`. Nothing else changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/ui`: `bun test src/components/ui/calendar.test.tsx` then `bun test`
Expected: all pass.

- [ ] **Step 5: Add the changeset**

Create `.changeset/calendar-week-number-prop.md`:

```md
---
"@repo/ui": patch
---

Calendar: the week-number cell no longer spreads the `week` object onto the `<td>`, which rendered a stray `week="[object Object]"` attribute when `showWeekNumber` was set.
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/ui/calendar.tsx packages/ui/src/components/ui/calendar.test.tsx .changeset/calendar-week-number-prop.md
git commit -m "fix(ui): calendar week-number cell drops the week prop before spreading"
```

---

### Task 6: RTL finding, outcomes and the pull request

**Files:**
- Modify: `docs/superpowers/plans/2026-10-31-tooling-fixes.md` (Outcomes section)

- [ ] **Step 1: Record outcomes**

Add an `## Outcomes` section at the end of this plan with one line per task (what changed, what the reviewer asked for) and the RTL finding verbatim from the spec: react-day-picker 10's `Nav` passes fixed chevron orientations, the flip lives in its stylesheet, the UI package does not import that stylesheet, so the Tailwind `rtl:` rule is the only flip and no change is needed; if the stylesheet is ever imported the Tailwind rule must go.

- [ ] **Step 2: Full verification**

Run from the repo root: `bun run types && bun run lint && bun run test && bun run build && bun run build-storybook`
Expected: every command exits 0.

- [ ] **Step 3: Commit and open the pull request**

```bash
git add docs/superpowers/plans/2026-10-31-tooling-fixes.md docs/superpowers/specs/2026-10-31-tooling-fixes-design.md
git commit -m "docs: record the tooling fixes task outcomes"
git push -u origin chore/tooling-fixes
gh pr create --title "chore: storybook type-check, root version, docs base path, calendar week-number prop" --body-file <body> 
gh project item-add 30 --owner bromso --url <pr-url>
```

The body lists the five decisions, the RTL finding, and the verification commands run, and ends with the attribution line from the session.

## Outcomes

Executed 2026-10-31 on `chore/tooling-fixes`, rebased onto master `94f28ad` after PR #27 merged. Each task had a fresh implementer and a fresh reviewer; all five code reviews approved on the first pass.

- **Task 1** (`d0a5483`): baseline on the new master was 146 errors, not 154. After the script, type packages, path aliases and `types: ["vite/client", "node"]`, 8 `TS2322` errors remained, all render-only stories. Storybook still built. The lockfile's workspace versions 1.4.1 → 1.4.2 (drift from version PR #26) rode along.
- **Task 2** (`e538fdc`): the plan's assumption was wrong: annotating the meta as `Meta<typeof X>` still left story `args` required. The stories are typed `StoryObj<typeof X>` instead, which is the documented CSF form for render-only stories; the final review confirmed the meta annotation redundant, so the `satisfies` form was restored and only the `Story` type line differs from the other stories. Root `bun run types` passes with `@repo/storybook#types` included.
- **Task 3** (`8022509`): root `version` removed, docs sentence replaced; `bun install --frozen-lockfile` unchanged, `bun changeset status` fine. A repo-wide grep found nothing reading the field.
- **Task 4** (`86f960c`): `BASE` lives in `apps/docs/src/lib/base.ts`; the GitHub Pages manifest is byte-identical, the local manifest has `"start_url":"/docs"`. Out of scope and left as is: `next.config.mjs` keeps its own `GITHUB_PAGES` check and `basePath` literal, since an `.mjs` config cannot import the TypeScript constant.
- **Task 5** (`bcbe010`): the spec's original claim that React warned about the leaked prop was wrong (React 19 is silent for a lowercase attribute with an object value); the defect is the `week="[object Object]"` attribute, and the test asserts on that attribute. RED showed `hasAttribute("week")` true; GREEN 3/3 in the file and 137/137 in the package.
- **RTL chevrons, no change.** react-day-picker 10's `Nav` passes fixed chevron orientations (`left` for previous, `right` for next) regardless of direction; the flip for RTL lives in its stylesheet (`.rdp-root[dir="rtl"] .rdp-nav .rdp-chevron { transform: rotate(180deg) }`). The UI package does not import that stylesheet and the custom `Chevron` renders Lucide icons without the `rdp-chevron` class, so the Tailwind `rtl:` rule is the only flip and there is no double flip. If the stylesheet is ever imported, the Tailwind rule must go.
- **Full verification on `bcbe010`:** `bun run types`, `lint`, `test`, `build` and `build-storybook` all green (uncached).
- **Final review** (whole branch): no Critical or Important findings; the redundant meta annotation was reverted and a comment now marks the Calendar RTL rule.
