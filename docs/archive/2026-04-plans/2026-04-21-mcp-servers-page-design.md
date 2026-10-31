# MCP Servers Documentation Page Design

**Date:** 2026-04-21
**Status:** Approved

## Summary

Create a dedicated MCP servers documentation page and reorganize the "AI Skills" section into "Skills" with cleaner URL paths.

## Changes

### File moves

- `ai/skills.mdx` -> `skills/index.mdx` (rename title from "AI Skills" to "Skills")
- `ai/using-claude.mdx` -> `skills/using-claude.mdx`
- New file: `skills/mcp-servers.mdx`
- Delete `ai/` folder after moves

### Sidebar update (meta.json)

- Rename section heading `---AI Skills---` to `---Skills---`
- Update paths from `ai/` to `skills/`
- Add `skills/mcp-servers` entry

### Skills page edits

Remove the MCP servers section (lines 42-47) from the skills page. Update title from "AI Skills" to "Skills".

### New MCP servers page structure

1. **What are MCP servers?** - Brief explanation of Model Context Protocol, why it matters for plugin development with Claude
2. **Pre-configured servers** - subsections:
   - **Figma Dev Mode** - what it does, step-by-step for getting a Figma API key (Personal Access Token), where to paste it in `.claude/settings.json`, verify it works
   - **Context7** - what it does, zero-config, what it provides
3. **Troubleshooting** - common issues (expired API key, npx not found, server not responding)
4. **Adding your own MCP servers** - config format in `.claude/settings.json`, example entry, link to MCP resources
