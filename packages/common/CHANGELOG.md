# @repo/common

## 2.0.0

No changes in this release.

## 1.4.2

No changes in this release.

## 1.4.1

No changes in this release.

## 1.4.0

### Minor Changes

- [#16](https://github.com/bromso/figma-plugin-template/pull/16) [`22e5c70`](https://github.com/bromso/figma-plugin-template/commit/22e5c704ba8cd739faeb384c9dc963c4ecd60fe1) Thanks [@bromso](https://github.com/bromso)! - Replace Vite and Vitest with Bun's bundler and test runner. The plugin is built by a single `build.ts` (standalone HTML output, Tailwind, React Compiler); tests run under `bun test` with happy-dom. Storybook keeps Vite. Requires Bun 1.4.2+. The manifest now sets `documentAccess: "dynamic-page"` and `networkAccess`, and the plugin UI finally receives Figma's theme class (`themeColors: true`) so dark mode can apply.

### Patch Changes

- [#6](https://github.com/bromso/figma-plugin-template/pull/6) [`0369460`](https://github.com/bromso/figma-plugin-template/commit/03694601a10dae8ca663abfac67da41d9bcdb977) Thanks [@bromso](https://github.com/bromso)! - inital automatic release
