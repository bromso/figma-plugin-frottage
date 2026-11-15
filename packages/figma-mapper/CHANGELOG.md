# @repo/figma-mapper

## 0.6.3

### Patch Changes

- A named component whose picture sits in a fixed box, such as a carousel item whose picture box is smaller on Tablet or Phone, is now an instance of the same component with the box and picture resized, instead of staying a plain frame counted as looking different. Only a size that neither hugs its content nor fills its parent is resized.
- Updated dependencies []:
  - @repo/capture-schema@0.6.3

## 0.6.2

### Patch Changes

- [#22](https://github.com/bromso/figma-plugin-frottage/pull/22) [`e0cf63c`](https://github.com/bromso/figma-plugin-frottage/commit/e0cf63c7ca68b98692b9600acbf6b15b33253694) Thanks [@bromso](https://github.com/bromso)! - A named component whose picture, icon or empty box has another fixed size, such as a card's picture on Tablet or Phone, is now an instance of the same component with that layer resized, instead of staying a plain frame counted as looking different.
- Updated dependencies []:
  - @repo/capture-schema@0.6.2

## 0.6.1

### Patch Changes

- [#20](https://github.com/bromso/figma-plugin-frottage/pull/20) [`1d83ffe`](https://github.com/bromso/figma-plugin-frottage/commit/1d83ffea1d3e277935424e6ec7534275f0225b8d) Thanks [@bromso](https://github.com/bromso)! - Gradients now switch with Color Mode: every gradient's stops bind to theme colors, a theme color at partial strength binds to a translucent version of it, and a page captured in Light no longer pins its Section to Light, so switching the page to Dark switches it.

- [#18](https://github.com/bromso/figma-plugin-frottage/pull/18) [`fb65578`](https://github.com/bromso/figma-plugin-frottage/commit/fb65578bf2002fdb566d79014b163b637f827da6) Thanks [@bromso](https://github.com/bromso)! - Components nested inside another component's instance now follow their device frame's modes, and a component set's Label shows the component's name instead of the first label found.
- Updated dependencies []:
  - @repo/capture-schema@0.6.1

## 0.6.0

### Minor Changes

- [#16](https://github.com/bromso/figma-plugin-frottage/pull/16) [`36ab8e8`](https://github.com/bromso/figma-plugin-frottage/commit/36ab8e81170f806d07a4ac7b2c5e2824c751f4f3) Thanks [@bromso](https://github.com/bromso)! - Imports components the page's code or shadcn markers name as Figma component sets with variant, text and icon properties.

### Patch Changes

- Updated dependencies [[`36ab8e8`](https://github.com/bromso/figma-plugin-frottage/commit/36ab8e81170f806d07a4ac7b2c5e2824c751f4f3)]:
  - @repo/capture-schema@0.6.0

## 0.5.0

### Minor Changes

- [#12](https://github.com/bromso/figma-plugin-frottage/pull/12) [`e40688e`](https://github.com/bromso/figma-plugin-frottage/commit/e40688e92f1b3560d015015332789c660b41ccfc) Thanks [@bromso](https://github.com/bromso)! - Languages always become modes of the Language collection; the popup finds more languages, names them simply and lists breakpoints as rows; breakpoints a pixel apart count as one.

- [#11](https://github.com/bromso/figma-plugin-frottage/pull/11) [`fd2f488`](https://github.com/bromso/figma-plugin-frottage/commit/fd2f48821b9975241a714a01862bc48104eba92c) Thanks [@bromso](https://github.com/bromso)! - Finds a page's languages, captures the ones you tick, and pairs their texts into a Language collection so switching its mode swaps the text.

### Patch Changes

- Updated dependencies [[`fd2f488`](https://github.com/bromso/figma-plugin-frottage/commit/fd2f48821b9975241a714a01862bc48104eba92c)]:
  - @repo/capture-schema@0.5.0

## 0.4.0

### Minor Changes

- [#10](https://github.com/bromso/figma-plugin-frottage/pull/10) [`7e6df47`](https://github.com/bromso/figma-plugin-frottage/commit/7e6df47c13adef56846d92167ff94c59ef95d0f9) Thanks [@bromso](https://github.com/bromso)! - Choose Light, Dark or both in the popup and in the plugin; Color Mode gets exactly those modes, with Dark read from the page's stylesheet.

### Patch Changes

- Updated dependencies [[`7e6df47`](https://github.com/bromso/figma-plugin-frottage/commit/7e6df47c13adef56846d92167ff94c59ef95d0f9)]:
  - @repo/capture-schema@0.4.0

## 0.3.0

### Minor Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`20de74e`](https://github.com/bromso/figma-plugin-frottage/commit/20de74e2c0454e629d91a10e6ad1b88dcb64f1e0) Thanks [@bromso](https://github.com/bromso)! - Captures each device by name, adds captures for breakpoints no device covers, and imports them as Device and Breakpoint collections with one frame per device in a section.

- [#7](https://github.com/bromso/figma-plugin-frottage/pull/7) [`e4f9148`](https://github.com/bromso/figma-plugin-frottage/commit/e4f9148143d5d990577eaebde9578da60ff2805a) Thanks [@bromso](https://github.com/bromso)! - Imports a page's theme as Primitives and Theme variable collections, with dark mode read from the stylesheet, and binds layers to the token the site used.
  
  A single-page import now creates two new collections, `<hostname> · Primitives` and `<hostname> · Theme`, beside any `<hostname>` collection an earlier import made. A page captured in dark mode opens in Dark, with Light still holding the light theme's values. With "Use existing local styles" on, repeated colours that no variable takes still link to your matching solid paint styles.

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`ed1ef1e`](https://github.com/bromso/figma-plugin-frottage/commit/ed1ef1e98245a17d3529e96ac7a8238d8225d98a) Thanks [@bromso](https://github.com/bromso)! - Imports a page's variables as layered collections — Palette, Spacing, Border radius, Typography, Color Mode and a final Theme — so layers bind to Theme and Color Mode switches the page between themes.

### Patch Changes

- [#9](https://github.com/bromso/figma-plugin-frottage/pull/9) [`a349d00`](https://github.com/bromso/figma-plugin-frottage/commit/a349d001179ed38d82ed1d61dbeb087f5fe35938) Thanks [@bromso](https://github.com/bromso)! - Binds corner radii to a Border radius collection named after the site's rounding classes (`radius/md`, `radius/2xl`, `radius/full`), and resolves `calc(var(--radius) * n)` refs.
  
  Counts a uniform border with no padding of its own as layout stroke, not raw spacing.
  
  Names Palette colors after Tailwind (`neutral/950`, `red/500`) when they exactly equal Tailwind's default color, instead of by family and step.
  
  Shows Breakpoint modes and each collection's variables smallest to largest (`base, sm, md, …`; `spacing/0_5, 1, 1_5, 2, …`). Under a file's mode limit, the modes the frames use are still the ones kept.
  
  Names mauve, olive, mist and taupe after Tailwind 4.3, and says "color" throughout the import report.
  
  Binds an image's rounded corners to the Border radius collection as it does a frame's, and counts the ones that stay plain as raw.
  
  A corner whose CSS uses the site's own light/dark token binds to that token rather than to the rounding class's name.
- Updated dependencies [[`20de74e`](https://github.com/bromso/figma-plugin-frottage/commit/20de74e2c0454e629d91a10e6ad1b88dcb64f1e0), [`a349d00`](https://github.com/bromso/figma-plugin-frottage/commit/a349d001179ed38d82ed1d61dbeb087f5fe35938), [`e4f9148`](https://github.com/bromso/figma-plugin-frottage/commit/e4f9148143d5d990577eaebde9578da60ff2805a)]:
  - @repo/capture-schema@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c)]:
  - @repo/capture-schema@0.2.0

## 0.1.0

### Minor Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6) Thanks [@bromso](https://github.com/bromso)! - Build repeated custom elements as components: mains go in a section beside the imported page and each occurrence becomes an instance, with its own text and images set as overrides. The report counts components and instances and says how many overrides failed. Cancelling removes the section, and your own components stay.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0) Thanks [@bromso](https://github.com/bromso)! - Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.

### Patch Changes

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - The import report counts text blocks that came out a different size. A role, tag or font style named like `constructor` can no longer break a layer name, text alignment or font matching.

- [#1](https://github.com/bromso/figma-plugin-frottage/pull/1) [`4842e6a`](https://github.com/bromso/figma-plugin-frottage/commit/4842e6a669d0a98c08c8ce058cb6bd5f5e8d9519) Thanks [@bromso](https://github.com/bromso)! - Keep imported text on the lines it had in the browser. Single-line text such as button labels never wraps, and wrapped text is widened by up to 8% when Figma's Inter runs wider than the browser's. The import report counts text blocks that still wrap differently.
- Updated dependencies []:
  - @repo/capture-schema@0.1.0
