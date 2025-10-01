.PHONY: help install dev build test clean

# Default target shows available commands
help:
	@echo "Available commands:"
	@echo "  make install    - Install all dependencies"
	@echo "  make dev        - Start desktop app in development mode"
	@echo "  make build      - Build all packages and apps"
	@echo "  make test       - Run all tests"
	@echo "  make clean      - Clean all build artifacts"

# Install all dependencies
install:
	pnpm install
	cargo fetch

# Development mode
dev:
	cd apps/client-desktop && pnpm tauri dev

# Build everything
build:
	cargo build --workspace --release
	pnpm -r build

# Run all tests
test:
	cargo test --workspace
	cargo clippy --workspace -- -D warnings
	pnpm -r test

# Clean build artifacts
clean:
	cargo clean
	pnpm -r clean
	rm -rf node_modules
	rm -rf apps/*/node_modules
	rm -rf packages/*/node_modules
