# @repo/ui

## 2.1.0

### Minor Changes

- [#5](https://github.com/bromso/figma-plugin-frottage/pull/5) [`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6) Thanks [@bromso](https://github.com/bromso)! - Import a set of versions as one: files of one page land side by side as `<page> — <label>`, each frame on its own mode of one shared variable collection, with its component section below it. One undo removes the whole set and Cancel takes it all back. A version that fails is named and the others stay. The report lists the modes, and says how many frames kept plain values when Figma has too few modes. In a set, uses count across its versions, so a heading set once at each of three widths becomes a text style that varies by mode. Adding a width to a set that's already in the file reuses its variables and styles and adds only a mode. Cancel in a later set keeps the sets already done and reports them.

### Patch Changes

- Updated dependencies [[`d7e51c9`](https://github.com/bromso/figma-plugin-frottage/commit/d7e51c983e326a062ba0878f53f50c12254a508c), [`1bf5a22`](https://github.com/bromso/figma-plugin-frottage/commit/1bf5a221705c9fdb8fa1d855907beb411a94cfd6)]:
  - @repo/capture-schema@0.2.0
  - @repo/common@2.1.0
  - @repo/figma-mapper@0.2.0

## 2.0.1

### Patch Changes

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4) Thanks [@bromso](https://github.com/bromso)! - A fill or effect Figma refuses, such as an enormous blur, no longer loses the frame and everything in it. The frame stays, without that paint, and the import report counts it. A rotated placeholder or blocked image now says its rotation was left out.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8) Thanks [@bromso](https://github.com/bromso)! - The import report counts instances resized from a component that lost its auto layout, whose content does not move with them.

- [#4](https://github.com/bromso/figma-plugin-frottage/pull/4) [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6) Thanks [@bromso](https://github.com/bromso)! - Build repeated custom elements as components: mains go in a section beside the imported page and each occurrence becomes an instance, with its own text and images set as overrides. The report counts components and instances and says how many overrides failed. Cancelling removes the section, and your own components stay.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75) Thanks [@bromso](https://github.com/bromso)! - The import report counts text blocks that came out a different size. A role, tag or font style named like `constructor` can no longer break a layer name, text alignment or font matching.

- [#3](https://github.com/bromso/figma-plugin-frottage/pull/3) [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0) Thanks [@bromso](https://github.com/bromso)! - Turn values a page repeats into text styles and colour variables. Variables go in a collection named after the hostname and take their names from matching CSS custom properties. Repeat imports reuse what is already there, and exact matches bind to your own styles and variables without changing them. Cancelling removes only the tokens that import created, and leaves any still in use on the current page.
- Updated dependencies [[`3a5e949`](https://github.com/bromso/figma-plugin-frottage/commit/3a5e949d9be472d00475d7214ac3b541ab74d6a4), [`37c78e7`](https://github.com/bromso/figma-plugin-frottage/commit/37c78e7b805eb38729b0102c9bbbfbd10491ccd8), [`71c3748`](https://github.com/bromso/figma-plugin-frottage/commit/71c374865cd9383227242386a4ac3a05f16f06c6), [`8923e32`](https://github.com/bromso/figma-plugin-frottage/commit/8923e32f9c314dc48c8d2c6e6a83bb5d450dde75), [`4842e6a`](https://github.com/bromso/figma-plugin-frottage/commit/4842e6a669d0a98c08c8ce058cb6bd5f5e8d9519), [`68d0a79`](https://github.com/bromso/figma-plugin-frottage/commit/68d0a7980d1f2318f5dcd0793a891c4ba17088a0)]:
  - @repo/common@2.0.1
  - @repo/figma-mapper@0.1.0
  - @repo/capture-schema@0.1.0

## 2.0.0

### Major Changes

- [#27](https://github.com/bromso/figma-plugin-template/pull/27) [`b2f550b`](https://github.com/bromso/figma-plugin-template/commit/b2f550b4987911fe8226eb6e3c892037422cff9b) Thanks [@bromso](https://github.com/bromso)! - Remove the unused Sidebar component and useIsMobile hook; Sonner now follows Figma's theme through the new useFigmaTheme() hook instead of next-themes; Type uses the UI3 type scale (9/11/13/15 px) so its default size is 11 px like every other control.

### Patch Changes

- [#29](https://github.com/bromso/figma-plugin-template/pull/29) [`bcbe010`](https://github.com/bromso/figma-plugin-template/commit/bcbe01031e7e654382ca77013ee3e1b97e9830ac) Thanks [@bromso](https://github.com/bromso)! - Calendar: the week-number cell no longer spreads the `week` object onto the `<td>`, which rendered a stray `week="[object Object]"` attribute when `showWeekNumber` was set.
- Updated dependencies []:
  - @repo/common@2.0.0

## 1.4.2

### Patch Changes

- [#25](https://github.com/bromso/figma-plugin-template/pull/25) [`060a836`](https://github.com/bromso/figma-plugin-template/commit/060a836552d78b7b23dd6ae39c350df3c4b6d005) Thanks [@bromso](https://github.com/bromso)! - Calendar now uses @daypicker/react 10 (the renamed react-day-picker); date-fns is no longer a direct dependency of the UI package.
- Updated dependencies []:
  - @repo/common@1.4.2

## 1.4.1

### Patch Changes

- [#21](https://github.com/bromso/figma-plugin-template/pull/21) [`18bd1f8`](https://github.com/bromso/figma-plugin-template/commit/18bd1f8f8a9d2834f18d09f46edcfdb95259d82d) Thanks [@bromso](https://github.com/bromso)! - Refresh dependencies: React 19.3, radix-ui 1.8, lucide-react 1.65, recharts 3.10, tailwind-merge 3.7 and other minors. No API changes; icon glyphs may differ slightly with the newer Lucide set.
- Updated dependencies []:
  - @repo/common@1.4.1

## 1.4.0

### Minor Changes

- [#16](https://github.com/bromso/figma-plugin-template/pull/16) [`22e5c70`](https://github.com/bromso/figma-plugin-template/commit/22e5c704ba8cd739faeb384c9dc963c4ecd60fe1) Thanks [@bromso](https://github.com/bromso)! - Replace Vite and Vitest with Bun's bundler and test runner. The plugin is built by a single `build.ts` (standalone HTML output, Tailwind, React Compiler); tests run under `bun test` with happy-dom. Storybook keeps Vite. Requires Bun 1.4.2+. The manifest now sets `documentAccess: "dynamic-page"` and `networkAccess`, and the plugin UI finally receives Figma's theme class (`themeColors: true`) so dark mode can apply.

- [#17](https://github.com/bromso/figma-plugin-template/pull/17) [`040d446`](https://github.com/bromso/figma-plugin-template/commit/040d44683325b8b8b772482cb5a4282086a5598d) Thanks [@bromso](https://github.com/bromso)! - Align the component library with Figma's UI3 design system. Tokens now bind to the `--figma-color-*` variables Figma injects (with kit fallbacks), the global scale is 24 px controls / 11 px Inter 450 / 5 px radius, and sixteen components match the UI3 kit: Button, Input, Textarea, Checkbox, RadioGroup, Switch, Select, Tabs, Badge, Tooltip, DropdownMenu, ContextMenu, Menubar, Command, Dialog, AlertDialog. Menus are dark in both themes like Figma's. Storybook gains a theme toggle and `UI3/*` parity stories. The plugin window defaults to 320 × 480. Badge `default` is now the neutral outlined kit style (it was a filled brand pill); `secondary` is the selected tint with brand text; `ghost` is the filled secondary. Button `secondary` is now a translucent-border button instead of a filled grey one, `SectionTitle` is a sentence-case 32 px header, and the global scale changes (`text-xs` 9 px, `text-base` 11 px, `rounded-lg` 5 px, Lucide stroke 1.5) affect consumer markup too. `@repo/common` bumps alongside because the packages are versioned together.

### Patch Changes

- [#6](https://github.com/bromso/figma-plugin-template/pull/6) [`0369460`](https://github.com/bromso/figma-plugin-template/commit/03694601a10dae8ca663abfac67da41d9bcdb977) Thanks [@bromso](https://github.com/bromso)! - inital automatic release

- Updated dependencies [[`22e5c70`](https://github.com/bromso/figma-plugin-template/commit/22e5c704ba8cd739faeb384c9dc963c4ecd60fe1), [`0369460`](https://github.com/bromso/figma-plugin-template/commit/03694601a10dae8ca663abfac67da41d9bcdb977)]:
  - @repo/common@1.4.0
