# Calendar on @daypicker/react 10

**Date:** 2026-10-30
**Status:** Approved (brainstorm with Jonas, 2026-10-30)
**Stream:** the last remaining major after PR #24. Stream 3 (structural cleanup) follows.

## Problem

`react-day-picker` 9.14.0 backs the shadcn Calendar component (`packages/ui/src/components/ui/calendar.tsx`) and its Storybook stories. Version 10.0.2 is current. Three facts shape the move:

- The maintainer renamed the package: `@daypicker/react` is the recommended v10 name. At 10.0.2 it is a thin wrapper (`export * from "react-day-picker"`) that depends on `react-day-picker@10.0.2`, so the old name stays in the lockfile as a transitive dependency.
- v10 removed the deprecated `classNames`/`styles` keys. The component still sets one of them, `table`, which is now `month_grid`. Everything else it uses (`button_previous`, `button_next`, `month_caption`, `dropdowns`, `dropdown_root`, `dropdown`, `caption_label`, `weekdays`, `weekday`, `week`, `week_number_header`, `week_number`, `day`, `range_start`, `range_middle`, `range_end`, `today`, `outside`, `disabled`, `hidden`, and the `Root`, `Chevron`, `DayButton`, `WeekNumber` component overrides) is current v10 API.
- v10 no longer needs `date-fns` as a peer or for locale imports (locales come from `@daypicker/react/locale`), although `react-day-picker@10.0.2` itself still depends on `date-fns ^4.1.0` and `@date-fns/tz`. Neither `packages/ui` nor `apps/storybook` imports `date-fns` directly; both declare it only because v9 required it, so the direct dependency goes while the transitive one remains.

## Decisions

| Question | Decision |
| --- | --- |
| Package name | `@daypicker/react` ^10.0.2. `react-day-picker` and `date-fns` are removed from `packages/ui` and `apps/storybook`. |
| Component changes | Minimal: the import lines move to `@daypicker/react`; `classNames.table` becomes `classNames.month_grid`. All UI3 styling (p-2, `--cell-size: --spacing(7)`, `--cell-radius`) stays. The Biome override for `calendar.tsx` stays. |
| shadcn registry | Not re-synced. The registry's newer dropdown-caption styling is a possible follow-up, not part of this change. |
| Changeset | One `patch` for `@repo/ui`: the Calendar now depends on `@daypicker/react` 10 and the package no longer pulls in `date-fns`. |

## Changes (one commit each)

1. **Dependency swap.** `packages/ui/package.json`: remove `"date-fns": "^4.4.0"` and `"react-day-picker": "^9.14.0"`, add `"@daypicker/react": "^10.0.2"` (alphabetical, among the scoped packages). `apps/storybook/package.json`: the same three edits. Controller runs `bun install` and confirms `bun.lock` has `@daypicker/react@10.0.2`, `react-day-picker@10.0.2` only as its dependency, and `date-fns` only as a transitive dependency (no workspace declares it).
2. **Component.** `calendar.tsx`: `import { type DayButton, DayPicker, getDefaultClassNames, type Locale } from "@daypicker/react";` and `month_grid: "w-full border-collapse",` in place of the `table` key. `Locale` is still exported (v10 defines `export type Locale = DayPickerLocale` in `classes/DateLib.d.ts`, re-exported from the package root), so the import keeps its shape. `bun run types`, `bun run test` and `bun run lint` pass.
3. **Changeset.** `.changeset/daypicker-10.md` with `"@repo/ui": patch` and the text "Calendar now uses @daypicker/react 10 (the renamed react-day-picker); date-fns is no longer a direct dependency of the UI package."

## Facts the changes rely on (verified 2026-10-30)

- npm (scratch install, 2026-10-30): `@daypicker/react@10.0.2` depends only on `react-day-picker@10.0.2` and re-exports it; `react-day-picker@10.0.2` depends on `date-fns ^4.1.0` and `@date-fns/tz ^1.4.1` (the jalali and hijri dependencies of 9.14.0 are gone) and peers `react >=16.8.0`, `@types/react >=16.8.0`. Its root exports include `DayPicker`, `getDefaultClassNames`, `DayButton`, `DayButtonProps`, `Locale` (= `DayPickerLocale`, which extends date-fns' `Locale`, so `locale.code` exists), `RootProps`, `WeekNumberProps` and the `UI` enum with `month_grid`.
- v10 upgrade guide (Context7, 2026-10-30): removed `classNames` keys include `table` → `month_grid`, `nav_button` → `button_previous`/`button_next`, `day_selected` → `selected`, `day_disabled` → `disabled`; `Chevron` receives `orientation`; `Root` receives `rootRef`; formatters return strings (`formatMonthDropdown(month, dateLib?) => string`); `captionLayout` keeps `label`, `dropdown`, `dropdown-months`, `dropdown-years`; locales import from `@daypicker/react/locale`, which re-exports `date-fns/locale`.
- The current component's only removed key is `table`; shadcn's own registry calendar (fetched 2026-10-30, still on the `react-day-picker` name) already uses `month_grid`.
- `apps/storybook/src/stories/Inputs/Calendar.stories.tsx` renders `mode="single"` with and without `showOutsideDays`; `Surfaces/Command.stories.tsx` also renders a Calendar. `packages/ui/src/components/ui/calendar.test.tsx` renders a month, asserts the caption "January 2025", gridcells and the two nav buttons.

## Verification

- After the component commit: `bun run types` (4 tasks), `bun run test` (133 tests), `bun run lint` (5 tasks), `bunx turbo run build-storybook --filter=@repo/storybook`.
- Storybook served locally and the `Inputs/Calendar` stories plus `Surfaces/Command` paged through in light and dark themes: month caption, weekday row, day grid, selected day, outside days, and the chevron buttons look as before.
- `bun outdated --filter '*'` lists no majors.
- `bun changeset status` lists `@repo/ui` (and `@repo/common` via the fixed group) for a patch.
- CI on the PR (clean Linux install) is the clean-room check.

## Out of scope

- Re-syncing the Calendar with shadcn's current registry version or restyling the dropdown caption.
- Any other component, Storybook story content, or stream 3 items.
