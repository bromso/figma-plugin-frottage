# LLM / AI Section Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename "Skills" section to "LLM / AI", move files from `skills/` to `ai/`, and add Agents and Plugins pages for a non-coding audience.

**Architecture:** Move existing MDX files, create two new pages with beginner-friendly content, update sidebar navigation and internal links.

**Tech Stack:** Fumadocs (MDX), Next.js 15

---

### Task 1: Move `skills/index.mdx` to `ai/skills.mdx`

**Files:**
- Create: `apps/docs/content/docs/ai/skills.mdx`
- Delete: `apps/docs/content/docs/skills/index.mdx`

**Step 1: Create `ai/skills.mdx`**

Copy `apps/docs/content/docs/skills/index.mdx` to `apps/docs/content/docs/ai/skills.mdx`. No content changes needed — the title stays "Skills".

**Step 2: Delete the original**

Run: `rm apps/docs/content/docs/skills/index.mdx`

**Step 3: Commit**

```bash
git add apps/docs/content/docs/ai/skills.mdx
git rm apps/docs/content/docs/skills/index.mdx
git commit -m "docs: move skills/index.mdx to ai/skills.mdx"
```

---

### Task 2: Move `skills/using-claude.mdx` to `ai/using-claude.mdx`

**Files:**
- Create: `apps/docs/content/docs/ai/using-claude.mdx`
- Delete: `apps/docs/content/docs/skills/using-claude.mdx`

**Step 1: Copy the file**

Run: `cp apps/docs/content/docs/skills/using-claude.mdx apps/docs/content/docs/ai/using-claude.mdx`

No content changes.

**Step 2: Delete the original**

Run: `rm apps/docs/content/docs/skills/using-claude.mdx`

**Step 3: Commit**

```bash
git add apps/docs/content/docs/ai/using-claude.mdx
git rm apps/docs/content/docs/skills/using-claude.mdx
git commit -m "docs: move skills/using-claude.mdx to ai/using-claude.mdx"
```

---

### Task 3: Move `skills/mcp-servers.mdx` to `ai/mcp-servers.mdx`

**Files:**
- Create: `apps/docs/content/docs/ai/mcp-servers.mdx`
- Delete: `apps/docs/content/docs/skills/mcp-servers.mdx`

**Step 1: Copy the file**

Run: `cp apps/docs/content/docs/skills/mcp-servers.mdx apps/docs/content/docs/ai/mcp-servers.mdx`

No content changes.

**Step 2: Delete the original and remove empty directory**

```bash
rm apps/docs/content/docs/skills/mcp-servers.mdx
rmdir apps/docs/content/docs/skills
```

**Step 3: Commit**

```bash
git add apps/docs/content/docs/ai/mcp-servers.mdx
git rm apps/docs/content/docs/skills/mcp-servers.mdx
git commit -m "docs: move skills/mcp-servers.mdx to ai/mcp-servers.mdx"
```

---

### Task 4: Create `ai/agents.mdx`

**Files:**
- Create: `apps/docs/content/docs/ai/agents.mdx`

**Step 1: Create the agents page**

Create `apps/docs/content/docs/ai/agents.mdx` with this content:

```mdx
---
title: Agents
description: How AI helpers work together behind the scenes to build your Figma plugin.
---

## What are agents?

When you describe a plugin to Claude, it doesn't do everything alone. It sends specialized helpers — called **agents** — to handle different parts of the job. Each agent is good at one thing, and they work together to deliver your finished plugin.

Think of it like a small team: one person reads the blueprint, another writes the code, and a third checks the work.

## How agents build your plugin

Here's what happens behind the scenes when you say something like *"Build a plugin that renames selected layers to lowercase"*:

### 1. Understanding your idea

Claude starts by figuring out exactly what you need. It asks clarifying questions if anything is ambiguous — just like a designer would before starting a project.

### 2. Exploring the codebase

An **explorer agent** scans the project files to understand the current state — what code already exists, what components are available, and where changes need to happen.

### 3. Writing the code

An **implementer agent** writes the actual plugin code. It creates the Figma API logic, the React UI, and the message types that connect them. It follows the patterns already established in the template.

### 4. Reviewing the work

A **reviewer agent** checks the code for mistakes, missing pieces, and quality issues. If something isn't right, the implementer fixes it before you ever see it.

### 5. Building and testing

Claude runs the build process to make sure everything compiles without errors. If the build fails, it diagnoses and fixes the problem automatically.

## You don't need to manage agents

Agents work automatically — you never need to tell Claude which agent to use or how to coordinate them. Just describe what you want and let Claude handle the rest.

The only time you'll notice agents is in Claude's status messages, where you might see things like "Exploring codebase..." or "Reviewing implementation..." as different helpers take turns.

## What makes agents useful

- **Fresh perspective** — Each agent starts with a clean slate, so mistakes don't carry over
- **Specialized knowledge** — The reviewer catches issues the implementer might miss
- **Parallel work** — Some agents can work at the same time, making things faster
- **Quality checks** — Your code gets reviewed before it's presented to you
```

**Step 2: Commit**

```bash
git add apps/docs/content/docs/ai/agents.mdx
git commit -m "docs: add agents page explaining AI helpers for non-coders"
```

---

### Task 5: Create `ai/plugins.mdx`

**Files:**
- Create: `apps/docs/content/docs/ai/plugins.mdx`

**Step 1: Create the plugins page**

Create `apps/docs/content/docs/ai/plugins.mdx` with this content:

```mdx
---
title: Plugins
description: Add-ons that extend what Claude Code can do in your project.
---

## What are Claude Code plugins?

Plugins are add-ons that give Claude new abilities. Without plugins, Claude is a general-purpose AI assistant. With the right plugins installed, it becomes a specialist — in this case, a Figma plugin developer.

Think of plugins like apps on your phone: your phone works fine without them, but installing the right apps makes it much more useful for specific tasks.

## What's pre-installed

This template comes with one plugin already set up:

### Superpowers

The **superpowers** plugin adds structured workflows that help Claude work more carefully:

- **Brainstorming** — Claude explores your idea and asks good questions before jumping into code
- **Planning** — Claude breaks work into small, reviewable steps instead of doing everything at once
- **Code review** — Claude checks its own work for mistakes before showing it to you
- **Test-driven development** — Claude writes tests first to make sure the code actually works

Without this plugin, Claude would still write code — but it might skip important steps or make assumptions. Superpowers keeps it disciplined.

## Finding more plugins

If you want to extend Claude's abilities further, you can browse and install community plugins:

1. In Claude Code, type `/find-skills`
2. Describe what you're looking for (e.g., "help with animations" or "database support")
3. Claude will suggest relevant plugins you can install

You can also visit [skills.sh](https://skills.sh) to browse available plugins.

## How plugins are configured

Plugins are listed in `.claude/settings.json` under the `enabledPlugins` field. You don't normally need to edit this file — Claude handles installation for you. But if you're curious, this is what the current configuration looks like:

```json
{
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true
  }
}
```

Each plugin is identified by its name and source. The `true` value means it's active.
```

**Step 2: Commit**

```bash
git add apps/docs/content/docs/ai/plugins.mdx
git commit -m "docs: add plugins page explaining Claude Code add-ons for non-coders"
```

---

### Task 6: Update `meta.json` and fix internal links

**Files:**
- Modify: `apps/docs/content/docs/meta.json`
- Modify: `apps/docs/content/docs/index.mdx:26` — change `/docs/skills/using-claude` to `/docs/ai/using-claude`
- Modify: `apps/docs/content/docs/getting-started/index.mdx:58` — change `/docs/skills/using-claude` to `/docs/ai/using-claude`

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
    "---LLM / AI---",
    "ai/using-claude",
    "ai/skills",
    "ai/agents",
    "ai/plugins",
    "ai/mcp-servers",
    "---Project---",
    "project/versioning",
    "project/contributing"
  ]
}
```

**Step 2: Fix link in `index.mdx`**

In `apps/docs/content/docs/index.mdx` line 26, change:
`[Using Claude](/docs/skills/using-claude)` → `[Using Claude](/docs/ai/using-claude)`

**Step 3: Fix link in `getting-started/index.mdx`**

In `apps/docs/content/docs/getting-started/index.mdx` line 58, change:
`[Using Claude](/docs/skills/using-claude)` → `[Using Claude](/docs/ai/using-claude)`

**Step 4: Commit**

```bash
git add apps/docs/content/docs/meta.json apps/docs/content/docs/index.mdx apps/docs/content/docs/getting-started/index.mdx
git commit -m "docs: rename Skills section to LLM / AI and fix internal links"
```

---

### Task 7: Verify build and no broken references

**Step 1: Verify no references to old `skills/` paths remain**

Run: `grep -r "skills/using-claude\|skills/mcp-servers\|skills/index\|skills/agents\|skills/plugins" apps/docs/`
Expected: No matches.

**Step 2: Verify `skills/` directory is gone**

Run: `ls apps/docs/content/docs/skills/ 2>&1`
Expected: "No such file or directory"

**Step 3: Run full build**

Run: `cd apps/docs && bun run build`
Expected: Clean build with no errors. All pages render including new agents and plugins pages.
