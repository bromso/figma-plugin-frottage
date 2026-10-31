# Dependency Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every non-major dependency current, migrate to Changesets 3 so releases produce git tags and GitHub Releases, upgrade Biome with its config migration, raise the Node engine, and add Renovate so the drift does not recur.

**Architecture:** Six groups, one commit each, on branch `chore/stream-2-deps`. Implementers edit manifests and config; the controller runs `bun install` and the builds that load native binaries (plugin, docs, Storybook), because subagent sandboxes cannot. Every group is verified with the full command set before the next starts. Majors (TypeScript 7, Next/Fumadocs 16, react-day-picker 10, lint-staged 17) are excluded.

**Tech Stack:** Bun 1.4.2 workspaces, Turborepo, Biome, Changesets 3 with `changesets/action@v2`, Renovate.

**Spec:** `docs/superpowers/specs/2026-10-30-dependency-refresh-design.md`

**Branch:** `chore/stream-2-deps` in `/Users/jonasbroms/Sites/figma-plugin-template`, spec committed.

---

## Verification commands

**Implementer set** (safe in a sandbox), from the repo root after every edit:

```bash
bun run types 2>&1 | grep -E "Tasks:|error TS"      # Tasks: 3 successful, 3 total
bun run test 2>&1 | grep -E "Tasks:|^ *[0-9]+ (pass|fail)"   # Tasks: 2 successful; 131 pass, 0 fail
bun run lint 2>&1 | grep -E "Tasks:|✖|rror"        # Tasks: 5 successful, 5 total after Task 3 added a Storybook lint script (4 before); one pre-existing @repo/docs warning is fine
```

**Controller set** (loads native binaries; the controller runs these after the implementer reports):

```bash
bun install                                          # refreshes bun.lock after manifest edits
bun run --filter @repo/design-plugin build 2>&1 | grep -E "done|rror"
bun run docs:build 2>&1 | grep -E "Compiled|rror|Exited"
bunx turbo run build-storybook --filter=@repo/storybook 2>&1 | grep -E "Tasks:|rror"
```

Implementers never run `bun install`, `bun add`, `bun update`, `turbo`, `bun run build`, `docs:build` or Storybook. When a task needs the lockfile refreshed, the implementer edits the manifests, stops, and reports; the controller installs and hands back. A task is committed only after both sets pass.

Every commit ends with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

## Version targets (registry, 2026-10-30)

| Package | Where | From | To |
| --- | --- | --- | --- |
| react, react-dom | ui, storybook, docs | ^19.2.5 | ^19.3.1 |
| @types/react, @types/react-dom | ui, docs | ^19.2.14 / ^19.2.3 | ^19.3.0 / ^19.3.0 |
| radix-ui | ui | ^1.4.3 | ^1.8.1 |
| lucide-react | ui, storybook | ^1.8.0 | ^1.65.0 |
| tailwind-merge | ui | ^3.5.0 | ^3.7.0 |
| @iconify/react | ui | ^6.0.2 | ^6.0.3 |
| @iconify-json/lucide | ui | ^1.2.102 | ^1.2.149 |
| recharts | ui (exact), storybook | 3.8.0 / ^3.8.1 | 3.10.1 / ^3.10.1 |
| date-fns | ui, storybook | ^4.1.0 | ^4.4.0 |
| sonner | ui, storybook | ^2.0.7 | ^2.0.8 |
| input-otp | ui, storybook | ^1.4.2 | ^1.5.0 |
| react-resizable-panels | ui, storybook | ^4.10.0 | ^4.15.2 |
| @types/mdx | docs | ^2.0.13 | ^2.0.14 |
| storybook, @storybook/addon-docs, @storybook/react, @storybook/react-vite | storybook (exact) | 10.3.5 | 10.6.5 |
| turbo | root | ^2.9.6 | ^2.11.10 |
| @figma/plugin-typings | design-plugin | ^1.124.0 | ^1.142.0 |
| @biomejs/biome | root (exact) | 2.4.12 | 2.6.4 |
| @changesets/cli | root | ^2.31.0 | ^3.0.3 |
| @changesets/changelog-github | root | ^0.6.0 | ^1.0.1 |
| husky | root | ^9.1.7 | unchanged (latest) |
| lint-staged | root | ^16.4.0 | unchanged (17 is a major) |

---

### Task 1: React and component libraries

**Files:**
- Modify: `packages/ui/package.json`, `apps/storybook/package.json`, `apps/docs/package.json`

- [ ] **Step 1: Edit the manifests**

In `packages/ui/package.json` `dependencies`: `"@iconify-json/lucide": "^1.2.149"`, `"@iconify/react": "^6.0.3"`, `"lucide-react": "^1.65.0"`, `"radix-ui": "^1.8.1"`, `"react": "^19.3.1"`, `"react-dom": "^19.3.1"`, `"tailwind-merge": "^3.7.0"`; in `devDependencies`: `"@types/react": "^19.3.0"`, `"@types/react-dom": "^19.3.0"`.

In `apps/storybook/package.json`: `dependencies.lucide-react` → `"^1.65.0"`; `devDependencies.react` and `react-dom` → `"^19.3.1"`.

In `apps/docs/package.json`: `dependencies.react` and `react-dom` → `"^19.3.1"`; `devDependencies.@types/react` and `@types/react-dom` → `"^19.3.0"`.

Edit the JSON by hand (or with a short Python script using `json.load`/`json.dump(indent=2)` and a trailing newline), keep key order, and validate: `python3 -c "import json;[json.load(open(f)) for f in ['packages/ui/package.json','apps/storybook/package.json','apps/docs/package.json']];print('json ok')"`.

- [ ] **Step 2: Hand off for install**

Report the edited files. Controller runs `bun install` and `git diff --stat bun.lock`.

- [ ] **Step 3: Check lucide icon names**

lucide-react jumped 57 minors; icons can be renamed. Run:

```bash
grep -rhoE "import \{[^}]*\} from \"lucide-react\"" packages/ui/src apps/storybook/src | tr ',' '\n' | sed 's/import {//;s/} from "lucide-react"//;s/ //g' | sort -u
bun run types 2>&1 | grep -E "error TS|Tasks:"
```

If `types` reports `has no exported member 'XIcon'`-style errors, find the new name in `node_modules/lucide-react/dist/lucide-react.d.ts` (`grep -n "export declare const <Name>" …`) and update the import and usage. Record every rename in the commit body.

- [ ] **Step 4: Verify (implementer set, then controller set)**

Expected: types 3/3, tests 131 pass, lint 4/4; plugin, docs and Storybook build. If the Storybook build fails on a Radix 1.8 change, read the error, fix the component, and note it.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json apps/storybook/package.json apps/docs/package.json bun.lock
git commit -m "chore(deps): react 19.3, radix-ui 1.8, lucide-react 1.65 and related minors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Add any renamed-icon source files to `git add`.)

---

### Task 2: Remaining UI, Storybook and docs dependencies

**Files:**
- Modify: `packages/ui/package.json`, `apps/storybook/package.json`, `apps/docs/package.json`

- [ ] **Step 1: Edit the manifests**

`packages/ui/package.json` `dependencies`: `"date-fns": "^4.4.0"`, `"input-otp": "^1.5.0"`, `"react-resizable-panels": "^4.15.2"`, `"recharts": "3.10.1"` (keep it exact, as it is today), `"sonner": "^2.0.8"`.

`apps/storybook/package.json` `dependencies`: `"date-fns": "^4.4.0"`, `"input-otp": "^1.5.0"`, `"react-resizable-panels": "^4.15.2"`, `"recharts": "^3.10.1"`, `"sonner": "^2.0.8"`.

`apps/docs/package.json` `dependencies`: `"@types/mdx": "^2.0.14"`.

Validate the JSON as in Task 1.

- [ ] **Step 2: Hand off for install** (controller runs `bun install`).

- [ ] **Step 3: Verify (implementer set, then controller set)**

Pay attention to `packages/ui/src/components/ui/chart.tsx` (recharts 3.10) and `input-otp.tsx`: type errors there are the likely failure mode. Fix minimally and note it.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json apps/storybook/package.json apps/docs/package.json bun.lock
git commit -m "chore(deps): recharts 3.10, date-fns 4.4, sonner, input-otp, resizable panels, mdx types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Tooling: Storybook 10.6, turbo, Figma typings, Biome 2.6

**Files:**
- Modify: `apps/storybook/package.json`, `package.json` (root), `apps/design-plugin/package.json`, `biome.json`

- [ ] **Step 1: Edit the manifests**

`apps/storybook/package.json` `devDependencies`: `"@storybook/addon-docs": "10.6.5"`, `"@storybook/react": "10.6.5"`, `"@storybook/react-vite": "10.6.5"`, `"storybook": "10.6.5"` (all exact).

Root `package.json` `devDependencies`: `"turbo": "^2.11.10"`, `"@biomejs/biome": "2.6.4"` (exact). Leave `husky` and `lint-staged` as they are.

`apps/design-plugin/package.json` `devDependencies`: `"@figma/plugin-typings": "^1.142.0"`.

- [ ] **Step 2: Hand off for install** (controller runs `bun install`).

- [ ] **Step 3: Migrate the Biome config**

```bash
bunx biome migrate            # dry run: lists the changes 2.6 wants
bunx biome migrate --write
git diff biome.json
```

Expected: the `$schema` URL moves to `https://biomejs.dev/schemas/2.6.4/schema.json` and possibly renamed rule or option keys. Read the diff; if migrate removed or renamed one of the `overrides` rules under `packages/ui/src/components/ui/**`, keep the equivalent rule disabled. Then `bun run lint`. If 2.6 adds new recommended rules that fire, either fix the code (preferred when under ten findings) or add the rule to the existing `overrides` block with `"off"` and a one-line comment in the commit body saying why.

- [ ] **Step 4: Verify (implementer set, then controller set)**

Storybook 10.6 is the risk here: the controller's `build-storybook` must pass and the twelve `ui3-*--parity` story ids must still be in `apps/storybook/storybook-static/index.json` (`grep -o '"ui3-[a-z]*--parity"' apps/storybook/storybook-static/index.json | sort -u | wc -l` → 12).

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/package.json package.json apps/design-plugin/package.json biome.json bun.lock
git commit -m "chore(deps): storybook 10.6, turbo 2.11, biome 2.6 with config migration, figma typings 1.142

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

Review outcome for Task 3: `noComponentHookFactories` is off only for `packages/ui/src/components/ui/calendar.tsx` (a second override), `!**/storybook-static` joined the Biome excludes, `apps/storybook` gained `"lint": "biome check ."` so turbo lints it, and `.storybook/preview.ts` uses the Storybook 10 `viewport.options` key with the default preset at 320×480.

### Task 4: Changesets 3 and the release workflow

**Files:**
- Modify: `package.json` (root: devDependencies and `release` script), `.changeset/config.json`, `.github/workflows/release.yml`, `README.md:115`, `CONTRIBUTING.md:105`, `.claude/CLAUDE.md:45`, `apps/docs/content/docs/project/versioning.mdx:35`

- [ ] **Step 1: Edit the root manifest**

`devDependencies`: `"@changesets/changelog-github": "^1.0.1"`, `"@changesets/cli": "^3.0.3"`. `scripts.release`: `"changeset tag"` → `"changeset git-tag"`.

- [ ] **Step 2: Hand off for install** (controller runs `bun install`), then read `node_modules/@changesets/config/package.json` for its version `X.Y.Z`.

- [ ] **Step 3: Update `.changeset/config.json`**

Replace the whole file with (substitute the `@changesets/config` version read in Step 2 for `X.Y.Z`):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@X.Y.Z/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "bromso/figma-plugin-template" }],
  "commit": false,
  "fixed": [["@repo/ui", "@repo/common"]],
  "linked": [],
  "access": "restricted",
  "baseBranch": "master",
  "updateInternalDependencies": "patch",
  "ignore": ["@repo/storybook", "@repo/design-plugin"],
  "privatePackages": true
}
```

- [ ] **Step 4: Update the release workflow**

Replace the last step of `.github/workflows/release.yml` (currently `uses: changesets/action@v1` with `title`, `commit`, `version`, `publish`) with:

```yaml
      - name: Version packages or create release
        uses: changesets/action@v2
        with:
          version-script: bun changeset version
          publish-script: bun changeset publish
          pr-title: "chore: version packages"
          commit-message: "chore: version packages"
          create-github-releases: true
          push-git-tags: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Leave the trigger, `concurrency`, the `permissions` block (`contents: write`, `pull-requests: write`), checkout, `setup-bun` 1.4.2 and `bun install --frozen-lockfile` as they are.

- [ ] **Step 5: Flip the release sentences**

| File | Replace | With |
| --- | --- | --- |
| `README.md:115` | `No git tags or npm releases are created (all packages are private).` | `Merging it also creates a git tag per package (\`@repo/ui@x.y.z\`, \`@repo/common@x.y.z\`) and a GitHub Release with the changelog entry.` |
| `CONTRIBUTING.md:105` | `No git tags or GitHub Releases are created (all packages are private).` | `Merging it also creates a git tag per package (\`@repo/ui@x.y.z\`, \`@repo/common@x.y.z\`) and a GitHub Release with the changelog entry.` |
| `apps/docs/content/docs/project/versioning.mdx:35` | the whole step 4 line | `4. When merged, the workflow runs \`changeset publish\`, which creates a git tag per package (\`@repo/ui@x.y.z\`, \`@repo/common@x.y.z\`) and a GitHub Release for each tag with its changelog entry. Nothing is published to npm; the packages are private and \`privatePackages\` in \`.changeset/config.json\` enables versioning and tagging them.` |
| `.claude/CLAUDE.md:45` | `merging that PR lands them on master` | `merging that PR lands them on master and creates a git tag plus a GitHub Release per package` |

- [ ] **Step 6: Verify**

```bash
bun changeset status 2>&1 | tail -3        # lists pending changesets (none yet is fine: exit 0 or a clear "no changesets" message)
bunx actionlint .github/workflows/release.yml 2>/dev/null || echo "actionlint not available; skip"
python3 -c "import json;json.load(open('.changeset/config.json'));print('config ok')"
grep -rn "No git tags\|npm releases are created\|changeset tag\b" README.md CONTRIBUTING.md .claude/CLAUDE.md apps/docs/content package.json   # no output
```

Then the implementer set; controller runs `bun run docs:build` since a docs page changed.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock .changeset/config.json .github/workflows/release.yml README.md CONTRIBUTING.md .claude/CLAUDE.md apps/docs/content/docs/project/versioning.mdx
git commit -m "chore: changesets 3 with private-package tags and GitHub releases via changesets/action v2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

Review outcome for Task 4: `@repo/docs` joins `ignore` (otherwise `privatePackages.tag` would tag the docs app at 0.0.0); the release job gains `actions/setup-node@v4` with Node 24 because the Changesets CLI runs under whatever `node` the runner resolves and cli 3 requires 22.11 or later; checkout gets `persist-credentials: false`; the job is named "Version or release"; `versioning.mdx` and `.changeset/README.md` note that `@repo/<pkg>@<version>` tags start with the first release after this change and that the three apps are ignored.

### Task 5: Node engine and Renovate

**Files:**
- Modify: `package.json` (root `engines`), `apps/docs/content/docs/getting-started/index.mdx`, `apps/docs/content/docs/project/contributing.mdx`
- Create: `renovate.json`

- [ ] **Step 1: Engines**

Root `package.json`: `"engines": { "node": ">=22.12", "bun": ">=1.4.2" }`.

- [ ] **Step 2: Create `renovate.json`**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    "group:allNonMajor",
    "schedule:earlyMondays",
    ":semanticCommitTypeAll(chore)"
  ],
  "lockFileMaintenance": {
    "enabled": true,
    "extends": ["schedule:earlyMondays"]
  },
  "semanticCommitScope": "deps",
  "rangeStrategy": "bump",
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "groupName": null,
      "labels": ["dependencies", "major"]
    },
    {
      "matchPackageNames": ["storybook", "@storybook/**", "@biomejs/biome"],
      "rangeStrategy": "pin"
    }
  ]
}
```

- [ ] **Step 3: Docs sentences**

In `apps/docs/content/docs/getting-started/index.mdx`, in the prerequisites list right after the Bun item, add: `- **[Node.js](https://nodejs.org)** (version 22.12 or later) — used by the release tooling and the docs site; Bun runs everything else`. In `apps/docs/content/docs/project/contributing.mdx`, at the end of the section that describes CI (after the "Every push to `master` …" paragraph and its list), add: `Dependency updates arrive as Renovate pull requests every Monday: one grouped PR for minor and patch updates, one PR per major.`

- [ ] **Step 4: Verify**

```bash
python3 -c "import json;json.load(open('renovate.json'));json.load(open('package.json'));print('json ok')"
bunx --package renovate renovate-config-validator renovate.json 2>&1 | tail -3   # expect "Config validated successfully"; if the download is too slow in the sandbox, report and the controller runs it
```

Then the implementer set; controller runs `bun run docs:build`.

- [ ] **Step 5: Commit**

```bash
git add package.json renovate.json apps/docs/content/docs/getting-started/index.mdx apps/docs/content/docs/project/contributing.mdx
git commit -m "chore: require node 22.12 and add renovate with grouped non-major updates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

Review outcome for Task 5: the major-update rule loses `"groupName": null` (it never affected `group:allNonMajor`, which matches only minor and patch, but it cancelled `group:monorepos`, so a Storybook or React major would have arrived as many PRs that cannot pass CI alone); a final rule `{ "matchDepTypes": ["engines"], "enabled": false }` keeps Renovate from bumping the `engines.node` and `engines.bun` floors, which the bun manager otherwise treats as dependencies under `rangeStrategy: "bump"`; the contributing sentence says monorepo packages move together; `mcp-servers.mdx` drops its last "v18 or higher" hint. Accepted as-is: `config:recommended` opens a Dependency Dashboard issue; Bun bumps arrive through `packageManager` and `setup-bun` in the grouped PR while the "1.4.2 or later" docs wording stays a true minimum; `semanticCommitScope: "deps"` and the lockFileMaintenance schedule repeat defaults as a statement of intent. Follow-ups: pin `setup-node` in `docs.yml` when Next 16 lands; consider `minimumReleaseAge`.

### Task 6: Changeset

**Files:**
- Create: `.changeset/dependency-refresh.md`

- [ ] **Step 1: Write the changeset**

```md
---
"@repo/ui": patch
---

Refresh dependencies: React 19.3, radix-ui 1.8, lucide-react 1.65, recharts 3.10, tailwind-merge 3.7 and other minors. No API changes; icon glyphs may differ slightly with the newer Lucide set.
```

- [ ] **Step 2: Verify**

`bun changeset status 2>&1 | tail -5` → lists `@repo/ui` (and `@repo/common` via the fixed group) for a patch bump.

- [ ] **Step 3: Commit**

```bash
git add .changeset/dependency-refresh.md
git commit -m "chore: add changeset for the dependency refresh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Final verification, review, PR (controller)

- [ ] **Step 1: Clean reinstall and full verification**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile
bun run lint && bun run types && bun run test
bun run --filter @repo/design-plugin build && bun run docs:build && bunx turbo run build-storybook --filter=@repo/storybook
bun outdated --filter '*'
```

Expected: all green; `bun outdated` lists only the excluded majors (fumadocs, next, react-day-picker, lint-staged if shown) and nothing else.

- [ ] **Step 2: Changesets dry run**

```bash
bun changeset version
git status --short          # expect package.json and CHANGELOG.md changes in packages/ui and packages/common, and .changeset/dependency-refresh.md deleted
git diff packages/ui/package.json | grep '"version"'   # 1.4.0 → 1.4.1
git checkout -- packages .changeset && git status --short   # clean again
```

- [ ] **Step 3: Review**

A reviewer with repo access checks: every bump matches the version table (no accidental majors), the Biome migration diff, the release workflow against the `changesets/action@v2` input names, `renovate.json` against Renovate's preset names, and the four flipped sentences against the workflow's behaviour. Fixes land as `fix:` or `docs:` commits.

- [ ] **Step 4: Storybook check (Jonas)**

Page through the `UI3/*` parity stories in both themes for icon changes from lucide 1.65.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin chore/stream-2-deps
gh pr create --base master --title "chore: dependency refresh, changesets 3 with tagged releases, renovate" --body "$(cat <<'PRBODY'
## Summary
- Every non-major dependency current: React 19.3, radix-ui 1.8, lucide-react 1.65, recharts 3.10, Storybook 10.6, turbo 2.11, Biome 2.6 (config migrated), Figma typings 1.142, and the smaller minors
- Changesets 3 with `privatePackages: true` and `changesets/action@v2`: the version PR now produces a git tag and a GitHub Release per package
- `engines.node` raised to 22.12; Renovate config with grouped non-major updates, separate major PRs and lockfile maintenance
- Excluded on purpose, each for a later spec: TypeScript 7, Next 16 + Fumadocs 16, react-day-picker 10, lint-staged 17

Spec: docs/superpowers/specs/2026-10-30-dependency-refresh-design.md
Plan: docs/superpowers/plans/2026-10-30-dependency-refresh.md

## Test plan
- [ ] CI green
- [ ] After merge: the version PR opens; merging it creates `@repo/ui@1.4.1` and `@repo/common@1.4.1` tags and two GitHub Releases
- [ ] Renovate app enabled on the repository (Jonas)
- [ ] UI3 parity stories checked for icon changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

---

Task 7 outcome: after the clean reinstall, `bun outdated` still listed eleven in-range updates the version table had not named (next 15.5.28, typescript 6.0.3, @types/node 25.9.9, autoprefixer 10.6.2, postcss 8.5.32, @tailwindcss/vite 4.3.3, @vitejs/plugin-react 6.1.2, vite 8.3.5, @testing-library/jest-dom 6.10.0, @testing-library/react 16.3.3, shadcn 4.23.0). They were applied with `bun update <pkg>` per workspace as one extra commit and verified with the same six commands, after which only the excluded majors remain (plus @types/node 26 and @testing-library/jest-dom 7, both majors). The Changesets dry run needs `GITHUB_TOKEN` because `@changesets/changelog-github` resolves commit metadata; with `GITHUB_TOKEN=$(gh auth token)` it bumps both packages to 1.4.1. The `bun run test` grep in Step 1 must match the turbo-prefixed lines (`@repo/ui:test:  131 pass`).

## Self-review

- **Spec coverage.** Groups 1–6 of the spec map to Tasks 1–6; the spec's verification section maps to the per-task verification plus Task 7 (clean reinstall, dry run, Storybook check, `bun outdated`). Docs sentences for tags and releases: Task 4 Step 5. Node and Renovate sentences: Task 5 Step 3. Changeset: Task 6.
- **Placeholders.** `X.Y.Z` in Task 4 Step 3 is resolved by Step 2 (read from the installed package); every other value is literal.
- **Consistency.** Version targets in the table match the manifest edits in Tasks 1–4; the release wording in Task 4 Step 5 matches the workflow inputs in Step 4; the changeset in Task 6 is the `@repo/ui` patch the spec decided on.
