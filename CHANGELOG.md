# Changelog

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
