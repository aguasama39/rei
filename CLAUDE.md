# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start      # launch the app
npm run dev    # launch with --dev flag (enables DevTools via Ctrl+Shift+I)
```

## Architecture

This is a two-process Electron app with a strict context-isolation boundary.

**Main process** (`main.js`)
- Creates the `BrowserWindow` with `contextIsolation: true` and `nodeIntegration: false`
- Handles all Node.js / filesystem work via `ipcMain.handle`: file dialogs (`open-files`, `open-folder`), metadata parsing (`read-metadata` using `music-metadata`), and window control events
- `collectAudioFiles()` recursively walks a folder for supported extensions: mp3, flac, ogg, wav, aac, m4a

**Preload** (`preload.js`)
- Exposes a `window.api` object via `contextBridge` — the only safe bridge between renderer and main
- Any new IPC channel added in `main.js` must be exposed here before the renderer can use it

**Renderer** (`renderer/`)
- Pure browser JS + HTML + CSS, no bundler
- `renderer.js` holds all UI state: `playlist[]` (array of metadata objects), `currentIndex`, drag-reorder logic, and the HTML5 `<audio>` element controls
- Album art is delivered as a base64 `data:` URI from the main process
- Seek and volume bars use a CSS `linear-gradient` trick to show fill progress on the range input

## Key data flow

```
User picks files → main opens dialog → renderer calls window.api.readMetadata(path) per file
→ main parses tags with music-metadata → returns { title, artist, album, year, genre, duration, albumArt }
→ renderer pushes to playlist[] and re-renders
```

Audio playback uses a native `<audio>` element with `src="file:///..."` — no streaming proxy needed.
