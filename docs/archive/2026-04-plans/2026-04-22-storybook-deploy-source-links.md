# Storybook Deploy + Source Links — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy Storybook alongside docs on GitHub Pages, and add source links to skills/plugins docs pages.

**Architecture:** Update the docs.yml workflow to also build Storybook and combine both outputs into one deployment artifact. Update MDX pages to include GitHub repo and skills.sh links for each skill and plugin.

**Tech Stack:** GitHub Actions, Storybook, Fumadocs (MDX)

---

### Task 1: Update docs.yml workflow to build and deploy Storybook

**Files:**
- Modify: `.github/workflows/docs.yml`

**Step 1: Update the workflow**

Replace the entire contents of `.github/workflows/docs.yml` with:

```yaml
name: Deploy Docs

on:
  push:
    branches: [master]
    paths:
      - "apps/docs/**"
      - "apps/storybook/**"
      - "packages/ui/**"
      - ".github/workflows/docs.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build docs
        run: bun run docs:build
        env:
          GITHUB_PAGES: "true"

      - name: Build Storybook
        run: bunx turbo run build-storybook

      - name: Copy Storybook into docs output
        run: cp -r apps/storybook/storybook-static apps/docs/out/storybook

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/docs/out

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Changes from original:
- Added `apps/storybook/**` and `packages/ui/**` to paths trigger
- Increased timeout from 10 to 15 minutes
- Added "Build Storybook" step
- Added "Copy Storybook into docs output" step to combine both builds

**Step 2: Commit**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: deploy Storybook alongside docs on GitHub Pages"
```

---

### Task 2: Configure Storybook base path for GitHub Pages

**Files:**
- Modify: `apps/storybook/.storybook/main.ts`

**Step 1: Read the current Storybook main.ts**

Read `apps/storybook/.storybook/main.ts` to understand the current config.

**Step 2: Add viteFinal config for base path**

Storybook needs to know it's served from `/figma-plugin-template/storybook/` on GitHub Pages. Add a `viteFinal` config that sets the base path when the `GITHUB_PAGES` env var is set.

In the Storybook config object, add:

```typescript
viteFinal: (config) => {
  if (process.env.GITHUB_PAGES === "true") {
    config.base = "/figma-plugin-template/storybook/";
  }
  return config;
},
```

**Step 3: Update the workflow to pass GITHUB_PAGES to Storybook build**

In `.github/workflows/docs.yml`, update the "Build Storybook" step to include the env var:

```yaml
      - name: Build Storybook
        run: bunx turbo run build-storybook
        env:
          GITHUB_PAGES: "true"
```

**Step 4: Commit**

```bash
git add apps/storybook/.storybook/main.ts .github/workflows/docs.yml
git commit -m "fix: configure Storybook base path for GitHub Pages deployment"
```

---

### Task 3: Add source links to skills.mdx

**Files:**
- Modify: `apps/docs/content/docs/ai/skills.mdx`

**Step 1: Update skills.mdx with source links**

Replace the entire contents of `apps/docs/content/docs/ai/skills.mdx` with:

```mdx
---
title: Skills
description: Pre-installed Claude Code skills that help you build Figma plugins without writing code.
---

## What are skills?

Skills are instructions that teach Claude how to perform specific tasks. This template comes with skills pre-installed so Claude already knows how to build Figma plugins.

## Installed skills

### build-figma-plugin

The main skill. Describe your plugin idea in plain English and Claude generates everything:
- Plugin code (Figma API interactions)
- UI code (React components)
- Message types (communication between plugin and UI)
- Build validation (ensures the output works)
- Installation guide (how to load it into Figma)

This is a custom skill built specifically for this template.

### frontend-design

Generates polished, intentional UI that avoids the "generic AI look". Guides typography, color, and layout decisions.

[GitHub](https://github.com/anthropics/skills) · [skills.sh](https://skills.sh)

### shadcn

Knows how to correctly generate and compose shadcn/ui components — the same component library this template uses.

[GitHub](https://github.com/shadcn/ui) · [skills.sh](https://skills.sh)

### find-skills

Discover and install new skills from the [skills ecosystem](https://skills.sh). If you need a capability that's not built in, this skill helps you find it.

[GitHub](https://github.com/vercel-labs/skills) · [skills.sh](https://skills.sh)

### skill-creator

For power users: create your own custom skills for patterns you use repeatedly.

[GitHub](https://github.com/anthropics/skills) · [skills.sh](https://skills.sh)

### figma-use + figma-api

Reference skills that help Claude understand the Figma API and use Figma-related MCP tools.

[figma-use on GitHub](https://github.com/figma/mcp-server-guide) · [figma-api on GitHub](https://github.com/yuyz0112/public-api-skills)
```

**Step 2: Commit**

```bash
git add apps/docs/content/docs/ai/skills.mdx
git commit -m "docs: add source links to skills page"
```

---

### Task 4: Add source links to plugins.mdx

**Files:**
- Modify: `apps/docs/content/docs/ai/plugins.mdx`

**Step 1: Update plugins.mdx with source link for superpowers**

In `apps/docs/content/docs/ai/plugins.mdx`, after the line "Without this plugin, Claude would still write code — but it might skip important steps or make assumptions. Superpowers keeps it disciplined." add:

```mdx

[GitHub](https://github.com/anthropics/claude-code-plugins) · [skills.sh](https://skills.sh)
```

**Step 2: Commit**

```bash
git add apps/docs/content/docs/ai/plugins.mdx
git commit -m "docs: add source links to plugins page"
```

---

### Task 5: Verify build

**Step 1: Build docs**

Run: `cd apps/docs && GITHUB_PAGES=true bun run build`
Expected: Clean build with all pages.

**Step 2: Build Storybook**

Run: `GITHUB_PAGES=true bunx turbo run build-storybook`
Expected: Storybook builds to `apps/storybook/storybook-static/`.

**Step 3: Verify Storybook output exists**

Run: `ls apps/storybook/storybook-static/index.html`
Expected: File exists.

**Step 4: Verify no broken links in docs**

Run: `grep -r "skills/" apps/docs/content/docs/ 2>&1`
Expected: No matches for old paths.
