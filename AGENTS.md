# AGENTS.md

## Project Overview

Leapsake is a privacy-first people management app. Sync across devices peer-to-peer with no vendor lock-in. Building people management first, with plans to expand to tasks, photos, documents, and general file sync later.

## Core Philosophy

- **Offline-first**: Each client operates completely standalone
- **Privacy-respecting**: No vendor lock-in, user controls their data
- **Portable data**: Full import/export support via open standards (JSContact, vCard)
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
- **`packages/db/`**: Database schema, migrations, and queries (Rust)
- **`packages/leapsake-core/`**: Core business logic (Rust) — may be refocused or split in the future
- **`packages/components/`**: Platform-specific UI components

#### Coming Soon
- **`packages/file-io/`**: Import/export logic for JSContact, vCard, and other formats (Rust)
- **`packages/design-tokens/`**: Design system tokens with Rust generator

## Architecture Decisions

### SQLite as Source of Truth

SQLite is the canonical data store. This decision evolved from an earlier "file-as-database" approach where JSContact/vCard files were the source of truth with SQLite as a rebuildable index. We moved to SQLite-first because:

- **Query performance**: Direct SQL queries without parsing files
- **Field-level operations**: Essential for CRDT-based sync
- **Storage efficiency**: No duplication between files and index
- **Conflict resolution**: Field-level merging instead of whole-file replacement

Open standards (JSContact, vCard) remain important for **import/export and interoperability**, not as the storage format. The data model maintains compatibility with JSContact/vCard fields to ensure lossless round-trips.

Binary files (photos, documents) are stored on disk with references in SQLite.

### Database Architecture

#### Schema Conventions
- Table names: plural `snake_case` (e.g., `people`, `email_addresses`, `tags`)
- Primary keys: UUIDs stored as TEXT
- Machine timestamps: INTEGER (Unix epoch, milliseconds for events)
- User-facing dates: TEXT (ISO 8601, e.g., `1990-05-15`)

#### Migrations
Hand-rolled migrations using embedded SQL files:
```
packages/db/
├── src/
│   └── ...
└── migrations/
    ├── 001_initial_schema.sql
    ├── 002_add_tags.sql
    └── ...
```

Migrations are tracked in a `migrations` table and applied automatically on startup.

#### Crate Structure
- **`packages/db/`**: Schema definitions, migrations, and query functions
- Used by all client apps (desktop, mobile, web via wasm)
- Uses `rusqlite` with the `bundled` feature for consistent cross-platform behavior

### Event Sourcing (Day 2)

The current architecture uses direct SQLite mutations. The next phase introduces event sourcing to enable P2P sync:

#### How It Works
1. **Event log**: Append-only table recording every state change
2. **State tables**: Materialized views derived from events (the current SQLite tables)
3. **Sync**: Devices exchange events they're missing, merge via CRDT rules

#### Why Event Sourcing?
- **Field-level sync**: Events like "set phone to X" merge cleanly
- **Conflict resolution**: Timestamp + device ID determines winner
- **History**: Full audit trail of changes
- **Rebuild**: State can be reconstructed by replaying events

#### Performance
- SQLite state persists between sessions (no replay on startup)
- Only new events since last session are applied
- Full replay only on new device setup or corruption recovery

#### Event Types (Planned)
```rust
enum PersonEvent {
    Created { person_id: Uuid },
    Deleted { person_id: Uuid },
    FieldSet { person_id: Uuid, field: String, value: Option<String> },
    TagAdded { person_id: Uuid, tag: String },
    TagRemoved { person_id: Uuid, tag: String },
}
```

### Storage Approach

Storage operations are designed as pure functions where possible, with side effects (I/O, mutations) isolated at the boundaries. This enables easier testing, better traceability, and natural sync patterns.

## Development Strategy

### Phase 1: People Management MVP (Current)

Focus on local people management experience. Build:
- Add/edit/delete people with full contact information
- Organization with tags
- Search and filtering
- Birthday and anniversary reminders
- JSContact and vCard import/export

### Phase 2: Event Sourcing

Add the event log infrastructure:
- Event table and types
- Migrate mutations to event creation
- Backfill events for existing data

### Phase 3: P2P Sync

Device-to-device sync:
- Sync protocol (exchange missing events)
- CRDT merge rules
- Conflict resolution UI (if needed)
- Optional server backup

### Future Phases

- **Tasks**: To-do functionality for custom tasks and auto-generated reminders (e.g., birthdays)
- **User-managed locations**: Allow users to choose where data is stored
- **Mobile adaptation**: Adapt core experience to mobile constraints
- **Web app**: Progressive enhancement with PWA capabilities
- **Photos**: Binary file support with metadata
- **Documents**: More complex file types, richer metadata
- **General file sync**: Arbitrary files in user-specified locations

## Repository Structure

```
leapsake/
├── apps/
│   ├── client-desktop/           # Tauri + Preact
│   ├── client-mobile/            # React Native + Expo (future)
│   └── client-web/               # Astro + Preact (future)
├── packages/
│   ├── db/                       # SQLite schema, migrations, queries
│   ├── leapsake-core/            # Core Rust business logic
│   ├── file-io/                  # Import/export (JSContact, vCard) (future)
│   ├── components/               # Cross-platform UI (future)
│   ├── design-tokens/            # Design system (future)
│   └── build-tools/              # Rust utilities (future)
├── tools/
│   ├── scripts/
│   └── config/
├── Makefile                      # Unified build commands
├── package.json                  # PNPM workspace root
├── pnpm-workspace.yaml           # PNPM configuration
└── Cargo.toml                    # Rust workspace root
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

### Database (`packages/db/`)
- **Unit tests**: Query functions with in-memory SQLite
- **Migration tests**: Verify migrations apply cleanly

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
- **SQLite**: Reliable, embedded, excellent cross-platform support, single-file database
- **CSS Modules**: Scoped styling, no runtime overhead

### Why Functional-First?
- **Testability**: Pure functions need no mocks, easier to test
- **Traceability**: Clear input → output paths, easier to debug
- **Reliability**: No hidden state changes, fewer bugs
- **Parallelization**: Pure functions are thread-safe by default
- **Sync-friendly**: State + events model naturally supports sync

OOP is used sparingly for platform integration (trait implementations), resource management (RAII patterns), and builder patterns.

### Import/Export Compatibility

The data model is designed for lossless round-trips with JSContact and vCard:
- All standard fields are supported
- Custom/extended fields are preserved
- Import detects format automatically
- Export to either format on demand

## Current Status

**Completed**: Basic monorepo structure with Tauri desktop app.

**In Progress**: Database schema and migration infrastructure (`packages/db/`).

**Next Steps**: Implement core people management features (CRUD, tagging, search, reminders) in the desktop app.

## Development Guidelines

### Code Organization
- Keep business logic as pure functions in Rust
- UI components should be primarily presentational and composable
- Isolate side effects (I/O, mutations) at the boundaries
- Database queries live in `packages/db/`, business logic in `packages/leapsake-core/`

### Functional Programming Practices
- Prefer pure functions with explicit inputs and outputs
- Use immutable data structures
- Return new state rather than mutating existing state
- Compose small functions into larger operations
- Keep side effects at the edges of the system

### Sync Preparation
Even though sync isn't implemented yet:
- Use UUIDs as primary keys, not auto-increment integers
- Design with event sourcing in mind (mutations will become events)
- Keep state derivable from events

### Progressive Enhancement
Web components should work without JavaScript, enhanced with JavaScript when available.

## Expansion Path

1. **People** (current) — Core data model and local management
2. **Events** (next) — Event sourcing infrastructure for sync
3. **Tasks** — To-do functionality, reminders
4. **Photos** — Binary file support
5. **Documents** — Richer file types and metadata
6. **General files** — Arbitrary files in user-specified locations

Each phase builds on the previous, expanding capabilities while maintaining the privacy-first, functional architecture.
