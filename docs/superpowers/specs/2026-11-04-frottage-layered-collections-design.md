# Frottage layered collections: design

Date: 2026-11-04. Status: approved by the owner on 2026-11-04. Revises the "Variables and theme" part of `2026-11-03-frottage-intent-design.md`, as built in PR #7 (merged).

## Intent

Captured variables are split by kind into separate collections, with switching collections in the middle and one final collection that layers bind to. Each collection is an independent control for the designer: switch Color Mode on a frame and colours change, later switch Breakpoint and type and sizes change, edit one palette entry and everything above it follows.

The owner built the reference by hand in Figma file `4YBhzQNO5eFDSPXRlRDokT` on 2026-11-04 and asked for it as a **concept**, not a literal copy: the layering is binding, the contents come from the site.

## Decided by the owner

- The layered structure: raw-value collections → switching collections with modes → one final Theme collection that layers bind to.
- Fidelity stands: collections hold what the site defines, not a framework's full palette or default values.
- Iterate from PR #7.

## The structure

| Layer | Collection | Modes | Holds |
|---|---|---|---|
| Raw | **Palette** | one (`Base`) | the site's colours: its named colour properties (`--color-gray-200` → `gray/200`) and every theme colour value that matches none, named by family and step |
| Raw | **Spacing** | `Base` | the site's spacing scale (`spacing/4` = 16, `spacing/spacing` = the base unit) |
| Raw | **Border radius** | `Base` | `radius/sm`, `radius/md`, `radius/lg`… as the site's CSS computes them |
| Raw | **Typography** | `Base` | type sizes, line heights, tracking, families and weights the site names (`text/sm/size`…) |
| Switch | **Color Mode** | `Light`, `Dark`, and any other stylesheet theme | semantic colours (`color/background`, `color/card-foreground`…); every value is an alias into Palette |
| Final | **Theme** | one (`Default`) | one token per value layers use; each aliases the collection below it, described `Final theme token; source: <collection>` |

Breakpoint and Orientation are switching collections too, and arrive with the responsive stage, which plugs into the same structure: Breakpoint aliases into per-width raw values, Theme's type tokens then alias Breakpoint.

## Rules

- **Layers bind only to Theme.** Text styles bind their type fields to Theme too.
- **Semantic colour → palette:** a Color Mode value aliases the palette colour the CSS names (`var(--color-x)`); otherwise the palette colour with exactly the same value from this site; otherwise a new palette entry (family/step name) holding that value. So every semantic colour points into Palette, in every mode. This replaces PR #7's rule that equal values never alias: aliasing to the site's own value is faithful.
- **Fidelity:** no colour, step or value the site doesn't define. A Tailwind site gets the palette entries its stylesheet contains, not all 245.
- **Names:** collection names as in the reference (`Palette`, `Spacing`, `Border radius`, `Typography`, `Color Mode`, `Theme`). Variable names group by kind (`color/`, `spacing/`, `radius/`, `text/`) followed by the site's own name with the framework prefix removed.
- **Reuse:** collections are found again by Frottage's plugin-data tag for the hostname, never by name; a user's collection with the same name is left alone (Frottage's gets ` (Frottage)`). Equal variables are reused, changed ones get `name (2)`, as now.
- **Opening mode:** the page frame opens in the captured Color Mode, as now.
- **Plan limits:** a Color Mode past the file's mode limit is dropped and reported, as now.

## Scope

**In:** single-page imports move from PR #7's two collections (`· Primitives`, `· Theme`) to the six above; the mapper's plan describes collections generically (name, modes, variables) so later stages add Breakpoint and Orientation without another restructure; report lines updated.

**Out:** Breakpoint and Orientation (responsive stage); multi-width version sets (still the Stage 3 single collection until the responsive stage); components.

## Calls made by the author (owner may override)

- Collection names have no hostname prefix, matching the reference. A second site imported into the same file gets its collections suffixed with its hostname (`Palette (example.com)`).
- Files already holding PR #7's `· Primitives` / `· Theme` are not migrated: a new import creates the new set beside them, and the report says so once.
- Spacing and radius tokens in Theme mirror every raw value the site's layers use; unused raw values stay in the raw collections without a Theme token.
- Shadows and gradients stay effect and paint styles, with colours bound to Theme.
- Light is the default mode of Color Mode; Theme has one mode named `Default`.

## Left to the builder

The generic collection shape in the plan, how the sandbox walks the alias chain to create collections bottom-up, and task breakdown.

## Unverified

- Creating alias chains three levels deep (Theme → Color Mode → Palette) from a plugin, and their per-frame mode resolution: the owner's reference file uses such chains, but the plugin has only been measured creating two-level ones.
- How Figma's variable picker presents six collections from one import.
