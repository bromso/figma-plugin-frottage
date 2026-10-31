# Design: Skills, Agents & MCPs for Non-Programmer Plugin Development

**Date:** 2026-04-21
**Status:** Implemented

## Problem

The Figma plugin template is technically excellent but has a steep learning curve. A non-programmer faces monorepo concepts, two-process architecture, TypeScript generics, and zero guided onboarding. The gap between "I have a plugin idea" and "I have a working plugin" is too wide.

## Solution

Pre-install a curated set of skills and MCP servers so that cloning the repo + opening Claude Code = ready to build a plugin from a plain English description.

## What Was Added

### Custom Skill: `build-figma-plugin`
A single orchestrating skill that takes a non-programmer from idea to working plugin. Includes 4 reference docs covering architecture, Figma API patterns, UI components, and message passing.

### Off-the-Shelf Skills
- `frontend-design` (anthropics/skills) — polished UI generation
- `shadcn` (shadcn/ui) — correct component generation
- `find-skills` (vercel-labs/skills) — discover new capabilities
- `skill-creator` (anthropics/skills) — create custom skills

### MCP Servers
- Figma Dev Mode — read Figma files directly (requires API key)
- Context7 — fetch up-to-date library documentation

### CLAUDE.md
New "Building Your Plugin (No Coding Required)" section with quick start, example prompts, and skills reference.

### Removed
- Design-focused Figma skills (generate-library, create-new-file, code-connect, create-design-system-rules) — out of scope for plugin development
- Old `.agents/skills/figma-api/` directory (454 files) — replaced by skills-lock.json entry

## Target User

Complete non-programmer who describes what they want in natural language and has Claude build everything.
