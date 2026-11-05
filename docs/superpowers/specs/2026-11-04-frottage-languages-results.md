# Frottage languages: results

Plan: `docs/superpowers/plans/2026-11-04-frottage-languages.md`, Task 9.

## Step 1 (agent, real Chromium), 2026-11-05

Setup: the built extension (`apps/chrome-extension/dist`) in Playwright's Chromium, the popup opened with `Extensions.triggerAction`, on a local site with `/en/` and `/sv/` pages linked by `hreflang`. Svenska ticked, Capture pressed.

| Case | Popup | File | Tab at the end |
|---|---|---|---|
| `/sv/` is Swedish | `Capture 6 sizes`, `6 captures: 3 devices × 2 languages` | 6 captures: Laptop, Tablet portrait, Phone portrait in English, then in Svenska; each records `language` with `base` = `/en/` | `/en/` |
| `/sv/` redirects to `/en/` | same | 3 English captures; Svenska left out | `/en/` |
| `/sv/` serves an English page (`lang="en"`) | same | 3 English captures; Svenska left out | `/en/` |

The first file, run through the plugin's grouping and the mapper (`groupVersions` → `mapCapture` → `mergeDevices`), with components off and on: one page set of 6 captures; Language modes `English`, `Svenska`; 3 string variables (`Main/Heading` Hello/Hej, `Navigation/Pricing` Pricing/Priser, `Main/Learn more about our product`); 9 text layers bound across the 3 device frames; no report lines.

Platform measurements that shaped the design (2026-11-04): `activeTab` survives the same tab moving to a same-origin URL and back; it is lost on another origin and stays lost after returning; a new tab never has it.

Not checked here: the permission prompt for a language on another site (headless Chromium can't answer it), and anything in real Figma.

## Step 2 (owner): pending

## Step 3 (agent, Desktop Bridge): pending
