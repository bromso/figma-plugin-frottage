# LLM Stack Expansion — Design

**Date:** 2026-04-21
**Status:** Approved

## Summary

Expand the LLM tooling stack with additional MCP servers and skills. Core additions pre-configured, advanced ones documented as optional installs on a new docs page.

## Current State

- **Plugins:** superpowers
- **MCP Servers:** Figma Dev Mode, Context7
- **Skills:** build-figma-plugin, figma-api, figma-implement-design, figma-use, find-skills, frontend-design, shadcn, skill-creator, template-skill

## Additions

### Pre-configured (added to `.claude/settings.json`)

- **Sequential Thinking** (`@anthropic/sequential-thinking-mcp`) — helps Claude reason through complex plugin logic step-by-step. Zero-config.

### Documented as optional installs (new docs page)

- **GitHub MCP** (`github/github-mcp-server`) — PR/issue management. Needs `GITHUB_PERSONAL_ACCESS_TOKEN`.
- **Playwright MCP** (`@anthropic/playwright-mcp` or `@playwright/mcp`) — browser automation and testing. Power user tool.
- **Exa MCP** (`exa-mcp-server`) — semantic web search for deeper research. Needs `EXA_API_KEY`.
- **Memory MCP** (`@anthropic/memory-mcp` or `@modelcontextprotocol/server-memory`) — persistent knowledge graph across sessions. Zero-config.

### Documentation

Add a new docs page at `ai/llm-stack.mdx` (or similar) documenting:
- What's pre-configured and why
- Each optional tool with: what it does, who it's for, setup steps, example usage
- Written for mixed audience (non-coders + power users, clearly labeled)
