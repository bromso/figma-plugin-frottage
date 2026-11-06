# Frottage languages as modes: results

Plan: `docs/superpowers/plans/2026-11-05-frottage-languages-as-modes.md`, Task 7.

## Step 1 (agent, real Chromium), 2026-11-05

The built extension in Playwright's Chromium, the popup opened with `Extensions.triggerAction`, default devices (Laptop, Tablet portrait, Phone portrait).

**Popup**

| Site | Languages | Breakpoint rows |
|---|---|---|
| riksbank.se/sv/ | Svenska (ticked, own), English | base 366 · min 367 covered by Phone portrait · min 580 · min 599 · md covered by Tablet portrait · lg 1024 · min 1140 · xl 1280 · min 1440 covered by Laptop |
| kth.se | Svenska (ticked, own), English | base covered by Phone portrait · min 576 · min 661 · md covered by Tablet portrait · min 992 · lg 1024 · min 1200 · min 1258 · min 1400 covered by Laptop |
| su.se | Svenska (ticked, own), English | min 481 · min 578 · min 581 · min 600 · md covered by Tablet portrait · min 1000 · min 1200 covered by Laptop |

Before this branch Riksbank showed no languages, KTH named them `Svenska (Sverige)` and `British English`, and su.se had `min 999`, `min 1000` and `min 1001`.

**Import** (captures with English ticked, run through the plugin UI's `runImports` with a fake sandbox):

| Site | Language modes | Language variables | Frames | Sections | Low-match lines |
|---|---|---|---|---|---|
| kth.se | Svenska / English | 59 | 3 | 1 | `Only 49% of the Svenska page matches English on Laptop.` (47% Tablet portrait, 47% Phone portrait) |
| riksbank.se/sv/ | Svenska / English | 84 | 3 | 1 | none |
| su.se (captured before the breakpoint merge) | Svenska / English | 123 | 3 | 1 | none |

Before this branch the owner's KTH import made a separate `… — British English` Section and no Language collection.

The full gate (lint, forced types, all tests, capture-dom e2e, plugin, extension and docs builds, bundle check) exited 0 at `6a90d48`.

## Step 2 (owner): pending

Capture kth.se with English ticked, import, and switch the Section's Language mode: the header and menus should swap, the news should stay Swedish.

## Step 3 (agent, Desktop Bridge): pending
