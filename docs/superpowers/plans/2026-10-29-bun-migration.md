# Bun Build and Test Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vite and Vitest in `apps/design-plugin`, `packages/ui` and `packages/common` with Bun's bundler and test runner, per `docs/superpowers/specs/2026-10-29-bun-migration-design.md`.

**Architecture:** One `build.ts` script calls `Bun.build` twice (standalone HTML for the UI, IIFE for the plugin sandbox) and writes `manifest.json`. Tests run under `bun test` with happy-dom and Testing Library loaded from two ordered preload files. Storybook keeps Vite inside `apps/storybook`; the Next docs app is untouched.

**Tech Stack:** Bun 1.4.2 (bundler, test runner), `bun-plugin-tailwind`, Tailwind CSS 4, `@happy-dom/global-registrator`, Testing Library, Turborepo, Biome.

**Spike gate:** Tasks 2–4 are the spike. Task 3 is a manual check in Figma desktop. If Task 3 criterion 1 or 2 cannot be made to pass by changing only `build.ts`, `figma.manifest.ts` or tsconfig, STOP: do not continue to Task 5, report the failure, and leave master untouched.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `apps/design-plugin/build.ts` | create | Entire plugin build: UI (standalone HTML), sandbox (IIFE), manifest, `--watch`, `--analyze` |
| `apps/design-plugin/bunfig.toml` | create | Tailwind plugin for the `bun` dev server used by `dev:ui-only` |
| `apps/design-plugin/figma.manifest.ts` | modify | Add `documentAccess` and `networkAccess` |
| `apps/design-plugin/package.json` | modify | Scripts and dependencies |
| `apps/design-plugin/tsconfig.json` | modify | Bun types, include `build.ts` and `figma.manifest.ts` |
| `apps/design-plugin/vite.config.ui.ts`, `vite.config.plugin.ts`, `postcss-url.d.ts`, `tsconfig.node.json` | delete | Replaced by `build.ts` |
| `packages/ui/bunfig.toml` | create | Test preloads |
| `packages/ui/src/test/happydom.ts` | create | Registers DOM globals (must run first) |
| `packages/ui/src/test/testing-library.ts` | create | jest-dom matchers + cleanup |
| `packages/ui/src/test/setup.ts` | delete | Old Vitest setup |
| `packages/ui/src/global.d.ts` | create | jest-dom matcher types on `bun:test` |
| `packages/ui/src/vite-env.d.ts` | delete | Vite client types |
| `packages/ui/vitest.config.ts`, `tsconfig.node.json` | delete | Vitest config |
| `packages/ui/src/assets/fonts/Alkatra.ttf`, `assets/react.svg`, `assets/vite.svg` | delete | Unused |
| `packages/common/vitest.config.ts`, `tsconfig.node.json` | delete | Vitest config |
| 37 `*.test.ts(x)` files | modify | `from "vitest"` → `from "bun:test"` |
| `packages/ui/package.json`, `packages/common/package.json` | modify | Scripts and dependencies |
| `package.json` (root) | modify | `packageManager`, `engines.bun` |
| `.github/workflows/ci.yml`, `docs.yml`, `release.yml` | modify | Bun pin; CI runs all tests |
| `turbo.json` | modify | `analyze` outputs |
| `scripts/` | delete | Three empty `.gitkeep` directories |
| `README.md`, `CONTRIBUTING.md`, `.claude/CLAUDE.md`, `.vscode/launch.json`, `.vscode/extensions.json`, `cspell.json`, `packages/ui/src/styles.css` | modify | Build-system wording only |
| `.changeset/bun-build-migration.md` | create | Minor changeset |

---

### Task 1: Worktree, branch, Bun pin

**Files:**
- Modify: `package.json` (root)
- Modify: `.github/workflows/ci.yml`, `.github/workflows/docs.yml`, `.github/workflows/release.yml`

- [ ] **Step 1: Create the worktree from the spec branch**

```bash
cd <path-to-your-clone>
git worktree add ../figma-plugin-template-bun -b feat/bun-build docs/bun-migration-spec
cd ../figma-plugin-template-bun
bun --version
```

Expected: `1.4.2` or newer. If older, install Bun 1.4.2 before continuing (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"`).

- [ ] **Step 2: Install dependencies in the worktree**

```bash
bun install --frozen-lockfile
```

Expected: completes without error.

- [ ] **Step 3: Bump the Bun pin in root package.json**

In `package.json` change:

```json
  "engines": {
    "node": ">=18",
    "bun": ">=1.0"
  },
```

to

```json
  "engines": {
    "node": ">=18",
    "bun": ">=1.4.2"
  },
```

and change `"packageManager": "bun@1.3.11"` to `"packageManager": "bun@1.4.2"`.

- [ ] **Step 4: Bump the Bun pin in all three workflows**

In each of `.github/workflows/ci.yml`, `.github/workflows/docs.yml`, `.github/workflows/release.yml`, change:

```yaml
          bun-version: "1.3.11"
```

to

```yaml
          bun-version: "1.4.2"
```

Verify:

```bash
grep -rn "bun-version\|packageManager\|\"bun\":" package.json .github/workflows/
```

Expected: five lines, all showing `1.4.2`.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/
git commit -m "chore: require Bun 1.4.2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Spike part A — build script produces single-file output

**Files:**
- Create: `apps/design-plugin/build.ts`
- Modify: `apps/design-plugin/figma.manifest.ts`
- Modify: `apps/design-plugin/package.json`
- Modify: `apps/design-plugin/tsconfig.json`

- [ ] **Step 1: Add the new build dependencies**

```bash
cd apps/design-plugin
bun add -d bun-plugin-tailwind@^0.1.2 @types/bun@^1.4.4 tailwindcss@^4.3.3
cd ../..
```

Expected: `apps/design-plugin/package.json` devDependencies now include the three packages. Do not remove the Vite packages yet; that is Task 6.

- [ ] **Step 2: Add the required manifest fields**

Replace the contents of `apps/design-plugin/figma.manifest.ts` with:

```ts
// https://www.figma.com/plugin-docs/manifest/
export default {
  name: "Figma-Plugin-React-Vite",
  id: "1222852692367737510",
  api: "1.0.0",
  main: "plugin.js",
  ui: "index.html",
  // Required for all new plugins. Figma loads pages lazily; node lookups across
  // pages must use the *Async APIs (e.g. figma.getNodeByIdAsync).
  documentAccess: "dynamic-page",
  // The template makes no network requests. Replace "none" with a domain list
  // (and add `reasoning`) if your plugin calls external services.
  networkAccess: { allowedDomains: ["none"] },
  capabilities: [],
  enableProposedApi: false,
  editorType: ["figma", "figjam"],
};
```

- [ ] **Step 3: Write build.ts**

Create `apps/design-plugin/build.ts`:

```ts
// Plugin build: UI (single-file HTML), sandbox (IIFE) and manifest.
//   bun build.ts              one production-or-dev build (NODE_ENV decides)
//   bun build.ts --watch      rebuild on changes under the three source dirs
//   bun build.ts --analyze    also write dist/meta-ui.json and dist/meta-plugin.json
import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";
import manifest from "./figma.manifest";

const root = import.meta.dir;
const uiSrc = path.resolve(root, "../../packages/ui/src");
const commonSrc = path.resolve(root, "../../packages/common/src");
const pluginSrc = path.resolve(root, "src/plugin");
const manifestFile = path.resolve(root, "figma.manifest.ts");
const outdir = path.resolve(root, "dist");

const isProd = process.env.NODE_ENV === "production";
const args = new Set(Bun.argv.slice(2));
const watchMode = args.has("--watch");
const analyze = args.has("--analyze");

const sourcemap = isProd ? "none" : "inline";

async function buildUi() {
  await Bun.build({
    entrypoints: [path.join(uiSrc, "index.html")],
    // compile + browser target = standalone HTML: JS, CSS and relative assets
    // are inlined. Figma requires the UI to be exactly one HTML file.
    compile: true,
    target: "browser",
    outdir,
    reactCompiler: true,
    plugins: [tailwind],
    minify: isProd,
    sourcemap,
    metafile: analyze ? path.join(outdir, "meta-ui.json") : undefined,
  });
}

async function buildPlugin() {
  await Bun.build({
    entrypoints: [path.join(pluginSrc, "plugin.ts")],
    target: "browser",
    format: "iife",
    outdir,
    naming: "plugin.[ext]",
    minify: isProd,
    sourcemap,
    metafile: analyze ? path.join(outdir, "meta-plugin.json") : undefined,
  });
}

async function writeManifest() {
  await Bun.write(path.join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function build() {
  const started = performance.now();
  await buildUi();
  await buildPlugin();
  await writeManifest();
  const ms = Math.round(performance.now() - started);
  console.log(`[build] ${isProd ? "production" : "development"} build done in ${ms}ms → ${outdir}`);
}

async function runOnce(): Promise<boolean> {
  try {
    await build();
    return true;
  } catch (error) {
    console.error("[build] failed:", error);
    return false;
  }
}

await rm(outdir, { recursive: true, force: true });

if (watchMode) {
  await runOnce();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(runOnce, 100);
  };
  for (const dir of [uiSrc, commonSrc, pluginSrc]) {
    watch(dir, { recursive: true }, schedule);
  }
  watch(manifestFile, schedule);
  console.log("[build] watching for changes… (Ctrl+C to stop)");
} else if (!(await runOnce())) {
  process.exit(1);
}
```

If `bun-plugin-tailwind` has no default export at runtime (error "tailwind is not a plugin"), change the import to `import { tailwind } from "bun-plugin-tailwind";` — that is the only acceptable variation.

- [ ] **Step 4: Point tsconfig at Bun types and include the build files**

Replace `apps/design-plugin/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "types": ["bun", "plugin-typings"],
    "typeRoots": ["./node_modules/@figma", "./node_modules/@types", "../../node_modules/@types"],
    "paths": {
      "@plugin/*": ["./src/plugin/*"],
      "monorepo-networker": ["./node_modules/monorepo-networker/dist/index.d.ts"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "build.ts", "figma.manifest.ts"]
}
```

- [ ] **Step 5: Add a temporary build script and run a production build**

In `apps/design-plugin/package.json` add one script (the full script table is rewritten in Task 5):

```json
    "build:bun": "NODE_ENV=production bun build.ts",
```

Run:

```bash
cd apps/design-plugin && bun run build:bun; cd ../..
```

Expected: a line like `[build] production build done in NNNms → .../apps/design-plugin/dist` and exit code 0.

- [ ] **Step 6: Verify the output is exactly three self-contained files**

```bash
ls apps/design-plugin/dist
grep -cE '(src|href)="(https?:|//|\./|/)' apps/design-plugin/dist/index.html
grep -c "<style" apps/design-plugin/dist/index.html
grep -c "<script" apps/design-plugin/dist/index.html
head -c 200 apps/design-plugin/dist/plugin.js; echo
cat apps/design-plugin/dist/manifest.json
```

Expected:
- `ls`: `index.html  manifest.json  plugin.js` (nothing else)
- external-reference count: `0`
- at least `1` `<style` and `1` `<script`
- `plugin.js` starts with an IIFE (`(()=>{` or `(function(){`), not `import`
- `manifest.json` contains `"documentAccess": "dynamic-page"` and `"allowedDomains": ["none"]`

If `grep -cE` prints a non-zero count, print the matches with `grep -nE '(src|href)="(https?:|//|\./|/)' apps/design-plugin/dist/index.html` and fix the build (not the HTML).

- [ ] **Step 7: Verify Tailwind utilities made it into the bundle**

```bash
grep -c "flex-col" apps/design-plugin/dist/index.html
grep -c "figma-dark" apps/design-plugin/dist/index.html
```

Expected: both `1` or more. If `0`, Tailwind content detection failed: change `@source ".";` in `packages/ui/src/styles.css` to `@source "./";` first, then try `@source "../src";`; record which worked.

- [ ] **Step 8: Verify a development build has inline sourcemaps**

```bash
cd apps/design-plugin && bun build.ts; cd ../..
grep -c "sourceMappingURL=data:" apps/design-plugin/dist/index.html apps/design-plugin/dist/plugin.js
```

Expected: `1` for each file. If `compile: true` rejects `sourcemap: "inline"`, set `sourcemap: isProd ? "none" : "inline"` only in `buildPlugin()` and `sourcemap: "none"` in `buildUi()`, and note it in a comment.

- [ ] **Step 9: Commit**

```bash
git add apps/design-plugin/build.ts apps/design-plugin/figma.manifest.ts apps/design-plugin/package.json apps/design-plugin/tsconfig.json bun.lock packages/ui/src/styles.css
git commit -m "feat(design-plugin): add Bun build script with single-file HTML output

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Spike part B — manual verification in Figma desktop

This task is manual. It cannot be done by a subagent; the executor must run it with the user or ask the user to run it and report back. Record each result in the checkbox text.

**Files:** none modified unless a fix is needed.

- [ ] **Step 1: Production build**

```bash
cd apps/design-plugin && bun run build:bun; cd ../..
```

- [ ] **Step 2: Import into Figma**

In Figma desktop: **Plugins → Development → Import plugin from manifest…** and pick `apps/design-plugin/dist/manifest.json`. If a plugin with the same id is already imported, remove it first so the new manifest is read.

- [ ] **Step 3: Criterion 1 — UI renders and dark mode works**

Run the plugin in a Figma Design file. Expected: an 800×650 window titled "My Figma Plugin!" showing the four sections Inputs, Buttons, Display, Layout, with styled shadcn controls (not unstyled HTML). Toggle Figma to dark theme (Figma menu → Preferences → Theme). Expected: plugin background turns dark.

Open the plugin console (**Plugins → Development → Show/Hide console**). Expected: `Bootstrapped @ Plugin-side` and `Plugin side said Hey there, UI!`-style logs, no red errors.

Result: PASS on rendering (2026-10-29, Jonas, screenshot): all four sections styled, icons present, no errors reported. Dark mode FAILED, and Jonas confirmed it had never worked on the Vite build either. Root cause (Figma docs, CSS Variables and Theming): `figma.showUI` was never called with `themeColors: true`, so Figma never adds `html.figma-dark`. Fixed out of plan in commit `7eec96d` (two lines in `plugin.ts`). Dark-mode re-check after the fix: PASS (2026-10-29, Jonas, screenshot): dark background and tokens apply. Component styling still needs alignment with Figma native UI3; deferred to its own phase.

- [ ] **Step 4: Criterion 2 — sandbox handlers behave**

Add this temporary button at the end of `packages/ui/src/app.tsx` inside the Buttons section, rebuild, and re-run the plugin:

```tsx
<Button variant="outline" onClick={() => UI_CHANNEL.emit(PLUGIN, "createRect", [120, 80])}>
  Create rectangle (spike)
</Button>
```

with these imports added at the top of `app.tsx`:

```tsx
import { PLUGIN } from "@repo/common/networkSides";
import { UI_CHANNEL } from "./app.network";
```

Expected: clicking the button creates a randomly coloured 120×80 rectangle named `Plugin Rectangle # NNNN`, the viewport zooms to it, and the plugin closes.

Then select any node, re-run the plugin and in the plugin console run:

```js
// From the UI iframe console (select the iframe context in the console dropdown):
await UI_CHANNEL.request(PLUGIN, "exportSelection", [])
```

If the iframe context is awkward, skip the console step and accept criterion 2 on the rectangle test alone; `exportSelection` uses only `exportAsync` and `base64Encode`, both unaffected by the bundler.

Remove the temporary button and imports from `app.tsx` afterwards. `git diff --stat` must show `app.tsx` unchanged.

Result: PASS (2026-10-29, Jonas, screenshot): `Plugin Rectangle # 1093` created, viewport zoomed, plugin closed. Console step for `exportSelection` skipped per the plan's allowance. Temporary button reverted; `app.tsx` unchanged.

- [ ] **Step 5: Criterion 3 — React Compiler output behaves identically**

Criterion 3 is already exercised by steps 3–4 because `reactCompiler: true` is on. Additionally type in the Input and Textarea, toggle the Checkbox and Switch, open the Select and the Accordion. Expected: every control responds; no console errors mentioning `react/compiler-runtime` or `useMemoCache`.

If anything fails that passes with `reactCompiler: false`, set `reactCompiler: false` in `build.ts` with this comment above it:

```ts
    // React Compiler disabled: Bun's experimental integration broke <describe what> on <date>.
    // Re-enable when https://github.com/oven-sh/bun/issues (search "reactCompiler") is resolved.
```

and commit as `fix(design-plugin): disable experimental React Compiler in Bun build`.

Result: PASS (2026-10-29, Jonas): all controls respond, no console errors; `reactCompiler: true` stays on. Production bundle contains 6 `useMemoCache` call sites, confirming the compiler ran.

- [ ] **Step 6: Gate decision**

If criterion 1 or 2 failed and could not be fixed by changing only `build.ts`, `figma.manifest.ts` or tsconfig: STOP here. Report to the user with the exact error. Do not continue to Task 4.

Otherwise continue.

---

### Task 4: Spike part C — tests run under `bun test`

**Files:**
- Create: `packages/ui/bunfig.toml`, `packages/ui/src/test/happydom.ts`, `packages/ui/src/test/testing-library.ts`, `packages/ui/src/global.d.ts`
- Delete: `packages/ui/src/test/setup.ts`
- Modify: 37 test files, `packages/ui/package.json`, `packages/common/package.json`

- [ ] **Step 1: Migrate packages/common first (no DOM, smallest risk)**

```bash
sed -i '' 's/from "vitest"/from "bun:test"/' packages/common/src/__tests__/networkSides.test.ts
cd packages/common && bun test; cd ../..
```

Expected output ends with ` 2 pass`, ` 0 fail`.

- [ ] **Step 2: Add the test dependencies to packages/ui**

```bash
cd packages/ui
bun add -d @happy-dom/global-registrator@^21.0.4 @types/bun@^1.4.4
cd ../..
```

- [ ] **Step 3: Create the two preload files**

Create `packages/ui/src/test/happydom.ts`:

```ts
// Preload 1 of 2. Must run before anything imports @testing-library/*,
// otherwise `screen` queries throw because `document` does not exist yet.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
```

Create `packages/ui/src/test/testing-library.ts`:

```ts
// Preload 2 of 2. Runs after happydom.ts (order is set in bunfig.toml).
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "bun:test";

expect.extend(matchers);

// Vitest unmounted rendered trees between tests automatically; bun test does not.
afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: Create bunfig.toml for packages/ui**

Create `packages/ui/bunfig.toml`:

```toml
[test]
preload = ["./src/test/happydom.ts", "./src/test/testing-library.ts"]
```

- [ ] **Step 5: Add matcher types for bun:test**

Create `packages/ui/src/global.d.ts`:

```ts
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  // biome-ignore lint/suspicious/noEmptyInterface: module augmentation, not an alias
  interface Matchers<T> extends TestingLibraryMatchers<typeof expect.stringContaining, T> {}
  // biome-ignore lint/suspicious/noEmptyInterface: module augmentation, not an alias
  interface AsymmetricMatchers extends TestingLibraryMatchers<unknown, unknown> {}
}
```

- [ ] **Step 6: Delete the old Vitest setup and rewrite the imports**

```bash
git rm -q packages/ui/src/test/setup.ts
grep -rl 'from "vitest"' packages/ui/src | xargs sed -i '' 's/from "vitest"/from "bun:test"/'
grep -rn 'vitest' packages/ui/src packages/common/src
```

Expected: the final grep prints nothing.

- [ ] **Step 7: Run the UI tests**

```bash
cd packages/ui && bun test; cd ../..
```

Expected: ` 0 fail`, and the summary reports 36 test files (every `*.test.ts` and `*.test.tsx` under `packages/ui/src`; the 37th lives in `packages/common`).

Known adjustments, apply only if the corresponding failure appears:
- `expect.extend(matchers)` type error in `tsc` → `expect.extend(matchers as unknown as Record<string, (...args: unknown[]) => unknown>)`.
- `vi.spyOn(console, "warn")` in `icon-registration.test.tsx` not restoring → replace with `spyOn` imported from `bun:test` (same signature).
- A test relying on `css: true` → none exist (verified: no `.css` imports in `packages/ui/src/**/*.ts(x)`).

- [ ] **Step 8: Update test scripts**

In `packages/ui/package.json` and `packages/common/package.json` change:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

to

```json
    "test": "bun test",
    "test:watch": "bun test --watch",
```

Run from the repo root:

```bash
bun run test
```

Expected: Turborepo runs both packages; both report ` 0 fail`.

- [ ] **Step 9: Commit (criterion 4 met)**

```bash
git add -A packages/ui packages/common bun.lock
git commit -m "test: run packages/ui and packages/common under bun test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Finalise build scripts, watch mode and dev server

**Files:**
- Modify: `apps/design-plugin/package.json`
- Create: `apps/design-plugin/bunfig.toml`
- Modify: `turbo.json`

- [ ] **Step 1: Replace the script table**

In `apps/design-plugin/package.json` replace the whole `"scripts"` object with:

```json
  "scripts": {
    "build": "NODE_ENV=production bun build.ts",
    "dev": "bun build.ts --watch",
    "dev:ui-only": "bun ../../packages/ui/src/index.html",
    "types": "tsc --noEmit",
    "analyze": "NODE_ENV=production bun build.ts --analyze",
    "lint": "biome check ."
  },
```

(`build:bun`, `build:ui`, `build:plugin`, `dev:ui-watch`, `dev:plugin-watch` are removed.)

- [ ] **Step 2: Tailwind for the UI-only dev server**

Create `apps/design-plugin/bunfig.toml`:

```toml
# Used by `bun run dev:ui-only` (Bun's dev server with HMR). Production builds
# pass the plugin explicitly in build.ts.
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

- [ ] **Step 3: Verify watch mode rebuilds**

```bash
cd apps/design-plugin
bun build.ts --watch &
WATCH_PID=$!
sleep 3
touch ../../packages/ui/src/app.tsx
sleep 2
kill $WATCH_PID
cd ../..
```

Expected: two `[build] development build done` lines (initial + after touch) and a `watching for changes` line.

- [ ] **Step 4: Verify analyze output**

```bash
bun run --filter @repo/design-plugin analyze
ls apps/design-plugin/dist
```

Expected: `index.html manifest.json meta-plugin.json meta-ui.json plugin.js`.

- [ ] **Step 5: Verify the UI-only dev server starts**

```bash
cd apps/design-plugin && (bun run dev:ui-only & sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000; kill %1); cd ../..
```

Expected: `200`. If Bun picks another port, read it from the server's startup line and retry the curl.

- [ ] **Step 6: Update the Turborepo analyze outputs**

In `turbo.json` change:

```json
    "analyze": {
      "dependsOn": ["^build"],
      "outputs": ["stats.html"],
      "cache": false
    },
```

to

```json
    "analyze": {
      "dependsOn": ["^build"],
      "outputs": ["dist/meta-*.json"],
      "cache": false
    },
```

In `.gitignore` replace the two lines

```
# Bundle analysis output (generated by bun run analyze)
stats.html
```

with

```
# Bundle analysis output (generated by bun run analyze)
stats.html
**/dist/meta-*.json
```

- [ ] **Step 7: Commit**

```bash
git add apps/design-plugin/package.json apps/design-plugin/bunfig.toml turbo.json .gitignore
git commit -m "feat(design-plugin): bun-based dev, analyze and ui-only scripts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Remove Vite, Vitest and dead weight

**Files:**
- Delete: `apps/design-plugin/vite.config.ui.ts`, `apps/design-plugin/vite.config.plugin.ts`, `apps/design-plugin/postcss-url.d.ts`, `apps/design-plugin/tsconfig.node.json`
- Delete: `packages/ui/vitest.config.ts`, `packages/ui/tsconfig.node.json`, `packages/ui/src/vite-env.d.ts`
- Delete: `packages/common/vitest.config.ts`, `packages/common/tsconfig.node.json`
- Delete: `packages/ui/src/assets/fonts/Alkatra.ttf`, `packages/ui/src/assets/react.svg`, `packages/ui/src/assets/vite.svg`, `scripts/`
- Modify: `apps/design-plugin/package.json`, `packages/ui/package.json`, `packages/common/package.json`

- [ ] **Step 1: Delete files**

```bash
git rm -q apps/design-plugin/vite.config.ui.ts apps/design-plugin/vite.config.plugin.ts \
  apps/design-plugin/postcss-url.d.ts apps/design-plugin/tsconfig.node.json \
  packages/ui/vitest.config.ts packages/ui/tsconfig.node.json packages/ui/src/vite-env.d.ts \
  packages/common/vitest.config.ts packages/common/tsconfig.node.json \
  packages/ui/src/assets/fonts/Alkatra.ttf packages/ui/src/assets/react.svg packages/ui/src/assets/vite.svg
git rm -rq scripts
```

- [ ] **Step 2: Remove the Vite dependencies from apps/design-plugin**

Replace the `"devDependencies"` object in `apps/design-plugin/package.json` with:

```json
  "devDependencies": {
    "@figma/plugin-typings": "^1.124.0",
    "@types/bun": "^1.4.4",
    "bun-plugin-tailwind": "^0.1.2",
    "tailwindcss": "^4.3.3",
    "typescript": "^6.0.0"
  }
```

- [ ] **Step 3: Remove Vite and Vitest from packages/ui**

In `packages/ui/package.json` remove each of these devDependency keys (Task 4's `bun add` sorted the file alphabetically, so they are no longer contiguous; delete them one by one):

```json
    "@vitejs/plugin-react": "^6.0.0",
    "vite": "^8.0.0",
    "happy-dom": "^20.9.0",
    "@types/node": "^25.0.0",
    "vitest": "^4.1.4"
```

Also change `"tailwindcss": "^4.2.3"` to `"tailwindcss": "^4.3.3"` so it matches `apps/design-plugin` (one Tailwind source of truth). Then change `"types": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json"` to `"types": "tsc --noEmit"`.

- [ ] **Step 4: Remove Vitest from packages/common**

In `packages/common/package.json` remove:

```json
    "@types/node": "^25.0.0",
    "vitest": "^4.1.4"
```

and change `"types"` to `"tsc --noEmit"`. (`@types/bun` and `"types": ["bun"]` in `tsconfig.json` were already added by the Task 4 review fix; do not add them again.)

- [ ] **Step 5: Reinstall and confirm Vite survives only in Storybook**

```bash
bun install
grep -n '"vite"\|vitest\|@vitejs\|happy-dom"' apps/*/package.json packages/*/package.json
```

Expected: matches only in `apps/storybook/package.json`.

Also confirm only one happy-dom remains in the lockfile:

```bash
grep -o '"happy-dom@[0-9.]*"' bun.lock | sort -u
```

Expected: a single line, `"happy-dom.0.4"` (the registrator's copy); the old 20.9.0 entry must be gone.

- [ ] **Step 6: Make sure the UI package's tsconfig still includes the new d.ts**

`packages/ui/tsconfig.json` `include` already has `"src/**/*.d.ts"`, which covers `src/global.d.ts`. Verify:

```bash
grep -n 'src/\*\*/\*.d.ts' packages/ui/tsconfig.json
```

Expected: one line.

- [ ] **Step 7: Full verification**

```bash
bun run lint
bun run types
bun run test
bun run build
bunx turbo run build-storybook --filter=@repo/storybook
```

Expected: every command exits 0. Storybook still builds because it kept its own Vite.

Note on TypeScript 6: `types` defaults to `[]`, so `@types/*` packages are not auto-included. `packages/common` already sets `"types": ["bun"]` and `packages/ui` already has `/// <reference types="bun" />` in `src/global.d.ts` (both from the Task 4 review fix). If `types` still fails after removing `@types/node`, the failing package needs the same treatment; do not re-add `@types/node`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove Vite and Vitest from plugin and packages

Storybook keeps its own Vite. Also drops the unused Alkatra font, Vite
SVG assets, postcss-url shim and the empty scripts/ tree.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: CI runs all tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Widen the test step**

In `.github/workflows/ci.yml` change:

```yaml
      - name: Test
        run: bun run --filter @repo/ui test
```

to

```yaml
      - name: Test
        run: bun run test
```

- [ ] **Step 2: Lint the workflow file locally**

```bash
bun -e 'Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()); console.log("yaml ok")'
```

Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run tests for every package

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Documentation and editor config

Only build-system wording changes. Stale paths and component counts elsewhere are stream 2. `apps/docs/content/docs/guides/architecture.mdx` and `.agents/skills/build-figma-plugin/references/architecture.md` were checked and contain no Vite or Vitest references, so they need no edit.

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `.claude/CLAUDE.md`, `.vscode/launch.json`, `.vscode/extensions.json`, `cspell.json`, `packages/ui/src/styles.css`

- [ ] **Step 1: README**

Line 5, replace the Bun badge `![Bun](https://img.shields.io/badge/bun-1.3-f9f1e1?logo=bun)` with `![Bun](https://img.shields.io/badge/bun-1.4-f9f1e1?logo=bun)`.

Line 8, replace the Vite badge:

```md
![Vite](https://img.shields.io/badge/vite-8-646cff?logo=vite&logoColor=white)
```

with

```md
![Bun](https://img.shields.io/badge/bun_bundler-1.4-f9f1e1?logo=bun)
```

Line 14: `Figma/FigJam plugin boilerplate with React, Vite, TypeScript, and Turborepo monorepo.` → `Figma/FigJam plugin boilerplate with React, Bun, TypeScript, and Turborepo monorepo.`

Line 19: `- **React + TypeScript + Vite** build pipeline` → `- **React + TypeScript + Bun** build pipeline — one script, no bundler plugins to configure`

Line 23: `- **Vitest** for testing (happy-dom for UI, node for common packages)` → `- **bun test** for testing (happy-dom for UI, plain runtime for common packages)`

Line 45: `  design-plugin/  — Figma plugin app (Vite builds to dist/)` → `  design-plugin/  — Figma plugin app (build.ts bundles to dist/)`

- [ ] **Step 2: CONTRIBUTING**

Line 8: `- [Bun](https://bun.sh) >= 1.0` → `- [Bun](https://bun.sh) >= 1.4.2`

Line 26: `| \`bun run test\` | Run all tests (Vitest) |` → `| \`bun run test\` | Run all tests (bun test) |`

- [ ] **Step 3: CLAUDE.md build-system sections**

Line 61: `- \`bun run test\` — Run all tests across all packages (Vitest)` → `- \`bun run test\` — Run all tests across all packages (bun test)`

Replace the block starting `### Build System` through the end of the `### SVG Imports` section (lines 114–128) with:

```md
### Build System

Turborepo orchestrates tasks. The plugin is built by one script, `apps/design-plugin/build.ts`, run with Bun:
- UI: `Bun.build` with the `index.html` entrypoint in standalone mode (`compile: true, target: "browser"`), which inlines all JS, CSS and assets into `dist/index.html`. Tailwind runs via `bun-plugin-tailwind`; React Compiler via `reactCompiler: true`.
- Plugin sandbox: `Bun.build` of `src/plugin/plugin.ts` as an IIFE to `dist/plugin.js`.
- Manifest: `dist/manifest.json` written from `figma.manifest.ts`.

`bun run dev` runs the same script with `--watch`; `bun run analyze` adds `dist/meta-*.json` size reports. Figma requires the UI to be a single HTML file — never add external file references.

Storybook (`apps/storybook`) is the only workspace that still uses Vite.

Bun does not downlevel syntax: `dist/plugin.js` ships modern JavaScript unchanged (verified running in Figma's sandbox), so there is no `target: es2017` any more.
```

Line 135: `- **Bun 1.3.11** — Package manager (sole lockfile: `bun.lock`)` → `- **Bun 1.4.2** — Package manager, bundler and test runner (sole lockfile: `bun.lock`)`

Line 138: `- **Vitest 4.x** — Testing framework (happy-dom for UI, node for common)` → `- **bun test** — Testing framework (happy-dom via preload for UI, plain runtime for common)`

Line 140: `- **Vite 6** — Build tool with single-file output for Figma plugins` → `- **Bun bundler** — Standalone-HTML build for the plugin UI; Vite remains only for Storybook`

- [ ] **Step 4: VS Code launch config**

In `.vscode/launch.json` replace the first configuration object (`"Debug Vitest (current file)"`) with:

```json
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "Debug bun test (current file)",
      "command": "bun test --inspect-brk ${relativeFile}",
      "cwd": "${workspaceFolder}"
    },
```

In `.vscode/extensions.json` remove the two lines `"vitest.explorer",` and `"antfu.vite",`. (`oven.bun-vscode` is already listed.)

- [ ] **Step 5: Spell-check dictionary**

In `cspell.json` add `"bunfig",` to the `words` array in alphabetical position (after `"bromso",`). (`cspell.json` has no vite or vitest entries, so nothing to remove.)

- [ ] **Step 6: styles.css comment**

Replace lines 3–6 of `packages/ui/src/styles.css`:

```css
/* Tailwind v4 auto-scan: scan this directory for utility classes.
   Required because Vite root is set to this directory but the build
   runs from apps/figma-plugin. */
@source ".";
```

with

```css
/* Tailwind v4 content scan, relative to this file. The build runs from
   apps/design-plugin, so the default auto-detection would miss these sources. */
@source ".";
```

(Keep whatever `@source` value Task 2 step 7 settled on.)

- [ ] **Step 6b: Root package.json, docs-app metadata, manifest name (added after the Task 6 review)**

Root `package.json`: change the `description` to `Figma/FigJam plugin boilerplate with React, Bun, TypeScript, and Turborepo monorepo`; in `keywords` delete `"vite"` and `"vitest"` (`"bun"` is already present).

`apps/docs/content/docs/index.mdx` line 3, `apps/docs/src/app/layout.tsx` (every occurrence: lines 14, 29, 44, 54) and `apps/docs/src/app/manifest.ts` line 9: replace `React, Vite, TypeScript` with `React, Bun, TypeScript`. In `layout.tsx`, hoist the repeated string into one `const SITE_DESCRIPTION = "Build Figma plugins with React, Bun, TypeScript, and AI skills";` next to `SITE_URL` and reference it in all four places.

`apps/docs/content/docs/project/contributing.mdx` line 50: `- Vitest tests (27+ tests)` → `- bun test suites (90+ tests)`.

`apps/design-plugin/figma.manifest.ts` line 3: `name: "Figma-Plugin-React-Vite"` → `name: "Figma Plugin Template"` (the user-visible plugin name in Figma; the old name advertised Vite). Keep the `id`.

Verify:

```bash
grep -rn 'React, Vite\|Vitest tests\|Figma-Plugin-React-Vite\|"vitest"\|"vite"' package.json apps/docs/content apps/docs/src apps/design-plugin/figma.manifest.ts
```

Expected: nothing.

- [ ] **Step 7: Verify and commit**

```bash
grep -rn -i "vitest\|vite\b" README.md CONTRIBUTING.md .claude/CLAUDE.md .vscode/ cspell.json packages/ui/src/styles.css | grep -v -i "storybook"
bun run lint
```

Expected: the grep prints nothing; lint exits 0.

```bash
git add README.md CONTRIBUTING.md .claude/CLAUDE.md .vscode/launch.json .vscode/extensions.json cspell.json packages/ui/src/styles.css
git commit -m "docs: describe the Bun build and test setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Changeset, final verification, PR

**Files:**
- Create: `.changeset/bun-build-migration.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/bun-build-migration.md`:

```md
---
"@repo/ui": minor
"@repo/common": minor
---

Replace Vite and Vitest with Bun's bundler and test runner. The plugin is built by a single `build.ts` (standalone HTML output, Tailwind, React Compiler); tests run under `bun test` with happy-dom. Storybook keeps Vite. Requires Bun 1.4.2+. The manifest now sets `documentAccess: "dynamic-page"` and `networkAccess`.
```

- [ ] **Step 2: Full verification from a clean install**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install --frozen-lockfile
bun run lint && bun run types && bun run test && bun run build
bunx turbo run build-storybook --filter=@repo/storybook
grep -rln '"vite"\|from "vitest"' apps packages --include=package.json --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Expected: all commands exit 0; the final grep lists only `apps/storybook/package.json`.

- [ ] **Step 3: Final Figma check**

Re-import `apps/design-plugin/dist/manifest.json` in Figma desktop and run the plugin once. Expected: UI renders as in Task 3.

- [ ] **Step 4: Commit and push**

```bash
git add .changeset/bun-build-migration.md
git commit -m "chore: add changeset for Bun build migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/bun-build
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base master --title "feat: build and test with Bun instead of Vite/Vitest" --body "$(cat <<'PRBODY'
## Summary
- Replace both Vite configs with `apps/design-plugin/build.ts` (Bun standalone HTML for the UI, IIFE for the sandbox, manifest write; `--watch`, `--analyze`)
- Run `packages/ui` and `packages/common` tests under `bun test` (happy-dom + Testing Library via preload)
- Add required `documentAccess: "dynamic-page"` and `networkAccess` to the manifest
- Remove Vite/Vitest from the three workspaces; Storybook keeps its own Vite
- Require Bun 1.4.2; CI now tests every package

Spec: docs/superpowers/specs/2026-10-29-bun-migration-design.md
Plan: docs/superpowers/plans/2026-10-29-bun-migration.md

## Test plan
- [ ] CI green
- [ ] Plugin imported from `dist/manifest.json` renders in Figma desktop, light and dark
- [ ] createRect handler creates a rectangle
- [ ] Storybook builds

## Known follow-ups (not in this PR)
- `biome.json` does not exclude the PWA files that `next build` writes into `apps/docs/public` (`sw.js`, `swe-worker-*.js`, `workbox-*.js`, all gitignored). Running `bun run lint` after a docs build therefore fails with ~70 errors. CI is unaffected (lint runs before build). Fix in stream 2 by adding `!**/public/sw.js`, `!**/public/swe-worker-*.js`, `!**/public/workbox-*.js` to `files.includes`.
- 18 React "not wrapped in act(...)" warnings from Radix overlay tests (alert-dialog, dialog, hover-card, sheet, tooltip). Pre-existing async updates; fix by awaiting `findBy*`/`waitFor` in those tests. Tracked for stream 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)"
```

Expected: a PR URL. Report it to the user together with the Task 3 results.
