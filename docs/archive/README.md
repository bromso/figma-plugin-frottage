# Archive

Historical design and planning documents, kept for reference. Nothing here describes the current template; for that, read the documentation site (`apps/docs`) and `.claude/CLAUDE.md`. Current specs and plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## `2026-04-plans/`

The design documents and implementation plans written in April 2026, before the October 2026 refresh (Bun build, UI3 alignment, Changesets 3, Next 16 docs). They describe the Vite and Vitest build, react-figma-ui, the 1.x versioning scheme and other setups that have since been replaced. Paths, commands and versions in them are as they were then.

Superseded by later work:

- `2026-04-23-ui3-theming-design.md` and `2026-04-23-ui3-theming.md` (token swap and CSS-only overrides) by `docs/superpowers/specs/2026-10-29-ui3-alignment-design.md`.
- `2026-04-21-versioning-git-strategy*.md` (root `package.json` version, `changeset tag`) by Changesets 3 with per-package tags; see `apps/docs/content/docs/project/versioning.mdx`.
- The package-update half of `2026-04-21-package-updates-badges*.md` (a one-off `bun update --latest`) by Renovate; see `apps/docs/content/docs/project/contributing.mdx`. The README badges it added are still in use.
