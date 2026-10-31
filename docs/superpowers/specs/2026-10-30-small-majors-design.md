# TypeScript 7, lint-staged 17, @types/node 26, jest-dom 7

**Date:** 2026-10-30
**Status:** Approved (brainstorm with Jonas, 2026-10-30)
**Stream:** majors left after the dependency refresh (PR #21) and the docs app upgrade (PR #23). react-day-picker 10 is the only remaining major and gets its own spec.

## Problem

Four devDependencies sit one major behind: `typescript` ^6.0.3 (7.0.2 current), `lint-staged` ^16.4.0 (17.6.0), `@types/node` ^25.9.9 (26.6.6, docs app only) and `@testing-library/jest-dom` ^6.10.0 (7.0.1). Each was excluded from the refresh because it was a major, and each turned out to be small once checked:

- TypeScript 7 is the native (Go) compiler. Its npm package ships `tsc` but no `lib/typescript.js`, so anything that loads the compiler API breaks. In this repo nothing does: Bun runs tests and builds without TypeScript, Biome lints without it, Storybook's default docgen is Babel-based, and Next 16.4.3 defaults `experimental.useTypeScriptCli` to `true`, running its build type-check and `next typegen` through the `tsc` CLI (it even special-cases TypeScript 7's extensionless bin wrapper). A dry run of TypeScript 7's `tsc --noEmit` passes in all four workspaces, and no tsconfig uses an option TypeScript 7 removed (`baseUrl`, `outFile`, `target ES5`, `module AMD/System/UMD`, `moduleResolution classic/node10`, `downlevelIteration`, or `esModuleInterop`/`alwaysStrict`/`allowSyntheticDefaultImports` set to false).
- lint-staged 17's only breaking change is the Node floor: 22.22.1, the latest active Node 22 LTS at its release. The husky hook runs `bunx lint-staged`, and `bunx` honours the `#!/usr/bin/env node` shebang, so the repo's declared floor has to move with it.
- `@types/node` 26 is a type-only bump in the docs app.
- jest-dom 7 requires Node 22 and `@testing-library/dom` 10.x, and keeps the `./matchers` entry that the Bun test preload imports (its export map is `.`, `./vitest`, `./matchers`, `./jest-globals`).

## Decisions

| Question | Decision |
| --- | --- |
| Grouping | One PR, one commit per major, full verification between commits. react-day-picker 10 stays out. |
| Node floor | `engines.node` moves from `>=22.12` to `>=22.22.1` so the declared floor matches lint-staged 17. CI already runs Node 24. The two docs sentences that name the floor follow. |
| Editor | `.vscode/extensions.json` recommends the TypeScript native-preview extension (`TypeScriptTeam.native-preview`) in place of the TypeScript nightly one (`ms-vscode.vscode-typescript-next`, which tracks the JS compiler lineage), because VS Code's built-in TypeScript service cannot use TypeScript 7 as the workspace version. The built-in service keeps working with its bundled compiler either way. |
| Next config | Unchanged. `useTypeScriptCli` is already the default; the spec records that fact so nobody sets it to `false`. |
| Changeset | None. Nothing `@repo/ui` or `@repo/common` ships changes. |

## Changes (in order)

1. **TypeScript 7.** `"typescript": "^7.0.2"` in `apps/docs`, `apps/design-plugin`, `packages/ui`, `packages/common`. README badge `typescript-6` becomes `typescript-7`. `.vscode/extensions.json` replaces `ms-vscode.vscode-typescript-next` with `TypeScriptTeam.native-preview`. No tsconfig changes. Verification: `bun run types` (4 tasks), `bun run docs:build` (Next's CLI type-check), `bun run test`.
2. **lint-staged 17.** `"lint-staged": "^17.6.0"` at the root; `engines.node` `>=22.22.1`; `apps/docs/content/docs/getting-started/index.mdx` prerequisite "version 22.12 or later" becomes "version 22.22 or later"; `apps/docs/content/docs/ai/mcp-servers.mdx` hint "v22.12 or higher" becomes "v22.22 or higher". Verification: a real commit through the husky hook on this branch (the next commit of the stream) shows lint-staged 17 running Biome on the staged files.
3. **@types/node 26.** `"@types/node": "^26.6.6"` in `apps/docs`. Verification: `bun run types`, `bun run docs:build`.
4. **jest-dom 7.** `"@testing-library/jest-dom": "^7.0.1"` in `packages/ui`. `packages/ui/src/test/testing-library.ts` keeps `import * as matchers from "@testing-library/jest-dom/matchers"`. Verification: `bun run test` (133 tests), `bun run types`.

## Facts the changes rely on (verified 2026-10-30)

- `typescript@7.0.2`: `bin.tsc = ./bin/tsc`, package export `.` resolves to `lib/version.cjs` (no `createProgram`), native binaries under `@typescript/typescript-<platform>` optional dependencies, `engines.node >=16.20.0`.
- Next 16.4.3 `config-shared.js` sets `experimental.useTypeScriptCli: true` by default; `verify-typescript-setup.js` throws "TypeScript X does not provide the compiler API required by Next.js" only when that flag is `false` and `lib/typescript.js` is missing; `runTypeScriptCli.js` resolves `lib/tsc.js` for TypeScript 7 and reads the config with `tsc --showConfig`. `next typegen` goes through the same code path.
- TypeScript 7 dry run with the scratch install's `lib/tsc.js`: exit 0 and no output for `packages/common`, `packages/ui`, `apps/design-plugin`, `apps/docs`.
- `lint-staged@17.6.0`: `engines.node >=22.22.1`; dependencies `tinyexec`, `picomatch`, `string-argv` (yaml optional). MIGRATION.md v17: Node 20 dropped, nothing else for a JSON config like ours.
- `@testing-library/jest-dom@7.0.1`: `engines.node >=22`; peers `@testing-library/dom >=10 <11`, `vitest >=0.32` (optional); exports `.`, `./vitest`, `./matchers` (`types/matchers-standalone.d.ts`) and `./jest-globals`.
- Storybook 10.6 `@storybook/react-vite` only loads `react-docgen-typescript` when `typescript.reactDocgen` is set to it; the repo's `.storybook/main.ts` does not set it.

## Verification

- After each commit: `bun run lint`, `bun run types`, `bun run test`.
- After the last commit: `bun run --filter @repo/design-plugin build`, `GITHUB_PAGES=true bun run docs:build` (Next's type-check runs under TypeScript 7), `bunx turbo run build-storybook --filter=@repo/storybook`, and `bun outdated --filter '*'` listing only `react-day-picker`.
- The lint-staged check is the hook run of a real commit in this stream.
- CI (clean Linux install on Node 24) is the clean-room check; see the Task 3 note in the docs upgrade plan for why a clean reinstall is not run in this session.

## Out of scope

- react-day-picker 10 (Calendar component API changes; own spec).
- tsconfig cleanup, switching VS Code to the native language service by default, Renovate rules for these packages (the grouped non-major rule covers future minors).
