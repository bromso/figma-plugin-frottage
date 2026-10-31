# Frottage Phase 0 findings

Date: 2026-10-31. Raw evidence: `spikes/RESULTS.md` on `chore/frottage-phase-0-spikes`, which is never merged.

## Gate decision

html.to.design was measured on the free plan with URL import on three public pages, using auto layout, styles and variables, hover components and HTML layer names.

| Page | Auto layout | Text with style | Solid fills bound or styled | Human-readable names |
|---|---|---|---|---|
| `bun.com` | 78.0% | 249 of 249 | 93.9% | 5.6% |
| `react.dev/learn` | 81.6% | 623 of 629 | 99.3% | 0% |
| Wikipedia article | 52.5% | 107 of 177 | 98.3% | 8.8% |

It meets the auto layout, text and token targets on real flex pages. It misses meaningful names, and it creates clutter: 257 text styles, 27 repeated style names, and 811 variables across the three pages. Each import took about 30 to 40 s. Figma's own capture and html.to.design's extension route were not measured, and the local fixtures were not imported.

**Owner decision: build a smaller Frottage, free, open source, with no network access.**

## Unverified items

| # | Question | Result | Evidence |
|---|---|---|---|
| 1 | Plugin iframe reads a chosen file; OS drops reach it | **Pass, desktop** | Picker read 104,857,600 bytes in 60.5 ms; drop read 356,098 bytes in 3.7 ms |
| 2 | Auto layout reads back synchronously | **Pass, desktop** | Hug width 165 to 229 with no yield, identical after a yield |
| 3 | Networker carries `Uint8Array` | **Pass, desktop** | 20 MB intact, 41.6 ms against 27.2 ms raw, ratio 1.53 |
| 4 | Time and stability at 5,000 and 20,000 nodes | **Partial** | 5,000 nodes: about 50 s, slowest batch 3.4 s at batch 200, 0.87 s at batch 50. Images and 20,000 nodes not run |
| 5 | One-step undo; annotations on all plans | **Partial** | One Cmd+Z removed 300 nodes with the plugin open. Annotations work, plan not established |
| 6 | `activeTab` survives worker sleep | **Pass** | Second injection, `tabs.get` URL and download succeeded with worker uptime 0.0 s at wake |
| 7 | Geometry in device emulation | **Pass** | Rects correct at 390 px through DevTools protocol emulation; `innerWidth` read 643, `clientWidth` 390 |
| 8 | Message size limits | **Pass** | `sendMessage` and ports intact at 60 MiB, refused at 64 MiB; `executeScript` return intact at 128 MiB |

Navigation during capture reported an error instead of hanging. A real page went from capture to editable Figma layers.

## Design changes

- Batches are about 50 nodes, not 200.
- Auto layout is set as each frame is created. Applying it afterwards, deepest first, did not finish in 280 s, against about 50 s in order.
- Batch time grows with nodes created, from 71 ms at node 0 to 686 ms at node 4,000 at batch 50. So 20,000 nodes is likely to take many minutes. The working cap stays unproven until measured.
- Messages between page and extension must stay under 60 MiB, so a capture is sent in chunks.
- The capture viewport reads `clientWidth`, not `innerWidth`.
- The walker needs text alignment, font weight, borders and radii from Phase 1.

## Still open

- **Browser Figma is untested.** Everything Figma-side ran in the desktop app only. A pass in one environment does not meet the plan's rule. Development plugins are expected to need the desktop app, so this waits until Frottage can be installed as a private plugin in Phase 1. Treat it as the first Phase 1 check.
- The 200-image benchmark and the 20,000-node run.
- Undo after the plugin has closed.
- Annotations on a confirmed free plan.
- Exact Chrome install warning text, including whether `downloads` shows "Manage your downloads".
- The 3% pixel target has not been measured for Frottage.
