# Storybook Deploy + Source Links — Design

**Date:** 2026-04-22
**Status:** Approved

## Summary

Two changes: deploy Storybook alongside docs on GitHub Pages, and add source links to skills/plugins documentation pages.

## Part A: Storybook on GitHub Pages

Update `.github/workflows/docs.yml` to:
1. Build Storybook with `--base /figma-plugin-template/storybook/` flag
2. Copy `apps/storybook/storybook-static/` into `apps/docs/out/storybook/`
3. Deploy the combined folder as one GitHub Pages site

Result: Storybook at `bromso.github.io/figma-plugin-template/storybook/`

## Part B: Source links on docs pages

### ai/skills.mdx

Add GitHub repo link + skills.sh link (where available) for each skill:

- build-figma-plugin — local custom skill, no external link
- frontend-design — github.com/anthropics/skills + skills.sh
- shadcn — github.com/shadcn/ui + skills.sh
- find-skills — github.com/vercel-labs/skills + skills.sh
- skill-creator — github.com/anthropics/skills + skills.sh
- figma-use + figma-api — github.com/figma/mcp-server-guide + github.com/yuyz0112/public-api-skills

### ai/plugins.mdx

Add source link for superpowers plugin (GitHub + skills.sh if available).

### ai/agents.mdx

No changes — agents are a concept, not downloadable packages.
