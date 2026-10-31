# Design: Package Updates + README Badges

**Date:** 2026-04-21
**Status:** Approved

## Problem

Package versions are stale (e.g., storybook Vite at v6 while design-plugin uses v8, @vitejs/plugin-react v4 in some packages). README has no badges and an outdated Tech Stack table with hardcoded version numbers.

## Solution

### 1. Package Updates
Update all packages to latest versions across all 5 package.json files using `bun update --latest`. Fix breaking changes. Verify with types, test, build, lint.

### 2. README Badges
Add shields.io badges at the top: License, Bun, TypeScript, React, Vite, Turborepo, Biome, Storybook, Figma. Remove the Tech Stack table (badges replace it). Update any stale version references in README body text.

## Verification
- `bun run types` exit 0
- `bun run test` — 27+ tests pass
- `bun run build` — plugin builds
- `bun run lint` — no errors
- `turbo run build-storybook` — storybook builds
- README renders correctly on GitHub
