/**
 * Minimal mock of a Tiptap Editor for component tests.
 *
 * The real `Editor` from `@tiptap/core` pulls in ProseMirror, the DOM, and
 * the entire extension ecosystem — none of which is available in a jsdom
 * vitest environment. This mock provides just enough surface area to satisfy
 * components that receive `editor: Editor | null` as a prop (Toolbar,
 * StatusBar, BubbleMenu, etc.) without importing any Tiptap code.
 *
 * Usage:
 *   import { createMockEditor } from '@/test/mock-editor';
 *   const editor = createMockEditor({ text: 'hello' }) as Editor;
 */
import { vi } from 'vitest';

export interface MockEditorOptions {
  /** Text returned by `getText()`. Default: `'Hello world test content'` */
  text?: string;
  /**
   * Map of format/node name to active state.
   * Supports plain names (`{ bold: true }`) and names with attrs
   * (`{ 'heading:2': true }`) — see `isActive` implementation below.
   */
  activeStates?: Record<string, boolean>;
  /** Whether commands are available (`can()` calls return this). Default: `true` */
  canExecute?: boolean;
}

/**
 * Build a key for `activeStates` lookup that incorporates optional attrs.
 * `isActive('heading', { level: 2 })` → lookup key `'heading:2'` first,
 * then falls back to `'heading'`.
 */
function activeKey(name: string, attrs?: Record<string, unknown>): string[] {
  const keys = [name];
  if (attrs) {
    // Build a deterministic suffix from sorted attr values.
    const suffix = Object.keys(attrs)
      .sort()
      .map((k) => String(attrs[k]))
      .join(',');
    keys.unshift(`${name}:${suffix}`);
  }
  return keys;
}

/**
 * Creates a chainable proxy where every property access returns `this`
 * (so `.focus().toggleBold().setHeading({ level: 1 })` all chain) and
 * `.run()` returns `runResult`.
 *
 * A `vi.fn()` spy is attached as `_spy` on the proxy so tests can assert
 * which chain methods were called.
 */
function createChainProxy(runResult: boolean): Record<string, unknown> {
  const spy = vi.fn();

  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === '_spy') return spy;
      if (prop === 'run') {
        return () => {
          spy('run');
          return runResult;
        };
      }
      // Every other property returns a function that records the call and
      // returns the proxy again for chaining.
      return (...args: unknown[]) => {
        spy(String(prop), ...args);
        return proxy;
      };
    },
  };

  const proxy = new Proxy({} as Record<string, unknown>, handler);
  return proxy;
}

/**
 * Creates a minimal mock of a Tiptap `Editor` suitable for component tests.
 *
 * The returned value is typed as `unknown` — callers should cast it to
 * `Editor` at the call site:
 *
 * ```ts
 * const editor = createMockEditor() as Editor;
 * ```
 */
export function createMockEditor(options: MockEditorOptions = {}): unknown {
  const {
    text = 'Hello world test content',
    activeStates = {},
    canExecute = true,
  } = options;

  const chainProxy = createChainProxy(true);
  const canChainProxy = createChainProxy(canExecute);

  const dom = document.createElement('div');

  const editor = {
    // ---- Content accessors ----
    getText: vi.fn(() => text),
    getHTML: vi.fn(() => `<p>${text}</p>`),
    isEmpty: false,
    isEditable: true,

    // ---- Active state ----
    isActive: vi.fn((name: string, attrs?: Record<string, unknown>) => {
      const keys = activeKey(name, attrs);
      for (const k of keys) {
        if (k in activeStates) return activeStates[k];
      }
      return false;
    }),

    // ---- Command chaining ----
    chain: vi.fn(() => chainProxy),

    // ---- Capability check (`can().undo()`, `can().chain().focus()...run()`) ----
    can: vi.fn(() => {
      // `editor.can().undo()` — direct method style (Toolbar uses this)
      // `editor.can().chain().focus().toggleBold().run()` — chain style
      const directProxy = new Proxy({} as Record<string, unknown>, {
        get(_target, prop) {
          if (prop === 'chain') return () => canChainProxy;
          // Direct can() methods like `can().undo()` return canExecute
          return () => canExecute;
        },
      });
      return directProxy;
    }),

    // ---- Direct commands ----
    commands: new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        // Return a stable spy per property name so repeated access
        // returns the same function (allows assertion on call count).
        const key = `__cmd_${String(prop)}`;
        if (!(_target as Record<string, unknown>)[key]) {
          (_target as Record<string, unknown>)[key] = vi.fn(() => true);
        }
        return (_target as Record<string, unknown>)[key];
      },
    }),

    // ---- Event listeners ----
    on: vi.fn(),
    off: vi.fn(),

    // ---- ProseMirror view / state ----
    view: {
      dom,
      state: {
        doc: { textContent: text },
        selection: { from: 0, to: 0 },
      },
      dispatch: vi.fn(),
      domAtPos: vi.fn(() => ({ node: dom, offset: 0 })),
    },
    state: {
      doc: {
        textContent: text,
        textBetween: vi.fn(
          (_from: number, _to: number, _separator?: string) => text,
        ),
        nodeSize: text.length + 2,
      },
      selection: { from: 0, to: 0 },
      tr: {
        setMeta: vi.fn(function (this: unknown) { return this; }),
      },
    },

    // ---- Misc ----
    storage: {},
    extensionManager: { extensions: [] },
    isDestroyed: false,
  };

  return editor;
}
