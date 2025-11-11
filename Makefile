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
dev-desktop:
	cd apps/client-desktop && pnpm tauri dev
dev-leapsakecom:
	cd apps/leapsake.com && pnpm dev
dev-mobile:
	cd apps/client-mobile && pnpm expo start --dev-client
dev-mobile-android:
	cd apps/client-mobile && pnpm run android
dev-mobile-ios:
	cd apps/client-mobile && pnpm run ios
dev:
	@make dev-desktop &
	@make dev-mobile &
	@make dev-leapsakecom &
	@wait

# Build everything
build-desktop:
	cargo build --workspace --release
	pnpm -r build

build-mobile-android:
	cd apps/client-mobile && pnpm run android --variant=release

build-mobile-ios:
	cd apps/client-mobile && pnpm run ios --configuration Release

build:
	@make build-desktop

# Run all tests
test-desktop:
	cargo test --workspace
	cargo clippy --workspace -- -D warnings
	pnpm -r test

test:
	@make test-desktop

# Clean build artifacts
clean:
	cargo clean
	pnpm -r clean
	rm -rf node_modules
	rm -rf apps/*/node_modules
	rm -rf packages/*/node_modules
