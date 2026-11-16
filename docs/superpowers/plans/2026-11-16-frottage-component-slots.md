# Component slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named components whose occurrences differ only below one auto-layout layer join as instances whose slot holds each occurrence's own layers.

**Architecture:** The mapper finds each variant's slot path while joining occurrences (`variants.ts`), plans a `slot` frame in the main and `slots` plus content ops on each instance (`components.ts`), and the applier makes the slot with `createSlot()` and fills each instance's slot by path (`applier.ts`).

**Tech Stack:** TypeScript, Bun test, Figma Plugin API (typings 1.142).

**Spec:** `docs/superpowers/specs/2026-11-16-frottage-component-slots-design.md`

## Global Constraints

- One slot per component; only under horizontal or vertical auto layout; none in a component whose main has an icon.
- Joins that work today stay exactly as they are, with the same overrides.
- Slot layer name: `Content`.
- The plugin makes no network requests; `networkAccess` stays `["none"]`.
- Before any push: the full local CI (lint, types, tests, e2e, plugin and extension builds, bundle check, Storybook, docs).

## Review Focus

- Two occurrences differing in two sibling subtrees: the slot is their common parent, not the first one only.
- A slot layer whose own padding or gap differs between occurrences: no join (own look differs).
- An occurrence identical to its main except text: joins as today with text overrides, no slot.
- Card on Laptop with CardContent slot content, Card on Phone: the Phone Card instance fills the nested CardContent slot.
- Hover patches under the slot layer keep pointing at the same layers after the inserted slot layer.

---

### Task 1: Plan op fields

**Files:** Modify `packages/figma-mapper/src/plan.ts`.

**Interfaces — Produces:** frame op `slot?: true` ("made with its component's `createSlot()`"); instance op `slots?: { path: number[]; id: string }[]`.

- [ ] Add both fields with doc comments; `bun run types` passes.

### Task 2: Finding a variant's slot

**Files:** Modify `packages/figma-mapper/src/variants.ts`, `packages/figma-mapper/src/components.ts` (`Component.slot?: number[]`). Test `packages/figma-mapper/src/__tests__/devices.test.ts` (or a new `slots.test.ts`).

**Interfaces — Produces:** `Component.slot` (child-index path from the main's root to the slot layer); every member's tree node at that path marked `slotted: true` on `Tree`.

- [ ] Failing tests: two coded `CardContent` occurrences on one device with different feature counts join one component with `slot: [ ]`-equivalent (instances, no "look different" line); an occurrence whose slot layer gap differs stays plain; one whose only difference is text joins with no slot.
- [ ] Implement `slotPath(a, b, looks)`: per the spec's rules; `partsOf` and the cross-device join in `buildSet` try it after the exact look fails; the variant's slot is the common prefix.
- [ ] Tests pass; existing mapper tests pass.

### Task 3: Planning slots

**Files:** Modify `packages/figma-mapper/src/components.ts`. Test as task 2.

**Interfaces — Consumes:** `Component.slot`, `Tree.slotted`. **Produces:** definitions with the inserted slot frame op (`id: <slot layer id>#slot`); instance ops with `slots` and their content ops right after them; `overridesOf` and `hoverOf` stop at a slotted layer; hover paths under it shift; a `Label` inside it is dropped.

- [ ] Failing tests: the main of a slotted CardContent has a `slot: true` frame op as the slot layer's only child, holding the first occurrence's children; an instance op has `slots: [{ path: [...slot, 0], id }]` and is followed by its own children ops parented to `id`; a Card holding CardContent: the Card instance's `slots` reaches the nested slot.
- [ ] Implement; tests pass.

### Task 4: Building slots in the plugin

**Files:** Modify `apps/design-plugin/src/plugin/applier.ts`, `apps/design-plugin/src/plugin/__tests__/fake-figma.ts`. Test `apps/design-plugin/src/plugin/__tests__/components.test.ts`.

- [ ] Fake: `createSlot()` on components (a `SLOT` node, a `SLOT` property named after it), instances copy it.
- [ ] Failing tests: a definition with a slot op makes a `SLOT` inside the right parent; an instance with `slots` is emptied and gets its content ops; a path to a non-slot counts one override failure.
- [ ] Implement in `createFrame` (slot op) and `buildInstance` (fill); tests pass.

### Task 5: Mainline check, docs, changeset

- [ ] Merge the three fresh Mainline captures (scratchpad): no content-only "look different" lines left; record counts in `docs/superpowers/specs/2026-11-16-frottage-component-slots-results.md`.
- [ ] If the Desktop Bridge is up, apply the Mainline plan in a scratch Figma file via the built applier and screenshot the pricing cards; otherwise leave the real-Figma check to the owner.
- [ ] `apps/docs/content/docs/index.mdx`: components paragraph mentions slots; changeset (minor for figma-mapper and design-plugin).
- [ ] Full local CI, branch `feat/frottage-component-slots`, PR.
