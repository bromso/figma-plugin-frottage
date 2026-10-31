# Small Majors (TypeScript 7, lint-staged 17, @types/node 26, jest-dom 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the four remaining small majors forward in one PR: TypeScript 7.0.2 in all four type-checked workspaces, lint-staged 17.6 with the Node floor raised to 22.22.1, @types/node 26 in the docs app, and jest-dom 7 in the UI package.

**Architecture:** One commit per major on branch `chore/small-majors`, verified between commits (`bun run lint`, `bun run types`, `bun run test`), with the plugin, docs and Storybook builds once at the end. Implementers edit manifests and text; the controller runs `bun install`, the builds and anything that executes a freshly installed binary.

**Tech Stack:** Bun 1.4.2 workspaces, Turborepo, TypeScript 7.0.2 (native compiler, CLI only), Next 16.4.3 (`experimental.useTypeScriptCli` default `true`), lint-staged 17.6.0 via husky, `@testing-library/jest-dom` 7.0.1 under `bun test` with happy-dom, Biome 2.6.

Spec: `docs/superpowers/specs/2026-10-30-small-majors-design.md`.

---

## Facts verified before planning (2026-10-30)

- `typescript@7.0.2` exports no compiler API (`.` resolves to `lib/version.cjs`); `bin/tsc` is an extensionless ESM wrapper and `lib/tsc.js` is the JS entry that spawns the native `@typescript/typescript-<platform>` binary. A dry run of its `lib/tsc.js --noEmit` passes in `packages/common`, `packages/ui`, `apps/design-plugin` and `apps/docs` with the current tsconfigs.
- Next 16.4.3 defaults `experimental.useTypeScriptCli: true` and resolves TypeScript 7's `lib/tsc.js` itself, so `next build` and `next typegen` need no config change.
- `lint-staged@17.6.0` requires Node `>=22.22.1`; the husky hook is `bunx lint-staged`, which honours the Node shebang.
- `@testing-library/jest-dom@7.0.1` peers `@testing-library/dom >=10 <11`; the lock has `@testing-library/dom@10.4.1` (via `@testing-library/react ^10.0.0` peer). The `./matchers` entry the preload imports still exists.
- `@types/node` is declared only in `apps/docs` (`^25.9.9`); `@types/bun` depends on `@types/node *`.
- Exact lines to edit: `README.md:6` badge `typescript-6`; `package.json:26` `"node": ">=22.12"`; `package.json:34` `"lint-staged": "^16.4.0"`; `apps/docs/content/docs/getting-started/index.mdx:11` "(version 22.12 or later)"; `apps/docs/content/docs/ai/mcp-servers.mdx:122` "Should print v22.12 or higher"; `.vscode/extensions.json:12` `"ms-vscode.vscode-typescript-next",`; `typescript` at `apps/docs/package.json:32`, `apps/design-plugin/package.json:23`, `packages/ui/package.json:51`, `packages/common/package.json:22`; `@types/node` at `apps/docs/package.json:25`; `@testing-library/jest-dom` at `packages/ui/package.json:42`.

## Controller environment note

In this Claude Code session, the first execution of a newly created script file through its shebang stalls indefinitely (macOS provenance gating; see the Task 3 outcome in `docs/superpowers/plans/2026-10-30-docs-next16.md`). After `bun install` replaces `typescript` and `lint-staged`, their `.bin` shims are new files, so the controller runs them through `node` directly:

```bash
# instead of `bun run types` for the per-workspace check:
for w in packages/common packages/ui apps/design-plugin; do (cd $w && node ../../node_modules/typescript/lib/tsc.js --noEmit || node node_modules/typescript/lib/tsc.js --noEmit); done
(cd apps/docs && bun scripts/generate-source.ts && bunx next typegen && node node_modules/typescript/lib/tsc.js --noEmit)
# instead of relying on the husky hook for lint-staged:
node "$(find node_modules/.bun -path '*lint-staged@17*' -name 'lint-staged.js' -path '*/bin/*' | head -1)" --help
```

`bun run types` itself is still attempted first with a 120 s limit (`perl -e 'alarm 120; exec @ARGV' -- bun run types`); if it stalls, the direct form above is the verification and the stall is recorded, not worked around in the repo. CI runs the real scripts on Linux. If a `git commit` stalls in the husky hook for the same reason, abort it, run lint-staged through `node` as above on the staged files, and commit with `--no-verify`, recording that in the plan outcome.

---

### Task 1: TypeScript 7

**Files:**
- Modify: `apps/docs/package.json:32`, `apps/design-plugin/package.json:23`, `packages/ui/package.json:51`, `packages/common/package.json:22`, `README.md:6`, `.vscode/extensions.json:12`

- [ ] **Step 1: Manifests**

In each of the four workspace manifests change `"typescript": "^6.0.3"` to `"typescript": "^7.0.2"` with a targeted text edit (sed or the Edit tool; never re-serialize the JSON).

- [ ] **Step 2: README badge**

`README.md` line 6: `typescript-6-3178c6` becomes `typescript-7-3178c6`, so the line reads
```
![TypeScript](https://img.shields.io/badge/typescript-7-3178c6?logo=typescript&logoColor=white)
```

- [ ] **Step 3: Editor recommendation**

`.vscode/extensions.json`: insert `"TypeScriptTeam.native-preview",` on its own line directly after `"ms-vscode.vscode-typescript-next",` (same 4-space indentation, keep the trailing comma since more entries follow).

- [ ] **Step 4: Verify (implementer)**

```bash
python3 -c "import json;[json.load(open(f)) for f in ('apps/docs/package.json','apps/design-plugin/package.json','packages/ui/package.json','packages/common/package.json','.vscode/extensions.json')];print('json ok')"
grep -rn '"typescript": "\^' apps/*/package.json packages/*/package.json   # four lines, all ^7.0.2
git diff --stat   # six files
```

- [ ] **Step 5: Controller: install and verify**

```bash
bun install 2>&1 | tail -2
grep -oE '"typescript": \["typescript@[0-9.]+"' bun.lock | head -1          # typescript@7.0.2
ls node_modules/.bun | grep '^@typescript+typescript-darwin-arm64'           # native binary present
perl -e 'alarm 120; exec @ARGV' -- bun run types 2>&1 | grep -E "Tasks:|error TS"   # expect 4 successful; if it stalls, use the direct form from the environment note
bun run test 2>&1 | grep -E "[0-9]+ pass|[0-9]+ fail"
bun run lint 2>&1 | grep -E "Tasks:|✖|rror"
(cd apps/docs && GITHUB_PAGES=true bunx next build > /tmp/ts7-docs.log 2>&1; echo "next exit $?"; grep -nE "TypeScript|tsc|type check" /tmp/ts7-docs.log | head -5)
```
Expected: types 4/4, tests 133 pass, lint 5/5, `next build` exit 0 with its type-check step running (Next prints "Running TypeScript" and no API error).

- [ ] **Step 6: Commit**

```bash
git add apps/docs/package.json apps/design-plugin/package.json packages/ui/package.json packages/common/package.json README.md .vscode/extensions.json bun.lock
git commit -m "chore(deps): typescript 7

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: lint-staged 17 and the Node floor

**Files:**
- Modify: `package.json:26` and `:34`, `apps/docs/content/docs/getting-started/index.mdx:11`, `apps/docs/content/docs/ai/mcp-servers.mdx:122`

- [ ] **Step 1: Root manifest**

Targeted edits in `package.json`: `"lint-staged": "^16.4.0",` becomes `"lint-staged": "^17.6.0",`; inside `engines`, `"node": ">=22.12",` becomes `"node": ">=22.22.1",`. The `author` value `Jonas Bröms` must stay byte-identical, so no JSON re-serialization.

- [ ] **Step 2: Docs sentences**

`apps/docs/content/docs/getting-started/index.mdx` line 11: `(version 22.12 or later)` becomes `(version 22.22 or later)`.
`apps/docs/content/docs/ai/mcp-servers.mdx` line 122: `node --version  # Should print v22.12 or higher` becomes `node --version  # Should print v22.22 or higher`.

- [ ] **Step 3: Verify (implementer)**

```bash
python3 -c "import json;json.load(open('package.json'));print('json ok')"
git diff -- package.json | grep -E '^[-+]\s+"' # exactly the two changed lines
grep -rn "22\.12" package.json apps/docs/content README.md CONTRIBUTING.md .claude/CLAUDE.md   # expect no output
```

- [ ] **Step 4: Controller: install and verify**

```bash
bun install 2>&1 | tail -2
grep -oE '"lint-staged": \["lint-staged@[0-9.]+"' bun.lock | head -1     # lint-staged@17.6.0
LS=$(find node_modules/.bun -path '*lint-staged@17*' -name 'lint-staged.js' -path '*/bin/*' | head -1); node "$LS" --version
bun run lint 2>&1 | grep -E "Tasks:|✖|rror"
bun run docs:build > /tmp/ls17-docs.log 2>&1; echo "docs exit $?"
```
The hook check is the commit in Step 5: with the files staged, the husky pre-commit runs `bunx lint-staged` (17.6.0 now) and Biome passes over the staged JSON. If the hook stalls (environment note), abort after 60 s, run `node "$LS"` directly with the same files staged, and commit with `--no-verify`, noting it in the outcome paragraph.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock apps/docs/content/docs/getting-started/index.mdx apps/docs/content/docs/ai/mcp-servers.mdx
git commit -m "chore(deps): lint-staged 17 and node 22.22.1 as the floor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: @types/node 26

**Files:**
- Modify: `apps/docs/package.json:25`

- [ ] **Step 1: Manifest**

`"@types/node": "^25.9.9",` becomes `"@types/node": "^26.6.6",` (targeted edit).

- [ ] **Step 2: Controller: install and verify**

```bash
bun install 2>&1 | tail -2
grep -oE '"@types/node": \["@types/node@[0-9.]+"' bun.lock | head -2      # 26.6.6 for the docs app; other entries unchanged
perl -e 'alarm 120; exec @ARGV' -- bun run types 2>&1 | grep -E "Tasks:|error TS"   # or the direct form
bun run docs:build > /tmp/types26-docs.log 2>&1; echo "docs exit $?"
```

- [ ] **Step 3: Commit**

```bash
git add apps/docs/package.json bun.lock
git commit -m "chore(deps): @types/node 26 for the docs app

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: jest-dom 7

**Files:**
- Modify: `packages/ui/package.json:42`
- Unchanged but relied on: `packages/ui/src/test/testing-library.ts` (imports `@testing-library/jest-dom/matchers`)

- [ ] **Step 1: Manifest**

`"@testing-library/jest-dom": "^6.10.0",` becomes `"@testing-library/jest-dom": "^7.0.1",` (targeted edit).

- [ ] **Step 2: Controller: install and verify**

```bash
bun install 2>&1 | tail -2
grep -oE '"@testing-library/jest-dom": \["@testing-library/jest-dom@[0-9.]+"' bun.lock   # 7.0.1
bun run test --force 2>&1 | grep -E "[0-9]+ pass|[0-9]+ fail|error"     # 131 + 2 pass, 0 fail
perl -e 'alarm 120; exec @ARGV' -- bun run types 2>&1 | grep -E "Tasks:|error TS"   # or the direct form
```
If `bun test` reports a matcher type error, read `node_modules/@testing-library/jest-dom/types/matchers-standalone.d.ts` and adjust `packages/ui/src/test/testing-library.ts` minimally; record the change in the commit body.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/package.json bun.lock
git commit -m "chore(deps): @testing-library/jest-dom 7

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Final verification, review, PR (controller)

- [ ] **Step 1: Full verification**

```bash
bun install --frozen-lockfile 2>&1 | tail -1          # no changes
bun run lint && bun run test
perl -e 'alarm 120; exec @ARGV' -- bun run types      # or the direct form
bun run --filter @repo/design-plugin build
GITHUB_PAGES=true bun run docs:build                  # if the serwist shim stalls, next build + node node_modules/@serwist/cli/dist/bin.mjs build as in the docs upgrade plan
bunx turbo run build-storybook --filter=@repo/storybook
bun outdated --filter '*'                             # only react-day-picker 10 remains
```

- [ ] **Step 2: Review**

A reviewer checks the four commits against the spec: exactly the listed manifest lines changed, no tsconfig changes, the Node floor and both docs sentences agree, the README badge and editor recommendation, the lockfile diff (typescript 7 + `@typescript/typescript-*` optional binaries, lint-staged 17 tree, @types/node 26, jest-dom 7; nothing else), and the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` on every commit.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/small-majors
gh pr create --base master --title "chore(deps): typescript 7, lint-staged 17, @types/node 26, jest-dom 7" --body "$(cat <<'PRBODY'
## Summary
- TypeScript 7.0.2 in all four type-checked workspaces. Nothing here loads the compiler API: Bun and Biome do not use TypeScript, Storybook's default docgen is Babel-based, and Next 16.4.3 already type-checks through the `tsc` CLI (`experimental.useTypeScriptCli` defaults to true). No tsconfig changes were needed.
- lint-staged 17.6; its only breaking change is the Node floor, so `engines.node` is now `>=22.22.1` (CI already runs 24) and the two docs sentences that name the floor follow.
- @types/node 26 in the docs app; @testing-library/jest-dom 7 in the UI package (the Bun preload keeps importing `/matchers`).
- README badge says TypeScript 7; `.vscode/extensions.json` recommends the TypeScript 7 native language service extension.
- No changeset: nothing shipped by `@repo/ui` or `@repo/common` changes. Only react-day-picker 10 remains as a major.

Spec: docs/superpowers/specs/2026-10-30-small-majors-design.md
Plan: docs/superpowers/plans/2026-10-30-small-majors.md

## Test plan
- [x] Per commit: lint 5/5, types 4/4 (TypeScript 7 `tsc`), 133 tests
- [x] Plugin, docs (Next's type-check under TypeScript 7) and Storybook builds green; `bun outdated` lists only react-day-picker
- [ ] CI green
- [ ] Husky hook runs lint-staged 17 on the next local commit

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
gh project item-add 30 --owner bromso --url <pr-url>
```

---

## Outcomes

- **Task 1.** `bun run types` passed through the normal script (the freshly installed `tsc` shim did not stall this time), tests 133, lint 5/5, and the Pages docs build printed "Finished TypeScript in 429ms" from Next's CLI type-check. The lockfile also recorded the workspace versions 1.4.0→1.4.1 left behind by the version PR #22, which bumps manifests without running `bun install`. Quality review suggested dropping the `ms-vscode.vscode-typescript-next` recommendation now that the native extension is recommended; done in 27e0702.
- **Task 2.** The commit went through the husky hook and lint-staged 17.6.0 ran Biome on the staged file (its new progress output is visible in the hook log). Quality review found `CONTRIBUTING.md` still saying "Node.js >= 18" from before this stream; fixed in 80f0224 with the 22.22.1 floor.
- **Task 3.** Types 4/4 and the docs build pass on `@types/node` 26.6.6 (`undici-types` moved to 8.9). Quality review recommended pinning the docs app's Node types to the CI runtime (`^24`) rather than tracking the latest major, since the repo just documented a 22.22.1 floor and runs 24 in CI; kept at 26 per the approved spec because a pin at 24 is a downgrade that Renovate would flag indefinitely. Jonas decides; `@types/ws` still nests its own `@types/node` 20 (pre-existing).
- **Task 4.** 133 tests pass on jest-dom 7.0.1 with the unchanged `/matchers` preload; types 4/4.

## Self-review

- **Spec coverage.** Change 1 → Task 1 (manifests, badge, extension); change 2 → Task 2 (lint-staged, engines, two docs sentences, hook check); change 3 → Task 3; change 4 → Task 4; verification section → the per-task controller steps and Task 5; "Next config unchanged" is enforced by Task 1 touching no `next.config.mjs`.
- **Placeholders.** `<pr-url>` comes from the `gh pr create` output; every other value is literal.
- **Consistency.** The same four manifest paths are used in Task 1 and Task 5; the Node floor string `>=22.22.1` matches the docs sentences and CONTRIBUTING (22.22.1); commit messages match the spec's ordering.
