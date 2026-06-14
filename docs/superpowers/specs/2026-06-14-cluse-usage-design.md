# Cluse Usage — Design

**Date:** 2026-06-14
**Status:** Approved

## Summary
A small synthwave-themed Electron desktop app that shows Claude Code token usage
**live** and lets the user filter by **project**, **session**, and **time range**.
Reads local logs only (`~/.claude/projects/*.jsonl`). No network, no API keys.

## Goals
- Live-updating window: numbers tick up while a Claude Code session is active.
- Filter/group by project or session; filter by time range (Today / 7d / 30d / All).
- Accurate, *billed-matching* token + cost figures.
- Looks cool: retro/synthwave (purple→pink sunset grid, neon bars).
- Packageable to a double-clickable `Cluse.exe`.

## Non-goals (keep it small)
- No historical database (re-read logs on demand).
- No charts beyond neon bars (no line graphs).
- No settings UI (pricing edited in a config file).
- No multi-machine sync.

## Architecture
Three small pieces:

1. **Reader/parser — `src/usage.js`**
   - Walks `~/.claude/projects/*/*.jsonl`.
   - Per line: extract `message.usage`, `message.model`, `timestamp`, `sessionId`,
     project (from `cwd`, fallback to decoded folder name).
   - **Dedup** by `message.id` (+ `requestId`) to match billed totals — this is why
     ccusage reports ~800M while a naïve sum reports ~1,360M. We dedup ccusage-style.
   - Aggregate into `{ project, session, model, input, output, cacheWrite5m,
     cacheWrite1h, cacheRead, cost, lastActivity }` rows.

2. **Live watcher — Electron main (`main.js`)**
   - `chokidar` watches the projects dir (recursive), ~1s debounce.
   - On change → re-read, recompute, push to renderer via IPC.
   - `● LIVE` indicator pulses when any activity in the last ~60s.

3. **Synthwave UI — renderer (`index.html` / `styles.css` / `renderer.js`)**
   - Big "today" totals (tokens + $).
   - Per-project / per-session neon bars, sorted by usage.
   - Controls: time-range buttons, Projects⇄Sessions toggle, name search box,
     cost on/off toggle.
   - Click a row → expand input/output/cache breakdown + per-model split.

## Cost calculation — `src/pricing.js`
Hardcoded per-model rates (USD per million tokens), editable in one file:

| Model | input | output | cache write (5m = 1.25×, 1h = 2×) | cache read (0.1×) |
|---|---|---|---|---|
| opus-4-8 | 15 | 75 | derived | derived |
| sonnet-4-6 | 3 | 15 | derived | derived |
| haiku-4-5 | 0.80 | 4 | derived | derived |
| fable-5 | placeholder (editable) | | | |

Cache write cost uses the `cache_creation.ephemeral_5m/1h` split when present
(5m = 1.25× input, 1h = 2× input). Cache read = 0.1× input. Cost is toggleable.

## Data flow
```
chokidar watch ──change──▶ usage.parse() ──rows──▶ IPC ──▶ renderer.render()
                                  ▲                              │
                          dedup by message.id            filters applied
                                                         (range/group/search)
```

## Packaging
- Dev: `npm start` (electron).
- Build: `npm run build` → `Cluse.exe` via `electron-builder` (Windows target).

## Files
```
cluse/
  package.json
  main.js          # Electron main + chokidar watcher + IPC
  preload.js       # contextBridge API
  src/
    usage.js       # parse + aggregate + dedup
    pricing.js     # editable model pricing
  renderer/
    index.html
    styles.css     # synthwave theme
    renderer.js    # render + filters
```

## Testing
- `src/usage.js` is pure (path in → rows out): unit-test against the real log dir,
  assert deduped totals are in the same ballpark as ccusage (~800M, not ~1,360M).
- Manual: launch, start a Claude Code session in another window, watch numbers tick.
