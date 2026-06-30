# Architecture

## V0.1 Product Shape

```text
Claude Code
  -> http://127.0.0.1:17860/anthropic
  -> DeepSeek Anthropic-compatible API
  -> response usage metadata
  -> local JSONL event store
  -> Doctor rules
  -> tray popover / local web panel
```

The project starts with Electron so macOS and Windows can share the same proxy, storage, diagnostics, and renderer code. The core modules are plain Node.js so they can later be reused by a Tauri app or CLI.

## Modules

- `src/proxy-server.js`: local HTTP server, API routes, static UI, and upstream proxying.
- `src/usage-parser.js`: provider response normalization.
- `src/store.js`: JSONL metadata event store.
- `src/doctor.js`: diagnosis rules.
- `src/repair.js`: safe claude-mem scans and repair actions.
- `src/main.js`: Electron tray and popover shell.
- `src/renderer/*`: translucent popover UI.

## Platform Boundary

- macOS: menu bar popover, hover/click opening, `memory_pressure` for realistic memory pressure display.
- Windows: Electron tray and local web panel, direct Claude Code config, CC Switch deep-link import, and graceful fallback when `sqlite3` is unavailable.
- CC Switch DB cloning is optional. The safer cross-platform path is deep-link import or direct Claude Code config.

## Privacy Boundary

The proxy has to transiently pass request and response bytes through memory, but it does not persist prompt text or model output. Stored events are restricted to usage metadata, status codes, latency, and provider/model names.

Repair actions only touch known claude-mem cache/log/temp paths or the `enabledPlugins["claude-mem@thedotmack"]` flag in Claude settings, and settings edits create backups. Automatic actions are limited to safe pre-checks; destructive actions require confirmation.
