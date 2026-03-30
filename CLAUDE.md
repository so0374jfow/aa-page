# CLAUDE.md

This file provides guidance for AI assistants working with the `aa-page` repository.

## Repository Overview

This is a newly initialized repository. As the project develops, this document should be updated to reflect the actual codebase structure, conventions, and workflows.

## Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd aa-page

# Install dependencies (update once a package manager is chosen)
# npm install / yarn install / pnpm install
```

## Project Structure

```
aa-page/
├── CLAUDE.md          # AI assistant guidance (this file)
└── ...                # Project files to be added
```

## Development Workflow

### Branching

- The default branch is `main`
- Feature branches should use descriptive names (e.g., `feature/add-login`, `fix/header-styling`)
- Create pull requests for all changes targeting `main`

### Commits

- Write clear, concise commit messages
- Use conventional commit format when applicable (e.g., `feat:`, `fix:`, `docs:`, `chore:`)

## Conventions

> Update this section as project conventions are established.

- **Language/Framework**: TBD
- **Styling**: TBD
- **Testing**: TBD
- **Linting/Formatting**: TBD

## Common Commands

> Update this section as the project build system is configured.

```bash
# Build
# npm run build

# Dev server
# npm run dev

# Run tests
# npm test

# Lint
# npm run lint
```

## Notes for AI Assistants

- Read relevant source files before making changes
- Run tests after making code changes to verify correctness
- Follow existing code style and patterns found in the codebase
- Do not introduce new dependencies without justification
- Keep changes focused and minimal — avoid unrelated refactors
