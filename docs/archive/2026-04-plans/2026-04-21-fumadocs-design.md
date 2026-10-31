# Design: Fumadocs Documentation Site

**Date:** 2026-04-21
**Status:** Approved

## Problem

The template has no dedicated documentation site. Information is spread across README.md, CONTRIBUTING.md, CLAUDE.md, and CHANGELOG.md. Non-programmers need a guided, visual docs experience to understand how to use this template.

## Solution

### Fumadocs at apps/docs
Next.js 15 + fumadocs-core + fumadocs-ui + fumadocs-mdx. Static export for GitHub Pages deployment. MDX content with 10 essential pages across 4 sections.

### Site Structure
```
Getting Started:  Quick start, Testing in Figma
Guides:           Architecture, UI Components, Messaging, Plugin Config
AI:               Skills overview, Using Claude
Project:          Versioning, Contributing
```

### Deployment
GitHub Pages via `.github/workflows/docs.yml`. Accessible at `https://bromso.github.io/figma-plugin-template/`.

### Monorepo Integration
- `apps/docs/` auto-included via `apps/*` workspace glob
- Turbo tasks: `docs:dev` (persistent), `docs:build` (static)
- Root scripts: `bun run docs`, `bun run docs:build`

## Target Audience
Non-programmers who want to build Figma plugins using Claude Code.

## Files to Create
- `apps/docs/` — Full Next.js + Fumadocs app
- `apps/docs/content/docs/` — 10 MDX documentation pages
- `.github/workflows/docs.yml` — GitHub Pages deployment
- Modify: `turbo.json`, root `package.json`
