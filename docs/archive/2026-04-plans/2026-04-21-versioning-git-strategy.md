# Versioning & Git Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install changesets, configure release automation, document git/branching strategy, and add AI guidance for versioning.

**Architecture:** @changesets/cli manages version bumps and CHANGELOG generation. A GitHub Action opens "Version Packages" PRs automatically. GitHub Flow branching with conventional commit prefixes.

**Tech Stack:** @changesets/cli, @changesets/changelog-github, GitHub Actions

---

### Task 1: Install changesets and initialize

**Files:**
- Modify: `package.json`
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`

**Step 1: Add @changesets/cli and @changesets/changelog-github to root devDependencies**

In `package.json`, add to devDependencies:
```json
"@changesets/changelog-github": "^0.6.0",
"@changesets/cli": "^2.31.0",
```

Add to scripts:
```json
"changeset": "changeset",
"version-packages": "changeset version",
"release": "changeset tag"
```

**Step 2: Run install**

Run: `bun install`
Expected: Clean install

**Step 3: Create .changeset/config.json**

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "bromso/figma-plugin-template" }
  ],
  "commit": false,
  "fixed": [["@repo/ui", "@repo/common"]],
  "linked": [],
  "access": "restricted",
  "baseBranch": "master",
  "updateInternalDependencies": "patch",
  "ignore": ["@repo/storybook", "@repo/design-plugin"]
}
```

Notes:
- `fixed` groups @repo/ui and @repo/common so they version together
- `ignore` excludes apps (they're not published, just consume packages)
- `changelog-github` generates GitHub-linked changelogs with PR references

**Step 4: Create .changeset/README.md**

```markdown
# Changesets

This project uses [changesets](https://github.com/changesets/changesets) to manage versions and changelogs.

## For contributors

When you make a change that affects users of this template, run:

\`\`\`bash
bun changeset
\`\`\`

This will ask you:
1. Which packages changed (usually the root `figma-plugin-template`)
2. Whether it's a major, minor, or patch change
3. A summary of what changed (write this for humans, not machines)

Commit the generated `.changeset/*.md` file with your PR.

## What counts as a change?

- **Major**: Breaking changes to the template structure or API
- **Minor**: New features, new components, new skills
- **Patch**: Bug fixes, dependency updates, documentation
```

**Step 5: Verify changeset works**

Run: `bun changeset status`
Expected: "No changesets present"

**Step 6: Commit**

```bash
git add package.json bun.lock .changeset/
git commit -m "chore: install @changesets/cli and configure for template releases"
```

---

### Task 2: Add version fields to all package.json files

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/ui/package.json`
- Modify: `packages/common/package.json`
- Modify: `apps/design-plugin/package.json`
- Modify: `apps/storybook/package.json`

**Step 1: Add version to root package.json**

Add `"version": "1.3.0"` after the `"description"` field (matches last shipped milestone v1.3).

**Step 2: Add version to packages/ui and packages/common**

Add `"version": "1.3.0"` to both (they're fixed-versioned together with root).

**Step 3: Add version to apps/design-plugin and apps/storybook**

Add `"version": "0.0.0"` to both (ignored by changesets, version is a formality).

**Step 4: Verify nothing broke**

Run: `bun run types && bun run lint`
Expected: Both exit 0

**Step 5: Commit**

```bash
git add package.json packages/ui/package.json packages/common/package.json apps/design-plugin/package.json apps/storybook/package.json
git commit -m "chore: add version fields to all package.json files (1.3.0)"
```

---

### Task 3: Create release GitHub Action

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create the release workflow**

```yaml
name: Release

on:
  push:
    branches: [master]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    name: Version Packages
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Create Release PR or Tag
        uses: changesets/action@v1
        with:
          title: "chore: version packages"
          commit: "chore: version packages"
          version: bun changeset version
          publish: bun changeset tag
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- `publish: bun changeset tag` creates git tags (no npm publish since packages are private)
- `changesets/action` auto-creates/updates a "Version Packages" PR when changesets exist
- When that PR merges, the action runs the `publish` command (creating tags)

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add changesets release workflow for automated versioning"
```

---

### Task 4: Update CONTRIBUTING.md with branching and versioning docs

**Files:**
- Modify: `CONTRIBUTING.md`

**Step 1: Add branching and versioning sections**

After the "Submitting a Pull Request" section, add:

```markdown
## Branch Naming

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feat/` | New features | `feat/color-picker-plugin` |
| `fix/` | Bug fixes | `fix/icon-render-crash` |
| `chore/` | Maintenance, deps | `chore/update-react-19` |
| `docs/` | Documentation | `docs/add-api-guide` |

## Commit Messages

Use [conventional commits](https://www.conventionalcommits.org/):

```
feat: add color picker component
fix: resolve icon rendering in dark mode
chore: update dependencies
docs: add plugin testing guide
```

## Versioning

This project uses [changesets](https://github.com/changesets/changesets) for versioning.

**After making changes**, run:

```bash
bun changeset
```

This creates a changeset file describing your changes. Commit it with your PR.

A GitHub Action will automatically create a "Version Packages" PR that bumps the version and updates CHANGELOG.md. Merging that PR creates a new release.

**Version types:**
- **Major** (2.0.0): Breaking changes to template structure
- **Minor** (1.4.0): New features, components, or skills
- **Patch** (1.3.1): Bug fixes, dependency updates
```

Also fix the stale `apps/figma-plugin/` reference in the project structure to `apps/design-plugin/`.

**Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add branching, commit, and versioning guidelines to CONTRIBUTING.md"
```

---

### Task 5: Update CLAUDE.md with versioning guidance

**Files:**
- Modify: `.claude/CLAUDE.md`

**Step 1: Add versioning section**

After the "Building Your Plugin" section and before "## Project Overview", add:

```markdown
## Git & Versioning

- **Always create feature branches** — never commit directly to master
- **Branch naming**: `feat/`, `fix/`, `chore/`, `docs/` prefixes
- **Conventional commits**: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`
- **After making user-facing changes**, run `bun changeset` and commit the changeset file
- **Don't bump versions manually** — changesets handles version bumps and CHANGELOG
```

**Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: add git/versioning guidance to CLAUDE.md for AI assistants"
```

---

### Task 6: Update build-figma-plugin skill

**Files:**
- Modify: `.agents/skills/build-figma-plugin/SKILL.md`

**Step 1: Add changeset step to the workflow**

In the "Step 4: Installation Guide" section, after the Figma installation instructions, add:

```markdown
### Step 5: Create a Changeset

After the plugin is built and working, create a changeset to track this change:

Run `bun changeset` and when prompted:
- Select `figma-plugin-template` as the changed package
- Choose `minor` (new plugin feature)
- Write a one-line summary of the plugin (e.g., "Add layer rename plugin")

Commit the changeset file.
```

**Step 2: Commit**

```bash
git add .agents/skills/build-figma-plugin/SKILL.md
git commit -m "docs: add changeset step to build-figma-plugin skill"
```

---

### Task 7: Create initial CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

**Step 1: Create CHANGELOG with historical entries**

```markdown
# figma-plugin-template

## 1.3.0

### Minor Changes

- Phase 17: Type safety — tsc pipeline, registerIcons API, StaticIconNameMap
- Phase 18: Bundle analysis report
- Phase 19: React 19 Compiler enabled
- Phase 20: Interaction tests, polymorphic Type, DX docs
- Non-programmer skills toolkit (build-figma-plugin, frontend-design, shadcn)
- GitHub Actions CI + husky pre-commit hooks

## 1.2.0

### Minor Changes

- Vite 8 + TypeScript 6 + Figma typings upgrade
- React 19 migration
- Tailwind CSS 4.x + bundle analysis
- shadcn/ui component migration (14 components)
- Storybook 10 upgrade

## 1.1.0

### Minor Changes

- react-figma-ui integration
- Storybook setup with component stories
- Claude Skills optimization
- License, security, contributing docs

## 1.0.0

### Major Changes

- Initial monorepo scaffolding with Turborepo + Bun
- Package extraction (@repo/ui, @repo/common)
- Build pipeline verification
- Biome + VS Code configuration
- Vitest + DX polish
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG.md with historical release notes"
```

---

### Task 8: Verify everything works end-to-end

**Step 1: Run full verification**

```bash
bun run types          # Type-check passes
bun run lint           # Biome passes
bun run --filter @repo/ui test  # 27 tests pass
bun run --filter @repo/design-plugin build  # Plugin builds
bun changeset status   # Shows "No changesets present"
```

**Step 2: Test the changeset flow**

```bash
bun changeset          # Should open interactive prompt
# Select figma-plugin-template, minor, "test changeset"
# Then discard: rm .changeset/*.md (don't commit a test changeset)
```

**Step 3: Push**

```bash
git push origin master
```
