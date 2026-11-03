# @repo/common

## 2.1.0

### Minor Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6) Thanks [@bromso](https://github.com/bromso)! - Import a set of versions as one: files of one page land side by side as `<page> — <label>`, each frame on its own mode of one shared variable collection, with its component section below it. One undo removes the whole set and Cancel takes it all back. A version that fails is named and the others stay. The report lists the modes, and says how many frames kept plain values when Figma has too few modes. In a set, uses count across its versions, so a heading set once at each of three widths becomes a text style that varies by mode. Adding a width to a set that's already in the file reuses its variables and styles and adds only a mode. Cancel in a later set keeps the sets already done and reports them.

## 2.0.1

### Patch Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A fill or effect Figma refuses, such as an enormous blur, no longer loses the frame and everything in it. The frame stays, without that paint, and the import report counts it. A rotated placeholder or blocked image now says its rotation was left out.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8) Thanks [@bromso](https://github.com/bromso)! - The import report counts instances resized from a component that lost its auto layout, whose content does not move with them.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6) Thanks [@bromso](https://github.com/bromso)! - Build repeated custom elements as components: mains go in a section beside the imported page and each occurrence becomes an instance, with its own text and images set as overrides. The report counts components and instances and says how many overrides failed. Cancelling removes the section, and your own components stay.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0) Thanks [@bromso](https://github.com/bromso)! - Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.

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
