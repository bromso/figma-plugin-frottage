# @repo/capture-schema

## 0.4.0

### Minor Changes

- [#10](https://github.com/bromso/figma-plugin-frottage/pull/10) [`7e6df47`](https://github.com/bromso/figma-plugin-frottage/commit/7e6df47c13adef56846d92167ff94c59ef95d0f9) Thanks [@bromso](https://github.com/bromso)! - Choose Light, Dark or both in the popup and in the plugin; Color Mode gets exactly those modes, with Dark read from the page's stylesheet.

## 0.3.0

### Minor Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`20de74e`](https://github.com/bromso/figma-plugin-frottage/commit/20de74e2c0454e629d91a10e6ad1b88dcb64f1e0) Thanks [@bromso](https://github.com/bromso)! - Captures each device by name, adds captures for breakpoints no device covers, and imports them as Device and Breakpoint collections with one frame per device in a section.

- [#7](https://github.com/bromso/figma-plugin-frottage/pull/7) [`e4f9148`](https://github.com/bromso/figma-plugin-frottage/commit/e4f9148143d5d990577eaebde9578da60ff2805a) Thanks [@bromso](https://github.com/bromso)! - Imports a page's theme as Primitives and Theme variable collections, with dark mode read from the stylesheet, and binds layers to the token the site used.
  
  A single-page import now creates two new collections, `<hostname> · Primitives` and `<hostname> · Theme`, beside any `<hostname>` collection an earlier import made. A page captured in dark mode opens in Dark, with Light still holding the light theme's values. With "Use existing local styles" on, repeated colours that no variable takes still link to your matching solid paint styles.

### Patch Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`a349d00`](https://github.com/bromso/figma-plugin-frottage/commit/a349d001179ed38d82ed1d61dbeb087f5fe35938) Thanks [@bromso](https://github.com/bromso)! - Binds corner radii to a Border radius collection named after the site's rounding classes (`radius/md`, `radius/2xl`, `radius/full`), and resolves `calc(var(--radius) * n)` refs.
  
  Counts a uniform border with no padding of its own as layout stroke, not raw spacing.
  
  Names Palette colors after Tailwind (`neutral/950`, `red/500`) when they exactly equal Tailwind's default color, instead of by family and step.
  
  Shows Breakpoint modes and each collection's variables smallest to largest (`base, sm, md, …`; `spacing/0_5, 1, 1_5, 2, …`). Under a file's mode limit, the modes the frames use are still the ones kept.
  
  Names mauve, olive, mist and taupe after Tailwind 4.3, and says "color" throughout the import report.
  
  Binds an image's rounded corners to the Border radius collection as it does a frame's, and counts the ones that stay plain as raw.
  
  A corner whose CSS uses the site's own light/dark token binds to that token rather than to the rounding class's name.

## 0.2.0

### Minor Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c) Thanks [@bromso](https://github.com/bromso)! - A `.frottage` file can hold several captures that share one asset folder, and files with a single `capture.json` still open.

## 0.1.0

No changes in this release.
