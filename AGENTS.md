# AGENTS.md

## Project Overview

Leapsake is a privacy-first contact management app that stores your contacts as JSContact files you own and control. Sync across devices peer-to-peer with no vendor lock-in. Building contact management first, with plans to expand to general file sync later.

## Core Philosophy

- **Offline-first**: Each client operates completely standalone
- **Privacy-respecting**: No vendor lock-in, user controls data location
- **Open standards**: JSContact for contacts, with plans to support other open formats
- **File-as-database**: Filesystem is source of truth, database is just a search index
- **Cross-platform**: Currently desktop, with plans to extend to mobile, Progressive Web App, and hosted web
- **P2P sync**: Direct device-to-device sync with optional server backup (future)

## Technology Stack

### Current

#### Desktop App (`apps/client-desktop/`)
- **Framework**: Tauri (Rust backend + Preact frontend)
- **Styling**: CSS Modules
- **Capabilities**: Full filesystem access, background file watching, system integration

### Coming Soon

#### Mobile App (`apps/client-mobile/`)
- **Framework**: React Native + Expo
- **Constraints**: App sandbox storage, manual file selection, sync when possible

#### Web App (`apps/client-web/`)
- **Framework**: Astro + Preact + CSS Modules
- **Features**: PWA support, progressive enhancement, minimal client-side JS

### Shared Packages

#### Current
- **`packages/leapsake-core/`**: Core contact management logic (Rust)

#### Coming Soon
- **`packages/components/`**: Platform-specific UI components
- **`packages/design-tokens/`**: Design system tokens with Rust generator (Future)

## Architecture Decisions

### File-as-Database Approach

Contacts (JSContact files) are the source of truth. Metadata is stored using:
1. **Extended attributes** (preferred) - metadata travels with files
2. **Sidecar files** (fallback) - `.filename.metadata.json` files
3. **Directory metadata** (optional) - `.file-metadata.json` in directories

The "database" is a rebuildable search index for performance, not functionality.

### Event-Driven Architecture

Operations are structured around events from the start to enable future sync capabilities. Events capture state changes (contact added/modified/deleted, tags changed) and can be applied to reconstruct state.

### Storage Approach

Storage operations are designed as pure functions where possible, with side effects (I/O, mutations) isolated at the boundaries. This enables easier testing, better traceability, and natural sync patterns.

## Development Strategy

### Current Phase: Contact Management MVP

Focus entirely on local contact management experience using JSContact files that work everywhere). Build:
- JSContact import/export
- vCard import/export
- Contact organization with tags
- Search and filtering
- Birthday and special day reminders
- App-managed storage location (e.g., `~/Library/Application Support/Leapsake/contacts/`)

This proves the file-as-database architecture with structured text files before expanding to other content types.

### Future Phases

1. **P2P sync** - Device-to-device contact sync with CRDTs, optional server backup
2. **User-managed locations** - Allow users to choose where contacts are stored
3. **Mobile adaptation** - Adapt core experience to mobile constraints
4. **Web app** - Progressive enhancement with PWA capabilities
5. **Photos content type** - Add photo management using same architecture
6. **Documents content type** - Add document management
7. **General file sync** - Arbitrary files in arbitrary user-specified locations

## Repository Structure

```
leapsake/
├── apps/
│   ├── client-desktop/           # Tauri + Preact
│   ├── client-mobile/            # React Native + Expo (future)
│   └── client-web/               # Astro + Preact (future)
├── packages/
│   ├── leapsake-core/            # Core Rust business logic
│   ├── components/               # Cross-platform UI (future)
│   ├── design-tokens/            # Design system (future)
│   └── build-tools/              # Rust utilities (future)
├── tools/
│   ├── scripts/
│   └── config/
├── Makefile                      # Unified build commands
├── package.json                  # PNPM workspace root
├── pnpm-workspace.yaml          # PNPM configuration
└── Cargo.toml                   # Rust workspace root
```

## Build System

### Package Managers
- **PNPM**: JavaScript/TypeScript packages and workspaces
- **Cargo**: Rust crates and workspace

### Unified Commands
```bash
make install    # Install all dependencies
make dev        # Start desktop app in development
make build      # Build all packages and apps
make test       # Run all tests
make clean      # Clean build artifacts
```

## Testing Strategy

### Rust Core (`packages/leapsake-core/`)
- **Unit tests**: Cargo's built-in test framework
- **Property-based tests**: proptest or quickcheck (for sync logic, future)

### Desktop App (`apps/client-desktop/`)
- **E2E tests**: Tauri WebDriver or Playwright
- **Integration tests**: Test Rust backend + frontend integration

### Mobile App (`apps/client-mobile/`)
- **E2E tests**: Detox or Maestro

### Web App (`apps/client-web/`)
- **E2E tests**: Playwright (with/without JavaScript for progressive enhancement)

### Shared Components (`packages/components/`)
- **Visual regression**: Storybook + Playwright

## Key Technical Decisions

### Why These Technologies?
- **Tauri**: Performance, small bundle size, native capabilities
- **Preact**: Minimal bundle, React compatibility, progressive enhancement friendly
- **Rust**: Performance for file operations, memory safety, cross-platform, excellent functional programming support
- **CSS Modules**: Scoped styling, no runtime overhead
- **Extended Attributes**: Metadata travels with files, no external dependencies
- **vCard Standard**: Open format, widely supported, human-readable

### Why Functional-First?
- **Testability**: Pure functions need no mocks, easier to test
- **Traceability**: Clear input → output paths, easier to debug
- **Reliability**: No hidden state changes, fewer bugs
- **Parallelization**: Pure functions are thread-safe by default
- **Sync-friendly**: State + events model naturally supports sync

OOP is used sparingly for platform integration (trait implementations), resource management (RAII patterns), and builder patterns.

### Storage Architecture

Built with future sync in mind using pure functions and clear data flow. Pure business logic handles state transformations and event generation, effect handlers manage I/O at the boundaries, and minimal OOP handles platform integration (Tauri commands, React Native bridges, OS-specific APIs).

## Current Status

**Completed**: Basic monorepo structure with Tauri desktop app that imports shared Rust business logic from `leapsake-core` package.

**Next Steps**: Implement core contact management features (JSContact import/export, vCard import/export, tagging, search, reminders) in the desktop app.

## Development Guidelines

### Code Organization
- Keep business logic as pure functions in Rust (`leapsake-core`)
- UI components should be primarily presentational and composable
- Isolate side effects (I/O, mutations) at the boundaries
- Design for rebuild-ability - database should be recreatable from filesystem

### Functional Programming Practices
- Prefer pure functions with explicit inputs and outputs
- Use immutable data structures
- Return new state rather than mutating existing state
- Compose small functions into larger operations
- Keep side effects at the edges of the system

### Sync Preparation
Even though sync isn't implemented yet:
- Use global IDs (UUIDs), not filesystem paths
- Structure around events
- Design storage operations as pure functions where possible
- Event sourcing enables future sync capabilities

### Progressive Enhancement
Web components should work without JavaScript, enhanced with JavaScript when available.

## Expansion Path

The contact management focus is deliberate and strategic:

1. **Contacts** (current) - Prove architecture with structured text files
2. **Tasks** (next) - Create "To Do" functionality for custom tasks and automatically generated reminders (e.g. birthdays).
3. **Photos** - Add binary file support, similar metadata needs
4. **Documents** - More complex file types, richer metadata
5. **General files** - Arbitrary files in user-specified locations

Each phase builds on the previous, expanding capabilities while maintaining the core file-as-database, privacy-first, functional architecture.
