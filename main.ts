import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
import type { RenderOptions, DiagramColors } from 'beautiful-mermaid';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// ============================================================
// Types & Constants
// ============================================================

type RenderMode = 'auto' | 'theme';

interface BeautifulMermaidSettings {
  renderMode: RenderMode;
  theme: string;
  font: string;
  transparent: boolean;
}

const DEFAULT_SETTINGS: BeautifulMermaidSettings = {
  renderMode: 'auto',
  theme: 'catppuccin-mocha',
  font: 'Inter',
  transparent: false,
};

/**
 * Maps Obsidian's CSS custom properties to beautiful-mermaid color roles.
 * Since the SVG is embedded in the DOM, these vars resolve against the
 * document — vault theme changes propagate automatically, no re-render needed.
 */
const OBSIDIAN_AUTO_COLORS: DiagramColors = {
  bg:      'var(--background-primary)',
  fg:      'var(--text-normal)',
  accent:  'var(--interactive-accent)',
  muted:   'var(--text-muted)',
  border:  'var(--background-modifier-border)',
  surface: 'var(--background-secondary)',
};

const THEME_NAMES_DARK  = [
  'zinc-dark', 'tokyo-night', 'tokyo-night-storm', 'catppuccin-mocha',
  'nord', 'dracula', 'one-dark', 'github-dark', 'solarized-dark',
];
const THEME_NAMES_LIGHT = [
  'zinc-light', 'tokyo-night-light', 'catppuccin-latte',
  'nord-light', 'github-light', 'solarized-light',
];

// ============================================================
// Plugin
// ============================================================

export default class BeautifulMermaidPlugin extends Plugin {
  settings: BeautifulMermaidSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Override Obsidian's built-in mermaid renderer in Reading Mode
    this.registerMarkdownCodeBlockProcessor('mermaid', (source, el) => {
      this.renderDiagram(source, el);
    });

    // Live Preview — disabled in 1.0.6 (causes "failed to open the file" crash in CM6).
    // The ViewPlugin with block:true decorations triggers an uncaught error inside
    // CM6's internal decoration resolution that Obsidian surfaces as a file-open
    // failure. Re-enable once root cause is identified.
    // this.registerEditorExtension(mermaidLivePreview(this));

    this.addSettingTab(new BeautifulMermaidSettingTab(this.app, this));
  }

  renderDiagram(source: string, el: HTMLElement): void {
    try {
      const options = this.buildRenderOptions();
      const svgString = renderMermaidSVG(source, options);

      // Parse SVG string into a real DOM node — avoids innerHTML on user-visible elements.
      // DOMParser never throws; instead it embeds a <parsererror> element on failure.
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

      if (svgDoc.querySelector('parsererror')) {
        throw new Error('SVG parse error — beautiful-mermaid returned malformed output.');
      }

      // Outer container holds both the pan/zoom area and the toolbar.
      // Keeping them separate means the toolbar is never clipped by overflow:hidden.
      const container = el.createDiv({ cls: 'beautiful-mermaid-container' });
      const wrapper = container.createDiv({ cls: 'beautiful-mermaid-diagram' });
      const viewport = wrapper.createDiv({ cls: 'beautiful-mermaid-viewport' });
      viewport.appendChild(viewport.ownerDocument.adoptNode(svgDoc.documentElement));

      this.attachPanZoom(wrapper, viewport);
      this.attachControls(container, wrapper, svgString, source);
    } catch (err) {
      const errorEl = el.createDiv({ cls: 'beautiful-mermaid-error' });
      errorEl.createEl('p', {
        text: '⚠ Beautiful Mermaid: Failed to render diagram.',
        cls: 'beautiful-mermaid-error-msg',
      });
      errorEl.createEl('pre', {
        text: source,
        cls: 'beautiful-mermaid-source',
      });
      console.error('[Beautiful Mermaid] Render error:', err);
    }
  }

  // ----------------------------------------------------------
  // Pan / zoom
  // ----------------------------------------------------------

  private attachPanZoom(wrapper: HTMLElement, viewport: HTMLElement): void {
    let x = 0, y = 0, scale = 1;
    let dragging = false;
    let originX = 0, originY = 0;

    const apply = () => {
      viewport.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    };

    const reset = () => { x = 0; y = 0; scale = 1; apply(); };

    const zoom = (delta: number, cx: number, cy: number) => {
      const factor = delta < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(Math.max(scale * factor, 0.15), 8);
      x = cx - (cx - x) * (next / scale);
      y = cy - (cy - y) * (next / scale);
      scale = next;
      apply();
    };

    // Wheel events: pinch gesture (ctrlKey set by browser) → zoom,
    // two-finger swipe → pan. This matches trackpad conventions.
    wrapper.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey) {
        const rect = wrapper.getBoundingClientRect();
        zoom(e.deltaY, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        x -= e.deltaX;
        y -= e.deltaY;
        apply();
      }
    }, { passive: false });

    // Drag-to-pan via Pointer Capture — works for mouse and touch, no document
    // listeners needed (capture keeps events flowing to this element).
    wrapper.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Ignore clicks on the controls overlay
      if ((e.target as HTMLElement).closest('.beautiful-mermaid-controls')) return;
      dragging = true;
      originX = e.clientX - x;
      originY = e.clientY - y;
      wrapper.setPointerCapture(e.pointerId);
      wrapper.classList.add('is-panning');
    });

    wrapper.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      x = e.clientX - originX;
      y = e.clientY - originY;
      apply();
    });

    const stopDrag = () => { dragging = false; wrapper.classList.remove('is-panning'); };
    wrapper.addEventListener('pointerup', stopDrag);
    wrapper.addEventListener('pointercancel', stopDrag);
    // lostpointercapture fires if the OS cancels capture mid-drag (e.g. window focus loss)
    wrapper.addEventListener('lostpointercapture', stopDrag);

    // Double-click resets zoom and position
    wrapper.addEventListener('dblclick', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.beautiful-mermaid-controls')) return;
      reset();
    });

    // Expose reset and zoom so toolbar buttons can call them
    (wrapper as any)._bmReset = reset;
    (wrapper as any)._bmZoom = zoom;
  }

  // ----------------------------------------------------------
  // Controls overlay (reset, copy SVG, copy PNG)
  // ----------------------------------------------------------

  private attachControls(container: HTMLElement, wrapper: HTMLElement, svgString: string, source: string): void {
    const bar = container.createDiv({ cls: 'beautiful-mermaid-toolbar' });

    // Zoom out
    const zoomOutBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Zoom out' } });
    zoomOutBtn.textContent = '−';
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = wrapper.getBoundingClientRect();
      (wrapper as any)._bmZoom?.(1, rect.width / 2, rect.height / 2);
    });

    // Reset zoom
    const resetBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Reset zoom · double-click diagram' } });
    resetBtn.textContent = '⊙';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      (wrapper as any)._bmReset?.();
    });

    // Zoom in
    const zoomInBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Zoom in' } });
    zoomInBtn.textContent = '+';
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = wrapper.getBoundingClientRect();
      (wrapper as any)._bmZoom?.(-1, rect.width / 2, rect.height / 2);
    });

    // Separator
    bar.createEl('span', { cls: 'bm-sep' });

    // Copy SVG
    const svgBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Copy as SVG' } });
    svgBtn.textContent = 'SVG';
    svgBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(svgString);
        svgBtn.textContent = '✓';
      } catch {
        svgBtn.textContent = '✗';
      }
      setTimeout(() => { svgBtn.textContent = 'SVG'; }, 1500);
    });

    // Copy PNG
    const pngBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Copy as PNG' } });
    pngBtn.textContent = 'PNG';
    pngBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await this.copyAsPng(svgString);
      pngBtn.textContent = ok ? '✓' : '✗';
      setTimeout(() => { pngBtn.textContent = 'PNG'; }, 1500);
    });

    // Export to Excalidraw
    bar.createEl('span', { cls: 'bm-sep' });
    const excBtn = bar.createEl('button', { cls: 'bm-btn', attr: { title: 'Export to Excalidraw' } });
    excBtn.textContent = 'Excalidraw';
    excBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await this.exportToExcalidraw(source, svgString);
      if (!ok) {
        excBtn.textContent = '✗';
        setTimeout(() => { excBtn.textContent = 'Excalidraw'; }, 1500);
      }
    });
  }

  // ----------------------------------------------------------
  // PNG export
  // ----------------------------------------------------------

  private async copyAsPng(svgString: string): Promise<boolean> {
    try {
      // In auto mode the SVG contains Obsidian CSS var() references which won't
      // resolve inside an <img>. Resolve them to computed values first.
      const resolved = this.resolveAutoColors(svgString);

      const blob = new Blob([resolved], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG load failed'));
        img.src = url;
      });

      // naturalWidth/Height is 0 when the SVG has only a viewBox and no width/height
      // attributes. Fall back to parsing the viewBox before revoking the URL.
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w === 0 || h === 0) {
        const vb = resolved.match(/viewBox=["'][\d.]+ [\d.]+ ([\d.]+) ([\d.]+)/);
        w = vb ? parseFloat(vb[1]) : 800;
        h = vb ? parseFloat(vb[2]) : 600;
      }

      // Revoke only after dimensions are secured and drawImage is done
      const dpr = window.devicePixelRatio || 2;
      const canvas = document.createElement('canvas');
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
      );

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return true;
    } catch (err) {
      console.error('[Beautiful Mermaid] PNG copy error:', err);
      return false;
    }
  }

  private async exportToExcalidraw(source: string, svgString: string): Promise<boolean> {
    try {
      // parseMermaidToExcalidraw handles flowchart, sequence, class, ER, and state diagrams,
      // falling back to a GraphImage (SVG embed) for unsupported types.
      const { elements: skeletons, files } = await parseMermaidToExcalidraw(source);
      const elements = this.hydrateSkeletons(skeletons);

      // files is populated only for GraphImage fallback (unsupported diagram types).
      // For those, resolve auto-mode CSS vars so the embedded SVG has literal colors.
      const excalidrawFiles: Record<string, any> = {};
      if (files) {
        for (const [id, file] of Object.entries(files)) {
          excalidrawFiles[id] = {
            ...file,
            dataURL: (file as any).mimeType === 'image/svg+xml'
              ? 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(this.resolveAutoColors(atob((file as any).dataURL.split(',')[1])))))
              : (file as any).dataURL,
          };
        }
      }

      const excalidraw = {
        type: 'excalidraw',
        version: 2,
        source: 'beautiful-mermaid',
        elements,
        appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
        files: excalidrawFiles,
      };

      let path = 'mermaid-diagram.excalidraw';
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = `mermaid-diagram-${i++}.excalidraw`;
      }

      await this.app.vault.create(path, JSON.stringify(excalidraw, null, 2));
      await this.app.workspace.openLinkText(path, '', true);
      return true;
    } catch (err) {
      console.error('[Beautiful Mermaid] Excalidraw export error:', err);
      return false;
    }
  }

  /**
   * Converts ExcalidrawElementSkeleton[] (from mermaid-to-excalidraw) into full
   * Excalidraw file elements by adding required lifecycle fields and expanding
   * label objects into bound text elements.
   */
  private hydrateSkeletons(skeletons: any[]): any[] {
    const now = Date.now();
    const rand = () => Math.floor(Math.random() * 2 ** 31);
    const uid = () => Math.random().toString(36).slice(2, 12);

    const lifecycle = () => ({
      version: 1,
      versionNonce: rand(),
      seed: rand(),
      updated: now,
      isDeleted: false,
      link: null,
      locked: false,
    });

    const visualDefaults = (sk: any) => ({
      angle: sk.angle ?? 0,
      strokeColor: sk.strokeColor ?? '#1e1e1e',
      backgroundColor: sk.backgroundColor ?? 'transparent',
      fillStyle: sk.fillStyle ?? 'solid',
      strokeWidth: sk.strokeWidth ?? 2,
      strokeStyle: sk.strokeStyle ?? 'solid',
      roughness: sk.roughness ?? 1,
      opacity: sk.opacity ?? 100,
      groupIds: sk.groupIds ?? [],
      frameId: sk.frameId ?? null,
      roundness: sk.roundness ?? null,
    });

    const boundText = (id: string, containerId: string, label: any, cx: number, cy: number): any => {
      const text = label.text ?? '';
      const fontSize = label.fontSize ?? 16;
      const width = Math.max(20, text.length * fontSize * 0.55);
      const height = fontSize * 1.5;
      return {
        ...lifecycle(),
        type: 'text',
        id,
        x: cx - width / 2,
        y: cy - height / 2,
        width,
        height,
        angle: 0,
        strokeColor: label.strokeColor ?? label.color ?? '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: label.groupIds ?? [],
        frameId: null,
        roundness: null,
        text,
        originalText: text,
        fontSize,
        fontFamily: 1,
        textAlign: label.textAlign ?? 'center',
        verticalAlign: label.verticalAlign ?? 'middle',
        containerId,
        autoResize: true,
        lineHeight: 1.25,
        boundElements: [],
        link: null,
        locked: false,
      };
    };

    const out: any[] = [];

    for (const sk of skeletons) {
      const id = sk.id ?? uid();

      if (sk.type === 'arrow' || sk.type === 'line') {
        const pts: [number, number][] = sk.points ?? [[0, 0], [sk.width ?? 100, sk.height ?? 0]];
        const endPt = pts[pts.length - 1];
        const boundElements: any[] = [];
        const el: any = {
          ...lifecycle(),
          ...visualDefaults(sk),
          type: sk.type,
          id,
          x: sk.x ?? 0,
          y: sk.y ?? 0,
          width: Math.abs(endPt[0]),
          height: Math.abs(endPt[1]),
          points: pts,
          lastCommittedPoint: null,
          startArrowhead: sk.startArrowhead ?? null,
          endArrowhead: sk.endArrowhead ?? (sk.type === 'arrow' ? 'arrow' : null),
          startBinding: sk.start?.id ? { elementId: sk.start.id, focus: 0, gap: 5 } : null,
          endBinding: sk.end?.id   ? { elementId: sk.end.id,   focus: 0, gap: 5 } : null,
          boundElements,
        };
        if (sk.label?.text) {
          const labelId = uid();
          boundElements.push({ type: 'text', id: labelId });
          out.push(el);
          out.push(boundText(labelId, id, sk.label, (sk.x ?? 0) + endPt[0] / 2, (sk.y ?? 0) + endPt[1] / 2));
        } else {
          out.push(el);
        }

      } else if (sk.type === 'text') {
        out.push({
          ...lifecycle(),
          ...visualDefaults(sk),
          type: 'text',
          id,
          x: sk.x ?? 0,
          y: sk.y ?? 0,
          width: sk.width ?? 100,
          height: sk.height ?? 20,
          text: sk.text ?? '',
          originalText: sk.text ?? '',
          fontSize: sk.fontSize ?? 16,
          fontFamily: 1,
          textAlign: sk.textAlign ?? 'left',
          verticalAlign: sk.verticalAlign ?? 'top',
          containerId: sk.containerId ?? null,
          autoResize: true,
          lineHeight: 1.25,
          boundElements: [],
        });

      } else if (sk.type === 'image') {
        out.push({
          ...lifecycle(),
          ...visualDefaults(sk),
          type: 'image',
          id,
          x: sk.x ?? 0,
          y: sk.y ?? 0,
          width: sk.width ?? 800,
          height: sk.height ?? 600,
          status: 'saved',
          fileId: sk.fileId,
          scale: sk.scale ?? [1, 1],
          boundElements: [],
        });

      } else {
        // rectangle, ellipse, diamond
        const boundElements: any[] = [];
        const el: any = {
          ...lifecycle(),
          ...visualDefaults(sk),
          type: sk.type,
          id,
          x: sk.x ?? 0,
          y: sk.y ?? 0,
          width: sk.width ?? 100,
          height: sk.height ?? 60,
          boundElements,
        };
        if (sk.label?.text) {
          const labelId = uid();
          boundElements.push({ type: 'text', id: labelId });
          out.push(el);
          out.push(boundText(labelId, id, sk.label, (sk.x ?? 0) + (sk.width ?? 100) / 2, (sk.y ?? 0) + (sk.height ?? 60) / 2));
        } else {
          out.push(el);
        }
      }
    }

    return out;
  }

  /**
   * Replaces Obsidian CSS var() references in the SVG string with their
   * computed values so the SVG renders correctly as a standalone image.
   * Only needed in auto mode; theme mode already has literal color values.
   */
  private resolveAutoColors(svgString: string): string {
    if (this.settings.renderMode !== 'auto') return svgString;
    const style = getComputedStyle(document.body);
    let s = svgString;
    const sub = (v: string) => {
      const val = style.getPropertyValue(v).trim();
      if (!val) return;
      // Match var(--foo), var( --foo ), var(--foo, fallback) — all valid CSS forms
      const re = new RegExp('var\\(\\s*' + v.replace(/-/g, '\\-') + '[^)]*\\)', 'g');
      s = s.replace(re, val);
    };
    sub('--background-primary');
    sub('--text-normal');
    sub('--interactive-accent');
    sub('--text-muted');
    sub('--background-modifier-border');
    sub('--background-secondary');
    return s;
  }

  // ----------------------------------------------------------
  // Render options
  // ----------------------------------------------------------

  buildRenderOptions(): RenderOptions {
    const { renderMode, theme, font, transparent } = this.settings;
    const base: RenderOptions = { font, transparent };

    if (renderMode === 'auto') {
      return { ...OBSIDIAN_AUTO_COLORS, ...base };
    }

    const themeColors: DiagramColors = THEMES[theme] ?? THEMES[DEFAULT_SETTINGS.theme];
    return { ...themeColors, ...base };
  }

  onunload(): void {
    // Obsidian automatically unregisters code block processors on plugin unload.
    // Pointer event listeners are scoped to diagram elements — no cleanup needed.
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

// ============================================================
// Live Preview — CodeMirror 6 extension
// ============================================================

class MermaidWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly plugin: BeautifulMermaidPlugin,
  ) { super(); }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    try {
      this.plugin.renderDiagram(this.source, wrap);
    } catch (e) {
      console.error('[Beautiful Mermaid] Widget toDOM error:', e);
      wrap.textContent = '⚠ Beautiful Mermaid: render error (see console)';
    }
    return wrap;
  }

  // Toolbar button clicks are handled by the widget; clicks on the diagram
  // body pass through to the editor so the cursor moves inside and reveals
  // the raw source for editing.
  ignoreEvent(event: Event): boolean {
    if (!(event instanceof MouseEvent)) return false;
    return (event.target as HTMLElement).closest('.beautiful-mermaid-toolbar') !== null;
  }
}

// Scans document text directly — avoids any dependency on syntaxTree availability.
function buildDecorations(view: EditorView, plugin: BeautifulMermaidPlugin): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const doc = state.doc;
  const cursorPos = state.selection.main.head;

  let lineNum = 1;
  while (lineNum <= doc.lines) {
    const line = doc.line(lineNum);

    // Detect opening fence: ``` or ~~~ followed by 'mermaid'
    if (/^(`{3,}|~{3,})\s*mermaid\s*$/i.test(line.text.trim())) {
      const fence = line.text.trim().startsWith('~') ? '~~~' : '```';
      const blockFrom = line.from;
      const sourceLines: string[] = [];
      lineNum++;

      while (lineNum <= doc.lines) {
        const inner = doc.line(lineNum);
        if (inner.text.trim() === fence) {
          // Cursor inside → show raw text for editing
          if (cursorPos >= blockFrom && cursorPos <= inner.to) {
            lineNum++;
            break;
          }
          builder.add(
            blockFrom,
            inner.to,
            Decoration.replace({
              widget: new MermaidWidget(sourceLines.join('\n'), plugin),
              block: true,
            }),
          );
          lineNum++;
          break;
        }
        sourceLines.push(inner.text);
        lineNum++;
      }
    } else {
      lineNum++;
    }
  }

  return builder.finish();
}

function mermaidLivePreview(plugin: BeautifulMermaidPlugin) {
  const empty = () => new RangeSetBuilder<Decoration>().finish();
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        try {
          this.decorations = buildDecorations(view, plugin);
        } catch (e) {
          console.error('[Beautiful Mermaid] Live preview init error:', e);
          this.decorations = empty();
        }
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          try {
            this.decorations = buildDecorations(update.view, plugin);
          } catch (e) {
            console.error('[Beautiful Mermaid] Live preview update error:', e);
          }
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// ============================================================
// Settings Tab
// ============================================================

class BeautifulMermaidSettingTab extends PluginSettingTab {
  plugin: BeautifulMermaidPlugin;

  constructor(app: App, plugin: BeautifulMermaidPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Beautiful Mermaid' });
    containerEl.createEl('p', {
      text: 'Renders Mermaid diagrams with enhanced, themed SVG output using the beautiful-mermaid library.',
      cls: 'setting-item-description',
    });

    // Render Mode
    new Setting(containerEl)
      .setName('Render mode')
      .setDesc(
        'Auto follows your vault\'s current light/dark theme via CSS variables — updates live when ' +
        'you toggle themes. Built-in theme uses a fixed beautiful-mermaid color palette.'
      )
      .addDropdown(dd =>
        dd
          .addOption('auto', 'Auto — follow vault theme')
          .addOption('theme', 'Built-in theme')
          .setValue(this.plugin.settings.renderMode)
          .onChange(async (value: string) => {
            this.plugin.settings.renderMode = value as RenderMode;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Theme picker — only shown in 'theme' mode
    if (this.plugin.settings.renderMode === 'theme') {
      new Setting(containerEl)
        .setName('Theme')
        .setDesc(
          'Choose from 15 curated beautiful-mermaid themes. Dark themes work best in dark vaults; ' +
          'light themes in light vaults.'
        )
        .addDropdown(dd => {
          THEME_NAMES_DARK.forEach(name => dd.addOption(name, name));
          THEME_NAMES_LIGHT.forEach(name => dd.addOption(name, name));
          dd.setValue(this.plugin.settings.theme);
          dd.onChange(async (value: string) => {
            this.plugin.settings.theme = value;
            await this.plugin.saveSettings();
          });
          return dd;
        });
    }

    // Font
    new Setting(containerEl)
      .setName('Font family')
      .setDesc('Font used for all diagram text. Must be available in Obsidian. Default: Inter')
      .addText(text =>
        text
          .setPlaceholder('Inter')
          .setValue(this.plugin.settings.font)
          .onChange(async (value: string) => {
            this.plugin.settings.font = value.trim() || 'Inter';
            await this.plugin.saveSettings();
          })
      );

    // Transparent background
    new Setting(containerEl)
      .setName('Transparent background')
      .setDesc(
        'Render diagrams without a background fill — the note background shows through. ' +
        'Pairs well with Auto mode.'
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.transparent)
          .onChange(async (value: boolean) => {
            this.plugin.settings.transparent = value;
            await this.plugin.saveSettings();
          })
      );

    // Info footer — built with DOM API, no innerHTML
    const footer = containerEl.createEl('div', { cls: 'setting-item-description' });
    footer.createEl('br');
    footer.appendText('Powered by ');
    footer.createEl('a', {
      text: 'beautiful-mermaid',
      href: 'https://github.com/lukilabs/beautiful-mermaid',
    });
    footer.appendText(' · Open a note with a ');
    footer.createEl('code', { text: '```mermaid' });
    footer.appendText(' block to see the effect.');
  }
}
