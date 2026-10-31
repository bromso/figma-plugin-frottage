# Package Updates + README Badges Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update all npm packages to latest versions and add dynamic shields.io badges to README, replacing the Tech Stack table.

**Architecture:** Update 5 package.json files bottom-up (root → packages → apps), fix breaking changes per workspace, verify with types/test/build/lint after each group. Badges use shields.io static badges with version numbers.

**Tech Stack:** Bun, Turborepo, shields.io

---

### Task 1: Update Root package.json

**Files:**
- Modify: `package.json`

**Step 1: Update devDependencies**

```json
"devDependencies": {
  "@biomejs/biome": "2.4.12",
  "turbo": "^2.9.6"
}
```

**Step 2: Run install**

Run: `bun install`
Expected: Clean install, lockfile updated

**Step 3: Verify lint still works**

Run: `bun run lint`
Expected: Exit 0

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: update biome 2.4.12, turbo 2.9.6"
```

---

### Task 2: Update packages/common

**Files:**
- Modify: `packages/common/package.json`

**Step 1: Update devDependencies**

```json
"devDependencies": {
  "@types/node": "^25.0.0",
  "typescript": "^6.0.0",
  "vitest": "^4.1.4"
}
```

Note: `typescript` and `vitest` already at latest. `@types/node` bumps from 24→25.

**Step 2: Run install + types**

Run: `bun install && bun run --filter @repo/common types`
Expected: Both exit 0

**Step 3: Commit**

```bash
git add packages/common/package.json bun.lock
git commit -m "chore: update @types/node to ^25 in packages/common"
```

---

### Task 3: Update packages/ui

**Files:**
- Modify: `packages/ui/package.json`

**Step 1: Update dependencies and devDependencies**

Key changes:
- `@types/node`: `^24.0.0` → `^25.0.0`
- `@vitejs/plugin-react`: `^4.0.0` → `^6.0.0`
- `happy-dom`: `^20.8.9` → `^20.9.0`
- `shadcn`: `^4.2.0` → `^4.3.0`
- `tailwindcss`: `^4.2.2` → `^4.2.3`

All other packages already at latest within their ranges.

**Step 2: Run install + types + test**

Run: `bun install && bun run --filter @repo/ui types && bun run --filter @repo/ui test`
Expected: All exit 0. 27 tests pass.

**Step 3: Commit**

```bash
git add packages/ui/package.json bun.lock
git commit -m "chore: update packages/ui deps (@vitejs/plugin-react 6, @types/node 25)"
```

---

### Task 4: Update apps/design-plugin

**Files:**
- Modify: `apps/design-plugin/package.json`

**Step 1: Update devDependencies**

Key changes:
- `@types/node`: `^24.0.0` → `^25.0.0`
- `@rolldown/plugin-babel`: `^0.1.0` → `^0.2.0`
- `vite-plugin-react-rich-svg`: `^1.0.0` → `^1.3.0`
- `vite-plugin-singlefile`: `^2.0.3` → `^2.3.0`
- `vite-plugin-generate-file`: `^0.2.0` → `^0.3.0`

**Step 2: Run install + types + build**

Run: `bun install && bun run --filter @repo/design-plugin types && bun run --filter @repo/design-plugin build`
Expected: All exit 0. Build produces dist/index.html + dist/plugin.js.

**Step 3: Commit**

```bash
git add apps/design-plugin/package.json bun.lock
git commit -m "chore: update design-plugin deps (rolldown-babel, singlefile, rich-svg)"
```

---

### Task 5: Update apps/storybook

**Files:**
- Modify: `apps/storybook/package.json`

**Step 1: Update devDependencies**

Key changes:
- `@vitejs/plugin-react`: `^4.0.0` → `^6.0.0`
- `vite`: `^6.0.0` → `^8.0.0`

Note: Storybook packages (`storybook`, `@storybook/*`) already at 10.3.5 (latest).

**Step 2: Run install + storybook build**

Run: `bun install && bunx turbo run build-storybook --force`
Expected: Build succeeds, no chunk warnings. If Storybook breaks with Vite 8, check `.storybook/main.ts` for Vite compatibility.

**Step 3: Commit**

```bash
git add apps/storybook/package.json bun.lock
git commit -m "chore: update storybook to vite 8, @vitejs/plugin-react 6"
```

---

### Task 6: Full verification pass

**Step 1: Run all checks**

```bash
bun run types        # All packages type-check
bun run lint         # Biome passes
bun run --filter @repo/ui test  # 27+ tests pass
bun run --filter @repo/design-plugin build  # Plugin builds
bunx turbo run build-storybook  # Storybook builds
```

Expected: All exit 0

**Step 2: Fix any issues**

If anything fails, fix the breaking change and re-verify.

---

### Task 7: Add README badges and remove Tech Stack table

**Files:**
- Modify: `README.md`

**Step 1: Add badges after the title**

Insert after line 1 (`# figma-plugin-template`), before the description:

```markdown
[![License: MIT](https://img.shields.io/github/license/bromso/figma-plugin-template)](LICENSE)
![Bun](https://img.shields.io/badge/bun-1.3-f9f1e1?logo=bun)
![TypeScript](https://img.shields.io/badge/typescript-6-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/vite-8-646cff?logo=vite&logoColor=white)
![Turborepo](https://img.shields.io/badge/turborepo-2-ef4444?logo=turborepo&logoColor=white)
![Biome](https://img.shields.io/badge/biome-2-60a5fa?logo=biome&logoColor=white)
![Storybook](https://img.shields.io/badge/storybook-10-ff4785?logo=storybook&logoColor=white)
![Figma](https://img.shields.io/badge/figma-plugin-a259ff?logo=figma&logoColor=white)
```

**Step 2: Remove the Tech Stack table**

Delete lines 102-113 (the `## Tech Stack` section with the table).

**Step 3: Update stale version refs in README body**

Update any other version references in the README body text that are now outdated (e.g., "14 native Figma UI components via react-figma-ui" is wrong — they're now shadcn/ui components).

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add shields.io badges, remove tech stack table, update version refs"
```
