# figma-plugin-template

## 1.3.0

### Minor Changes

- Phase 17: Type safety -- tsc pipeline, registerIcons API, StaticIconNameMap
- Phase 18: Bundle analysis report
- Phase 19: React 19 Compiler enabled via @rolldown/plugin-babel
- Phase 20: Interaction tests, polymorphic Type, Storybook play tests, DX docs
- Non-programmer skills toolkit (build-figma-plugin, frontend-design, shadcn)
- GitHub Actions CI + husky pre-commit hooks
- Changesets for automated versioning

### Patch Changes

- Update all packages to latest (Vite 8, @vitejs/plugin-react 6, @types/node 25, Biome 2.4.12)
- README badges (shields.io) replacing tech stack table
- Fix stale README references (apps/figma-plugin -> apps/design-plugin, react-figma-ui -> shadcn/ui)

## 1.2.0

### Minor Changes

- Vite 8 + TypeScript 6 + Figma typings upgrade
- React 19 migration
- Tailwind CSS 4.x + bundle analysis tooling
- shadcn/ui component migration (14 components)
- Storybook 10 upgrade
- Full-stack verification pass

## 1.1.0

### Minor Changes

- react-figma-ui integration
- Storybook setup with component stories
- Claude Skills optimization
- License, security, contributing docs

## 1.0.0

### Major Changes

- Initial monorepo scaffolding with Turborepo + Bun
- Package extraction (@repo/ui, @repo/common)
- Build pipeline verification (single-file HTML output)
- Biome + VS Code configuration
- Vitest + DX polish
