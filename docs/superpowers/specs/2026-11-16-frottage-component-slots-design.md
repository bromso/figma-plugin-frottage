# Frottage components stage 2: slots

Date: 2026-11-16. The owner handed every decision in this design to Claude ("you can make the decisions"); each one marked **Call** is Claude's, for the owner to check.

## Why

On Mainline, a named component (code or shadcn marker) whose occurrences differ only in their content stays plain layers: the report says "7 card contents look different from their CardContent component", and the same for cards, accordions, collapsibles and collapsible triggers. A pricing card's Free, Startup and Enterprise versions are one component in the code; they differ in what they hold (a subtitle line or a "Billed annually" row, three to six features). In Figma that is one component with a **slot**: a place in the component each instance fills with its own layers.

## What Figma allows (measured 2026-11-16, Figma desktop, plugin typings 1.142)

- `ComponentNode.createSlot()` makes a `SLOT` node in the component and a `SLOT` component property named after the slot layer ("Content").
- The slot can be moved into a nested frame of the component, has auto layout, and can fill its parent's width and hug its height.
- In an instance, and in an instance nested in another component's instance, the slot is reachable by child-index path. Its children can be removed and any layers appended, text and instances included; the main keeps its default content, and the instance hugs its new content.
- Variants combined into a set keep their slot property.
- `setProperties` cannot set a slot (`Slot component property values cannot be edited`); filling it is done by editing its children.

## Goals

1. A named component's occurrences that match its variant except below one layer join it as instances, with that layer's content in a slot.
2. Slots work inside nested components (Card holds CardContent, whose content varies), so the outer component joins too.
3. The import looks as before: every instance shows its occurrence's own layers.
4. The report counts fewer "look different" occurrences; occurrences that still don't match stay plain, as now.

## Non-goals

- Slots for structural (unnamed) components found by repetition.
- More than one slot per component (**Call**: one slot, at the shallowest place every difference sits under; two separate differences share one slot at their common parent).
- Preferred values, min/max children or any other slot settings.
- Slots in a component with an icon (Button). Buttons keep today's `Show icon`/`Icon` properties.

## Anti-goals

- An instance that looks different from its occurrence.
- A slot that swallows the whole component when a smaller one would do.
- Breaking today's joins: an occurrence that joined before joins the same way, with the same overrides.

## Design

### Where the slot goes (mapper, `variants.ts`)

Two occurrences of one variant are compared top-down, beside each other:

- Each layer's own look (the same fields `innerLook` compares, with the same size rules) and its placement in its parent must be equal; otherwise there is no slot match.
- A nested named component compares by its set, as now, so a difference inside it is that component's slot, not this one's.
- At a layer whose children differ: if the child counts differ, or two or more children differ, or the one differing child's own look differs, **the slot is this layer**. If exactly one child differs and its own look is equal, the search goes into that child.
- The slot layer must be a frame with horizontal or vertical auto layout (**Call**: grid and absolute layouts get no slot; the occurrence stays plain).

A variant's slot path is the longest common prefix of the slot paths of every occurrence that needed one. Its main is unchanged above the slot. **Call**: components whose main has an icon get no slot.

Joining order is unchanged: exact matches first, as today; then, per variant, occurrences that only match with a slot (within one device, then across devices). Inner names come first, as now, so once CardContent has joined, Card's occurrences compare by CardContent's set and match exactly.

### How it is planned (`components.ts`, `plan.ts`)

- The slot layer stays; a new frame op with `slot: true` is inserted as its only child, named "Content". It takes the slot layer's auto layout (direction, gap, alignment, wrap) with no padding; the slot layer keeps its padding and fills. Per axis the slot fills the layer, or hugs where the layer hugs. The layer's former children become the slot's children in the main, shifted by the layer's padding. (**Call**: an extra layer, not the layer itself as the slot, so a component's root can hold a slot and paths above it are unchanged.)
- Paths below the slot layer gain a `0` for the slot layer: hover patches shift; a `Label` text property inside the slot is dropped (the text is content).
- An instance op gets `slots: { path, id }[]`: each slot in its expanded tree, its own and those of nested instances, by child-index path, and the id its content ops use as their parent. Overrides stop at a slot layer; nothing inside it is an override.
- After an instance op come its slots' content ops: the occurrence's own layers under each slot layer, flattened as any page layers are (a nested named component is an instance), shifted by the slot layer's padding.
- **Call**: every instance gets its slot filled with its own layers except the occurrence its main was made from, which shows the default content. This keeps what each device showed (text wraps differently per width) at the cost of slot content no longer following the main.

### How it is built (`applier.ts`)

- A frame op with `slot: true` is made with the enclosing component's `createSlot()`, moved into its parent, then set up as any frame (layout, sizing, fills).
- After an instance's properties and overrides, each `slots` entry finds its node by path; a `SLOT` node is emptied and registered under the entry's `id`, so content ops land in it. A path that does not lead to a slot counts as an override failure, and the content ops then fail as ops with a missing parent do today.
- Layout verification: a slot layer and its content are verified as any frames; an instance stays a leaf for its parent.

### Report

The "look different" counts only what still doesn't join. **Call**: no new report line; slots show in Figma's own component properties.

## Done when

- Mapper tests: two cards whose content differs join with a slot; a nested CardContent's slot is filled through an outer Card instance; a difference in a slot layer's own look still doesn't join; an icon component never gets a slot; existing tests pass unchanged.
- Plugin tests against the fake: a slot op makes a `SLOT` in its component; an instance's slot is emptied and filled; a bad path counts as a failure.
- A fresh three-device capture of Mainline merges with no "look different" lines for cards, card contents, accordions, collapsibles or collapsible triggers that differ only in content.
- Real Figma: an import of Mainline shows the pricing cards as Card instances with filled slots, looking as before. (Needs the owner, or the Desktop Bridge with the built plugin.)
