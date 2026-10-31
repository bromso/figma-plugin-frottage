# Dependency refresh: minors, Changesets 3, Biome 2.6, Renovate

**Date:** 2026-10-30
**Status:** Approved (brainstorm with Jonas, 2026-10-30)
**Stream:** 2 of the template refresh, second half. The first half (documentation drift) merged as PR #20.

## Problem

`bun outdated` on master (2026-10-30) shows every runtime library behind by a minor or more, Storybook pinned at 10.3.5 with 10.6.5 available, Biome at 2.4.12 with 2.6.4 available, and Changesets at 2.x while 3.0 is current. Three things make this more than housekeeping:

- The release workflow never creates tags or GitHub Releases. Every package is private and Changesets 2 does not tag private packages; the docs currently say so.
- `engines.node` is `>=18`, which is below what Changesets 3 (22.11) and the planned Next 16 (22.12) require.
- Nothing watches for drift, so the same gap reopens.

The audit also lists three major upgrades with migration work: TypeScript 7, Next 16 with Fumadocs 16 (and Tailwind 4 for the docs app), and react-day-picker 10. Those are out of scope here and each gets its own spec.

## Decisions

| Question | Decision |
| --- | --- |
| Scope | Every minor and patch bump, Storybook 10.6, turbo, Biome 2.6 with `biome migrate`, Changesets 3 with the v2 action and private-package tagging, Figma typings, `engines.node >= 22.12`, a Renovate config. Majors (TypeScript 7, Next/Fumadocs 16, react-day-picker 10) excluded. |
| Release output | Git tags and GitHub Releases per package on each version-PR merge. |
| Automation | Renovate with grouped non-major updates, majors as separate PRs, lockfile maintenance. Jonas enables the Renovate app. |
| Method | Targeted bumps in verified groups, one commit per group, full verification between groups. |
| Changeset | One `patch` changeset for `@repo/ui` describing the dependency refresh (Radix, lucide, recharts change what the package ships). No changeset for tooling. |

## Groups (in order)

Each group is one commit. After each: `bun run lint`, `bun run types`, `bun run test`, `bun run --filter @repo/design-plugin build`, `bun run docs:build`, `bunx turbo run build-storybook --filter=@repo/storybook`.

1. **React and component libraries** (`packages/ui`, `apps/storybook`, `apps/docs`): react and react-dom 19.3.1, radix-ui 1.8.1, lucide-react 1.65.0 (17 component files import it; renamed icons surface as type errors), tailwind-merge 3.7.0, @iconify/react 6.0.3, @iconify-json/lucide 1.2.149.
2. **Remaining UI and Storybook deps**: recharts 3.10.1 in both `packages/ui` (currently pinned 3.8.0) and `apps/storybook`, date-fns 4.4.0, sonner 2.0.8, input-otp 1.5.0, react-resizable-panels 4.15.2, @types/mdx 2.0.14 in `apps/docs`.
3. **Tooling**: Storybook 10.6.5 (exact pin; bump `storybook` and every `@storybook/*` entry in `apps/storybook/package.json` to the same version by hand rather than running `storybook upgrade`, so nothing else in the project is rewritten), turbo 2.11.x, @figma/plugin-typings 1.142.0, husky and lint-staged to their latest minors if `bun outdated` lists them, Biome 2.6.4 exact plus `bunx biome migrate --write` with the resulting `biome.json` diff reviewed and any new lint findings fixed or explicitly configured.
4. **Changesets 3 and the release workflow**: `@changesets/cli` 3.0.3, `@changesets/changelog-github` 1.0.1; `.changeset/config.json` gains `"privatePackages": true` and keeps `fixed`, `ignore` and the GitHub changelog; the root `release` script becomes `changeset git-tag`; `.github/workflows/release.yml` moves to `changesets/action@v2` with `version-script: bun changeset version`, `publish-script: bun changeset publish`, `pr-title` and `commit-message` `chore: version packages`, `create-github-releases: true`, `push-git-tags: true`. `.changeset/README.md` and the docs sentences in `README.md`, `.claude/CLAUDE.md`, `CONTRIBUTING.md` and `apps/docs/content/docs/project/versioning.mdx` that say no tags or releases are created change to describe the tags (`@repo/ui@x.y.z`, `@repo/common@x.y.z`) and releases.
5. **Engines and Renovate**: root `engines.node` to `>=22.12`; `renovate.json` with `config:recommended`, `group:allNonMajor`, a weekly early-Monday schedule, `lockFileMaintenance` enabled, `semanticCommitType: chore` and scope `deps`, majors as separate PRs. The docs `contributing.mdx` and `getting-started/index.mdx` mention the Node requirement and Renovate in one sentence each.
6. **Changeset**: `.changeset/dependency-refresh.md`, `patch` for `@repo/ui`.

## Facts the groups rely on (verified 2026-10-30)

- Changesets 3.0 renames `changeset tag` to `changeset git-tag`; private packages are neither versioned nor tagged unless `privatePackages` is set; `privatePackages: true` equals `{ version: true, tag: true }`; `changeset version` exits 1 with no pending changesets; the CLI is ESM and requires Node ^22.11 || ^24 || >=26; the `prettier` config key became `format` (this repo has neither).
- `changesets/action@v2` targets Changesets 3 and renames its inputs to `version-script`, `publish-script`, `pr-title`, `commit-message`, `pr-draft`, `pr-base-branch`, `create-github-releases`, `push-git-tags`, `push-with-git-cli`, `cwd`. It detects created tags from a structured output file the CLI writes (`CHANGESETS_OUTPUT`), pushes tags through the GitHub API and creates one release per tag. With all packages private and `privatePackages: true`, `changeset publish` creates tags without publishing to npm.
- Biome's upgrade procedure is: install the exact latest version, then `biome migrate` (dry run) and `biome migrate --write`.
- Renovate detects `bun.lock` and `package.json` and delegates lockfile updates to Bun; the hosted Mend app provides Bun.
- `@changesets/changelog-github` 1.0.1 depends on `@changesets/types ^7`, the Changesets 3 line.

## Verification

- The six commands above after every group, and once more after a clean reinstall (`rm -rf node_modules apps/*/node_modules packages/*/node_modules && bun install --frozen-lockfile`) at the end.
- Storybook built and paged through in both themes for icon changes from lucide 1.65 (the UI3 parity stories are the reference).
- Changesets dry run: `bun changeset status` and, in a scratch copy, `bun changeset version` to confirm the new CLI reads the config and bumps the fixed pair.
- After merge, the first version PR and its merge must produce two tags and two GitHub Releases; that is the acceptance test for group 4 and is listed in the PR's test plan.
- A reviewer checks each group's diff for accidental major bumps (`bun outdated` after the branch shows only the excluded majors) and reads the Biome migration diff.

## Out of scope

- TypeScript 7, Next 16 + Fumadocs 16 + Tailwind 4 for the docs app, react-day-picker 10 (each a later spec).
- Changing version-range policy (carets stay; Storybook and Biome stay exact).
- Dependabot.
