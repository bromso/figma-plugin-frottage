# Fumadocs Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Fumadocs documentation site at `apps/docs/` with 10 MDX pages covering the entire template, deployed to GitHub Pages.

**Architecture:** Next.js 15 App Router + fumadocs-core + fumadocs-ui + fumadocs-mdx. Static export with Orama client-side search. GitHub Pages deployment via Actions. Integrated into Turborepo pipeline.

**Tech Stack:** Next.js 15, fumadocs-mdx, fumadocs-core, fumadocs-ui, Tailwind CSS 4, Orama search

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create: `apps/docs/package.json`
- Create: `apps/docs/tsconfig.json`
- Create: `apps/docs/next.config.mjs`
- Create: `apps/docs/source.config.ts`
- Create: `apps/docs/postcss.config.mjs`

**Step 1: Create apps/docs/package.json**

```json
{
  "name": "@repo/docs",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "biome check ."
  },
  "dependencies": {
    "@types/mdx": "^2.0.13",
    "fumadocs-core": "^15.0.0",
    "fumadocs-mdx": "^11.0.0",
    "fumadocs-ui": "^15.0.0",
    "next": "^15.0.0",
    "react": "^19.2.5",
    "react-dom": "^19.2.5"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "tailwindcss": "^4.2.3",
    "typescript": "^6.0.0"
  }
}
```

**Step 2: Create apps/docs/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["./src/*"],
      "collections/*": ["./.source/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    "**/*.mjs",
    ".source/**/*.ts"
  ],
  "exclude": ["node_modules", ".next", "out"]
}
```

**Step 3: Create apps/docs/next.config.mjs**

```js
import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  basePath: "/figma-plugin-template",
  reactStrictMode: true,
  images: { unoptimized: true },
};

const withMDX = createMDX();

export default withMDX(config);
```

**Step 4: Create apps/docs/source.config.ts**

```ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig();
```

**Step 5: Create apps/docs/postcss.config.mjs**

```js
export default {
  plugins: {
    tailwindcss: {},
  },
};
```

**Step 6: Run install**

Run: `bun install`
Expected: Clean install

**Step 7: Commit**

```bash
git add apps/docs/package.json apps/docs/tsconfig.json apps/docs/next.config.mjs apps/docs/source.config.ts apps/docs/postcss.config.mjs bun.lock
git commit -m "chore: scaffold fumadocs Next.js app at apps/docs"
```

---

### Task 2: Create app shell (layout, page, styles, source)

**Files:**
- Create: `apps/docs/src/app/global.css`
- Create: `apps/docs/src/app/layout.tsx`
- Create: `apps/docs/src/app/page.tsx`
- Create: `apps/docs/src/app/docs/layout.tsx`
- Create: `apps/docs/src/app/docs/[[...slug]]/page.tsx`
- Create: `apps/docs/src/app/api/search/route.ts`
- Create: `apps/docs/src/lib/source.ts`
- Create: `apps/docs/src/lib/layout.shared.tsx`
- Create: `apps/docs/src/components/mdx.tsx`

**Step 1: Create src/app/global.css**

```css
@import "tailwindcss";
@import "fumadocs-ui/css/neutral.css";
@import "fumadocs-ui/css/preset.css";
```

**Step 2: Create src/app/layout.tsx**

```tsx
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import "./global.css";

export const metadata = {
  title: "Figma Plugin Template",
  description:
    "Build Figma plugins with React, Vite, TypeScript, and AI skills",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
```

**Step 3: Create src/app/page.tsx (landing redirect)**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/docs");
}
```

**Step 4: Create src/lib/source.ts**

```ts
import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
```

**Step 5: Create src/lib/layout.shared.tsx**

```tsx
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Figma Plugin Template",
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/bromso/figma-plugin-template",
      },
    ],
  };
}
```

**Step 6: Create src/components/mdx.tsx**

```tsx
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
```

**Step 7: Create src/app/docs/layout.tsx**

```tsx
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
```

**Step 8: Create src/app/docs/[[...slug]]/page.tsx**

```tsx
import { source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
```

**Step 9: Create src/app/api/search/route.ts (static search)**

```ts
import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
```

**Step 10: Verify dev server starts**

Run: `cd apps/docs && mkdir -p content/docs && echo '---\ntitle: Hello\n---\n\nTest page.' > content/docs/index.mdx && bunx next dev`
Expected: Dev server starts, `/docs` renders the test page

**Step 11: Commit**

```bash
git add apps/docs/src/ apps/docs/content/
git commit -m "feat: add fumadocs app shell with layout, routing, and search"
```

---

### Task 3: Write documentation content (10 pages)

**Files:**
- Create: `apps/docs/content/docs/index.mdx`
- Create: `apps/docs/content/docs/getting-started/index.mdx`
- Create: `apps/docs/content/docs/getting-started/testing-in-figma.mdx`
- Create: `apps/docs/content/docs/guides/architecture.mdx`
- Create: `apps/docs/content/docs/guides/ui-components.mdx`
- Create: `apps/docs/content/docs/guides/messaging.mdx`
- Create: `apps/docs/content/docs/guides/plugin-config.mdx`
- Create: `apps/docs/content/docs/ai/skills.mdx`
- Create: `apps/docs/content/docs/ai/using-claude.mdx`
- Create: `apps/docs/content/docs/project/versioning.mdx`
- Create: `apps/docs/content/docs/project/contributing.mdx`
- Create: `apps/docs/content/docs/meta.json`

Each page uses frontmatter: `title`, `description`. Sidebar order is controlled via `meta.json` files in each directory.

Content is sourced from existing README.md, CONTRIBUTING.md, CLAUDE.md, and CHANGELOG.md — rewritten for the non-programmer audience with clearer language and step-by-step structure.

**Step 1: Create all meta.json files for sidebar ordering**

`apps/docs/content/docs/meta.json`:
```json
{
  "title": "Documentation",
  "pages": [
    "---Getting Started---",
    "getting-started/index",
    "getting-started/testing-in-figma",
    "---Guides---",
    "guides/architecture",
    "guides/ui-components",
    "guides/messaging",
    "guides/plugin-config",
    "---AI Skills---",
    "ai/skills",
    "ai/using-claude",
    "---Project---",
    "project/versioning",
    "project/contributing"
  ]
}
```

**Step 2: Write all 10 content pages** (see design doc for structure)

Each page should be 100-300 words, written for non-programmers, with code blocks only where essential (and always with explanatory comments).

**Step 3: Verify all pages render**

Run: `cd apps/docs && bunx next dev`
Navigate: Check all 10 pages load, sidebar navigates correctly, search works

**Step 4: Commit**

```bash
git add apps/docs/content/
git commit -m "docs: add 10 documentation pages covering all template features"
```

---

### Task 4: Integrate with Turborepo

**Files:**
- Modify: `turbo.json`
- Modify: `package.json` (root)

**Step 1: Add docs tasks to turbo.json**

Add after existing tasks:
```json
"docs:dev": {
  "cache": false,
  "persistent": true
},
"docs:build": {
  "dependsOn": ["^build"],
  "outputs": ["out/**", ".next/**"]
}
```

**Step 2: Add root scripts**

In root `package.json`, add:
```json
"docs": "turbo run docs:dev --filter @repo/docs",
"docs:build": "turbo run docs:build --filter @repo/docs"
```

**Step 3: Verify turbo integration**

Run: `bun run docs:build`
Expected: Static export created at `apps/docs/out/`

**Step 4: Commit**

```bash
git add turbo.json package.json
git commit -m "chore: integrate fumadocs with Turborepo pipeline"
```

---

### Task 5: GitHub Pages deployment workflow

**Files:**
- Create: `.github/workflows/docs.yml`

**Step 1: Create the docs deployment workflow**

```yaml
name: Deploy Docs

on:
  push:
    branches: [master]
    paths:
      - "apps/docs/**"
      - ".github/workflows/docs.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build docs
        run: bun run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/docs/out

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 2: Add .gitignore entries**

Add to root `.gitignore`:
```
# Fumadocs build output
.next/
out/
.source/
```

**Step 3: Commit**

```bash
git add .github/workflows/docs.yml .gitignore
git commit -m "ci: add GitHub Pages deployment workflow for docs"
```

---

### Task 6: Final verification

**Step 1: Full build check**

```bash
bun run types          # All packages pass
bun run lint           # Biome passes
bun run --filter @repo/ui test  # 27 tests pass
bun run --filter @repo/design-plugin build  # Plugin builds
bun run docs:build     # Docs static export succeeds
```

**Step 2: Check static output**

```bash
ls apps/docs/out/
# Should contain: index.html, docs/, _next/, api/
```

**Step 3: Push**

```bash
git push origin master
```
