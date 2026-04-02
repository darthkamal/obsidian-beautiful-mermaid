# Changelog

## 1.0.10 — 2026-04-02

- **Fix:** Beautiful Mermaid now renders in Live Preview mode. Obsidian's CM6 extension intercepts mermaid code blocks before `registerMarkdownCodeBlockProcessor` runs, so a `MutationObserver` now watches for `.cm-lang-mermaid` embed blocks, extracts the source via `posAtDOM`, and replaces the default SVG with our renderer. Both Reading Mode and Live Preview now use beautiful-mermaid consistently.

## 1.0.9 — 2026-04-02

- **Fix:** Live Preview now works without a custom CM6 extension — `registerMarkdownCodeBlockProcessor` handles both Reading Mode and Live Preview natively in Obsidian 1.4+. The previous CM6 `ViewPlugin` with `block: true` decorations was forbidden by Obsidian's CM6 fork, causing a "failed to open the file" crash. The custom extension has been removed entirely.

## 1.0.8 — 2026-04-02

- **Fix:** Excalidraw export `source` field corrected to `https://excalidraw.com` (was `"beautiful-mermaid"`, which caused the Obsidian plugin to reject the file)
- **Fix:** Arrow bindings now registered on both source and target shapes via `fixBindings` post-pass — arrows no longer detach when shapes are moved
- **Fix:** Arrow `width`/`height` now uses skeleton-provided dimensions when available, falling back to point offsets — fixes curved and multi-segment arrow geometry
- **Fix:** SVG base64 re-encoding uses `TextDecoder`/`TextEncoder` for safe Unicode round-trips — prevents corruption of multi-byte characters in embedded SVGs
- **Fix:** Excalidraw button now shows `✓` on success and `✗` on failure (previously only showed `✗` on failure)

## 1.0.7 — 2026-04-01

- **Fix:** Corrected `manifest.json` author metadata (`darthkamal`) and `authorUrl` for community plugin submission

## 1.0.6 — 2026-04-01

- **Fix:** Disabled Live Preview CM6 extension — it caused a "failed to open the file" crash that persisted even with defensive try/catch wrappers. The `ViewPlugin` with `block: true` decorations triggers an error inside CM6's internal decoration resolution that Obsidian surfaces as a file-open failure. Reading Mode rendering is fully functional. Live Preview will be re-added once the root cause is diagnosed.

## 1.0.5 — 2026-03-31

- **Fix:** Live Preview crash still occurring after 1.0.4 — added defensive try/catch in the `ViewPlugin` constructor and `update` method so any runtime error in `buildDecorations` is caught and logged to the console instead of crashing the editor; also wrapped `MermaidWidget.toDOM()` so a render failure shows an inline error message rather than propagating

## 1.0.4 — 2026-03-31

- **Fix:** Live Preview crash ("failed to open the file") — removed `Prec.highest` wrapper which referenced an unexported symbol from Obsidian's bundled `@codemirror/state`; the `ViewPlugin` now registers directly without priority wrapping

## 1.0.3 — 2026-03-31

- **Feature:** Live Preview support — diagrams now render inline in the editor (Edit/Live Preview mode) using a CodeMirror 6 widget extension. Clicking the diagram body places the cursor inside and reveals the raw source for editing; clicking toolbar buttons works without affecting the cursor.

## 1.0.2 — 2026-03-31

- **Feature:** Excalidraw export now uses `@excalidraw/mermaid-to-excalidraw` to produce fully editable shapes (nodes, arrows, labels) instead of an SVG image embed. Supports flowchart, sequence, class, ER, and state diagrams. Unsupported diagram types fall back gracefully to an SVG image element.

## 1.0.1 — 2026-03-31

- **Fix:** Removed `will-change: transform` from viewport — browser now re-renders SVG vectors crisply at each zoom level instead of scaling a cached GPU texture
- **Fix:** Trackpad behavior now matches conventions: two-finger swipe pans the diagram, pinch gesture zooms (browser sets `ctrlKey` on pinch wheel events)
- **Feature:** Added Excalidraw export button to toolbar — creates a `.excalidraw` file in the vault root with the diagram embedded as a crisp SVG image element and opens it immediately

## 1.0.0 — 2026-03-31

- Initial release
- Overrides Obsidian's built-in mermaid renderer with beautiful-mermaid SVG output
- Auto mode follows vault light/dark theme via CSS variables — updates live on theme toggle
- 15 built-in themes (9 dark, 6 light)
- Pan and zoom with toolbar buttons (−, ⊙, +), scroll wheel, pinch, and double-click to reset
- Copy diagram as SVG or PNG (2× resolution) from toolbar
- Configurable font family and transparent background option
- Error state shows styled message alongside raw source for easy debugging
