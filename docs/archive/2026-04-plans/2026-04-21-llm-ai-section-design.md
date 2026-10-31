# LLM / AI Section Redesign — Design

**Date:** 2026-04-21
**Status:** Approved

## Summary

Rename the "Skills" docs section to "LLM / AI", move files from `skills/` to `ai/` URL paths, add new "Agents" and "Plugins" pages written for a non-coding audience.

## Changes

### Folder rename: skills/ → ai/

- `skills/index.mdx` → `ai/skills.mdx`
- `skills/using-claude.mdx` → `ai/using-claude.mdx`
- `skills/mcp-servers.mdx` → `ai/mcp-servers.mdx`

### meta.json update

Rename section `---Skills---` → `---LLM / AI---`, update paths, reorder, add new entries:

```
---LLM / AI---
ai/using-claude
ai/skills
ai/agents
ai/plugins
ai/mcp-servers
```

### New page: ai/agents.mdx

Non-technical explanation of AI agents for non-coders:
- What agents are ("AI helpers with specialized jobs")
- How they work together when you describe a plugin
- What happens behind the scenes in plain language
- Examples of what each helper does (reads Figma, writes code, checks quality)

### New page: ai/plugins.mdx

Non-technical explanation of Claude Code plugins for non-coders:
- What plugins are ("add-ons that give Claude new abilities")
- What comes pre-installed (superpowers)
- How to find and install more
- Framed as extending your AI assistant's toolkit

### Fix internal links

Update any references to old `skills/` paths (e.g., in index.mdx, getting-started/index.mdx).
