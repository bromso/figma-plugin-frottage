# MCP Servers Documentation Page — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a dedicated MCP servers docs page and reorganize the "AI Skills" section into "Skills" with `skills/` URL paths.

**Architecture:** Move existing MDX files from `ai/` to `skills/`, update sidebar navigation in `meta.json`, strip MCP content from the skills page, and create a new `mcp-servers.mdx` with full setup guide.

**Tech Stack:** Fumadocs (MDX), Next.js 15

---

### Task 1: Move `ai/skills.mdx` to `skills/index.mdx` and update content

**Files:**
- Create: `apps/docs/content/docs/skills/index.mdx`
- Delete: `apps/docs/content/docs/ai/skills.mdx`

**Step 1: Create `skills/index.mdx` with updated content**

Create `apps/docs/content/docs/skills/index.mdx` with the contents of `ai/skills.mdx` but:
- Change title from `AI Skills` to `Skills`
- Change description from `Pre-installed Claude Code skills that help you build plugins without writing code.` to `Pre-installed Claude Code skills that help you build Figma plugins without writing code.`
- Remove the entire `## MCP servers` section (lines 42-47 in the original)

```mdx
---
title: Skills
description: Pre-installed Claude Code skills that help you build Figma plugins without writing code.
---

## What are skills?

Skills are instructions that teach Claude how to perform specific tasks. This template comes with skills pre-installed so Claude already knows how to build Figma plugins.

## Installed skills

### build-figma-plugin

The main skill. Describe your plugin idea in plain English and Claude generates everything:
- Plugin code (Figma API interactions)
- UI code (React components)
- Message types (communication between plugin and UI)
- Build validation (ensures the output works)
- Installation guide (how to load it into Figma)

### frontend-design

Generates polished, intentional UI that avoids the "generic AI look". Guides typography, color, and layout decisions.

### shadcn

Knows how to correctly generate and compose shadcn/ui components — the same component library this template uses.

### find-skills

Discover and install new skills from the [skills ecosystem](https://skills.sh). If you need a capability that's not built in, this skill helps you find it.

### skill-creator

For power users: create your own custom skills for patterns you use repeatedly.

### figma-use + figma-api

Reference skills that help Claude understand the Figma API and use Figma-related MCP tools.
```

**Step 2: Delete `apps/docs/content/docs/ai/skills.mdx`**

Run: `rm apps/docs/content/docs/ai/skills.mdx`

**Step 3: Commit**

```bash
git add apps/docs/content/docs/skills/index.mdx
git add apps/docs/content/docs/ai/skills.mdx
git commit -m "docs: move ai/skills.mdx to skills/index.mdx and remove MCP section"
```

---

### Task 2: Move `ai/using-claude.mdx` to `skills/using-claude.mdx`

**Files:**
- Create: `apps/docs/content/docs/skills/using-claude.mdx`
- Delete: `apps/docs/content/docs/ai/using-claude.mdx`

**Step 1: Copy the file**

Run: `cp apps/docs/content/docs/ai/using-claude.mdx apps/docs/content/docs/skills/using-claude.mdx`

Contents stay identical — no edits needed.

**Step 2: Delete the original**

Run: `rm apps/docs/content/docs/ai/using-claude.mdx`

**Step 3: Remove empty `ai/` directory**

Run: `rmdir apps/docs/content/docs/ai`

**Step 4: Commit**

```bash
git add apps/docs/content/docs/skills/using-claude.mdx
git add apps/docs/content/docs/ai/using-claude.mdx
git commit -m "docs: move ai/using-claude.mdx to skills/using-claude.mdx"
```

---

### Task 3: Create `skills/mcp-servers.mdx`

**Files:**
- Create: `apps/docs/content/docs/skills/mcp-servers.mdx`

**Step 1: Create the MCP servers page**

Create `apps/docs/content/docs/skills/mcp-servers.mdx`:

```mdx
---
title: MCP Servers
description: Configure Model Context Protocol servers to give Claude access to Figma files and up-to-date documentation.
---

## What are MCP servers?

MCP (Model Context Protocol) servers extend what Claude can do by connecting it to external tools and data sources. Instead of copying and pasting information into your conversation, MCP servers let Claude access it directly.

This template comes with two MCP servers pre-configured in `.claude/settings.json`:

- **Figma Dev Mode** — Claude can read your Figma files, inspect layers, and extract design tokens
- **Context7** — Claude gets up-to-date library documentation so it doesn't use outdated APIs

## Figma Dev Mode

The Figma MCP server lets Claude read your design files directly. When you say "look at my Figma file", Claude can actually inspect the layers, styles, and structure.

### Getting your API key

1. Open [Figma](https://www.figma.com) and log in
2. Click your profile icon in the top-left corner and select **Settings**
3. Scroll down to **Personal access tokens**
4. Click **Generate new token**
5. Give it a descriptive name (e.g., "Claude Code")
6. Copy the token — you won't be able to see it again

### Adding the key to your project

Open `.claude/settings.json` and paste your token into the `FIGMA_API_KEY` field:

```json
{
  "mcpServers": {
    "figma": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--stdio"],
      "env": {
        "FIGMA_API_KEY": "figd_your-token-here"
      }
    }
  }
}
```

> **Important:** `.claude/settings.json` is checked into git. If your repository is public, use `.claude/settings.local.json` instead — this file is gitignored and takes precedence over the shared config.

### Verifying it works

Start a Claude Code session and ask Claude to read a Figma file:

> "Look at this Figma file: https://www.figma.com/design/abc123/MyFile"

If configured correctly, Claude will describe the file's contents. If the key is missing or expired, you'll see an authentication error.

## Context7

Context7 fetches live documentation for libraries and frameworks. When Claude writes code that uses a library, Context7 ensures it references the current API — not a version from its training data.

### Configuration

No setup needed. Context7 works out of the box:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Context7 is maintained by [Upstash](https://upstash.com) and supports most popular JavaScript/TypeScript libraries.

## Troubleshooting

### "FIGMA_API_KEY is not set"

You haven't added your Figma API key yet. Follow the [setup steps above](#adding-the-key-to-your-project).

### "npx: command not found"

MCP servers use `npx` to run without installing globally. Make sure Node.js is installed:

```bash
node --version  # Should print v18 or higher
```

### Server not responding

MCP servers start on demand when Claude needs them. If a server isn't responding:

1. Check your internet connection — both servers fetch packages via npm
2. Try clearing the npx cache: `npx clear-npx-cache`
3. Restart your Claude Code session

### Figma token expired

Personal access tokens don't expire by default, but they can be revoked. If you get authentication errors with a previously working token, generate a new one in Figma settings.

## Adding your own MCP servers

You can add more MCP servers to `.claude/settings.json`. Each entry needs a `command` and `args` array:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "my-mcp-package", "--stdio"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

The `env` field is optional — only include it if the server requires environment variables.

Browse available MCP servers at the [MCP Server Registry](https://github.com/modelcontextprotocol/servers) or build your own following the [MCP specification](https://modelcontextprotocol.io).
```

**Step 2: Commit**

```bash
git add apps/docs/content/docs/skills/mcp-servers.mdx
git commit -m "docs: add MCP servers setup guide"
```

---

### Task 4: Update `meta.json` sidebar navigation

**Files:**
- Modify: `apps/docs/content/docs/meta.json`

**Step 1: Update meta.json**

Replace the entire contents of `apps/docs/content/docs/meta.json` with:

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
    "---Skills---",
    "skills/index",
    "skills/using-claude",
    "skills/mcp-servers",
    "---Project---",
    "project/versioning",
    "project/contributing"
  ]
}
```

Changes:
- `---AI Skills---` → `---Skills---`
- `ai/skills` → `skills/index`
- `ai/using-claude` → `skills/using-claude`
- Added `skills/mcp-servers`

**Step 2: Verify the dev server builds**

Run: `cd apps/docs && bun run build`
Expected: Build succeeds with no broken links or missing pages.

**Step 3: Commit**

```bash
git add apps/docs/content/docs/meta.json
git commit -m "docs: rename AI Skills section to Skills and update navigation"
```

---

### Task 5: Verify and final commit

**Step 1: Verify no references to old `ai/` paths remain**

Run: `grep -r "ai/skills\|ai/using-claude" apps/docs/`
Expected: No matches.

**Step 2: Run full build**

Run: `bun run build`
Expected: Clean build with no errors.

**Step 3: Verify the `ai/` directory is gone**

Run: `ls apps/docs/content/docs/ai/ 2>&1`
Expected: "No such file or directory"
