# @repo/ui

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
