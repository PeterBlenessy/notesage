// Magic-variable input (Phase 4, redesign Pass 2). A contenteditable field that
// renders `{{token}}` segments as inline PILLS labelled with their friendly
// name — the user inserts data by clicking a variable rather than typing
// mustache syntax (the Apple Shortcuts / Zapier "Insert Data" pattern). The
// value on disk is still the plain `{{token}}` string, so serialization is
// unchanged — a pill is purely a rendering of the same token text.
//
// Insertion is deterministic: it splices into the value STRING at a tracked
// caret offset and re-renders, rather than mutating the live selection (which
// the focus-stealing picker would lose). Research: docs/research/automation-builder-ux.md

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { VariablePicker, type TokenOption } from './VariablePicker';
import { t } from '@/lib/i18n';

const TOKEN_RE = /\{\{\s*[^{}]+?\s*\}\}/g;

function labelFor(token: string, tokens: TokenOption[]): string {
  return tokens.find((t) => t.token === token)?.label ?? token.replace(/\{\{|\}\}/g, '').trim();
}

function makePill(token: string, tokens: TokenOption[]): HTMLSpanElement {
  const span = document.createElement('span');
  span.dataset.token = token;
  span.contentEditable = 'false';
  span.title = token;
  span.className =
    'mx-px inline-flex select-none items-center rounded bg-[var(--color-accent-primary)]/15 px-1.5 py-px align-baseline text-xs font-medium text-[var(--color-accent-primary)]';
  span.textContent = labelFor(token, tokens);
  return span;
}

/** value string → pill/text nodes inside `el`. (Exported for round-trip tests.) */
export function renderInto(el: HTMLElement, value: string, tokens: TokenOption[]): void {
  el.replaceChildren();
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(value)) !== null) {
    if (m.index > lastIdx) el.appendChild(document.createTextNode(value.slice(lastIdx, m.index)));
    el.appendChild(makePill(m[0], tokens));
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < value.length) el.appendChild(document.createTextNode(value.slice(lastIdx)));
}

/** pill/text nodes → value string (pills serialize back to their `{{token}}`). */
export function serialize(el: HTMLElement): string {
  let out = '';
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
    else if (node.nodeName === 'BR') out += '\n';
    else if (node instanceof HTMLElement) out += node.dataset.token ?? node.textContent ?? '';
  });
  return out;
}

/** Serialized length contributed by a single child node. */
function nodeLen(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === 'BR') return 1;
  if (node instanceof HTMLElement && node.dataset.token) return node.dataset.token.length;
  return node.textContent?.length ?? 0;
}

/** Serialized-string offset where a given child node starts. */
function offsetOfNode(el: HTMLElement, target: Node): number {
  let acc = 0;
  for (const node of Array.from(el.childNodes)) {
    if (node === target) return acc;
    acc += nodeLen(node);
  }
  return acc;
}

/** Current caret as an offset into the serialized string (null if not in `el`). */
function caretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  // Caret directly in the editable (between children) — startOffset is a child index.
  if (r.startContainer === el) {
    let acc = 0;
    for (let i = 0; i < r.startOffset; i++) acc += nodeLen(el.childNodes[i]);
    return acc;
  }
  let acc = 0;
  for (const node of Array.from(el.childNodes)) {
    if (node === r.startContainer || node.contains(r.startContainer)) {
      return acc + (node.nodeType === Node.TEXT_NODE ? r.startOffset : 0);
    }
    acc += nodeLen(node);
  }
  return acc;
}

/** Place the caret at `offset` characters into the serialized content. */
function placeCaret(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let acc = 0;
  for (const node of Array.from(el.childNodes)) {
    const len = nodeLen(node);
    if (acc + len >= offset) {
      if (node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, Math.min(node.textContent?.length ?? 0, Math.max(0, offset - acc)));
      } else if (offset - acc >= len) {
        range.setStartAfter(node);
      } else {
        range.setStartBefore(node);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    acc += len;
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function TokenInput({
  id,
  label,
  value,
  onChange,
  tokens,
  multiline,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  tokens: TokenOption[];
  multiline?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The last value we rendered or emitted — so the render effect fires only on
  // EXTERNAL changes (typing already updated the DOM), never re-rendering on our
  // own keystrokes (which would reset the caret).
  const last = useRef<string | null>(null);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  // Caret as a string offset: `caret` = last known; `pendingCaret` = where to
  // restore after a programmatic re-render (insert / newline / paste).
  const caret = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  // The pill the user clicked — opens a Remove / Replace menu anchored to it.
  const [menu, setMenu] = useState<{ token: string; start: number; end: number; x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  useEffect(() => {
    const el = ref.current;
    if (el && value !== last.current) {
      renderInto(el, value, tokensRef.current);
      last.current = value;
      if (pendingCaret.current != null) {
        el.focus();
        placeCaret(el, pendingCaret.current);
        caret.current = pendingCaret.current;
        pendingCaret.current = null;
      }
    }
  }, [value]);

  // Typing path: read back the DOM, remember the caret, and skip the render
  // effect (last === value) so the live caret is preserved.
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    caret.current = caretOffset(el);
    const v = serialize(el);
    last.current = v;
    onChange(v);
  };

  const trackCaret = () => {
    const el = ref.current;
    if (!el) return;
    const o = caretOffset(el);
    if (o != null) caret.current = o;
  };

  // Splice `text` into the value at the tracked caret (or append), then let the
  // render effect rebuild the pills and restore the caret. Deterministic — no
  // dependence on the live DOM selection at click time (which the focus-stealing
  // picker would otherwise lose).
  const spliceAt = (text: string) => {
    const el = ref.current;
    if (el) {
      // Re-sync from the live DOM in case the user typed since the last emit.
      last.current = serialize(el);
      const live = caretOffset(el);
      if (live != null) caret.current = live;
    }
    const v = last.current ?? value;
    const at = caret.current ?? v.length;
    pendingCaret.current = at + text.length;
    onChange(v.slice(0, at) + text + v.slice(at)); // value ≠ last ⇒ effect re-renders
  };

  const insertToken = (token: string) => spliceAt(token);

  // Click a pill → open a menu over it instead of focusing/placing the caret.
  const openPillMenu = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const pillEl = (e.target as HTMLElement).closest('[data-token]') as HTMLElement | null;
    if (!pillEl || !el.contains(pillEl)) {
      if (menu) setMenu(null);
      return;
    }
    e.preventDefault(); // suppress focus/caret — show the variable menu
    const token = pillEl.dataset.token ?? '';
    const start = offsetOfNode(el, pillEl);
    const rect = pillEl.getBoundingClientRect();
    setMenu({ token, start, end: start + token.length, x: rect.left, y: rect.bottom + 4 });
  };

  const spliceRange = (start: number, end: number, replacement: string) => {
    const v = ref.current ? serialize(ref.current) : value;
    pendingCaret.current = start + replacement.length;
    onChange(v.slice(0, start) + replacement + v.slice(end));
    setMenu(null);
  };

  const removePill = () => menu && spliceRange(menu.start, menu.end, '');
  const replacePill = (token: string) => menu && spliceRange(menu.start, menu.end, token);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (multiline) spliceAt('\n');
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    spliceAt(multiline ? text : text.replace(/\n/g, ' '));
  };

  // On blur, re-render so any tokens the user TYPED (typing alone doesn't
  // re-render) turn into pills — same as picker-inserted / recipe tokens.
  const handleBlur = () => {
    trackCaret();
    const el = ref.current;
    if (!el) return;
    const v = serialize(el);
    renderInto(el, v, tokensRef.current);
    last.current = v;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </Label>
        <VariablePicker tokens={tokens} onInsert={insertToken} />
      </div>
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-label={label}
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onKeyUp={trackCaret}
        onMouseUp={trackCaret}
        onMouseDown={openPillMenu}
        onBlur={handleBlur}
        className={cn(
          'token-input w-full overflow-hidden whitespace-pre-wrap break-words rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          multiline ? 'min-h-18' : 'min-h-9 leading-6',
        )}
      />

      {menu &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)} />
            <div
              className="fixed z-50 w-56 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-md"
              style={{ left: menu.x, top: menu.y }}
            >
              <div className="px-2 py-1">
                <span className="inline-flex items-center rounded bg-[var(--color-accent-primary)]/15 px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent-primary)]">
                  {labelFor(menu.token, tokensRef.current)}
                </span>
              </div>
              <button
                type="button"
                onClick={removePill}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                <X className="size-3.5" strokeWidth={1.5} />
                Remove
              </button>
              {tokensRef.current.length > 0 && (
                <>
                  <div className="my-1 border-t border-border" />
                  <div className="px-2 py-0.5 text-[0.7rem] text-muted-foreground">{t("automation.replaceWith")}</div>
                  <div className="max-h-40 overflow-auto">
                    {tokensRef.current.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        onClick={() => replacePill(t.token)}
                        className="flex w-full items-center rounded-sm px-2 py-1 text-left text-xs hover:bg-muted"
                      >
                        <span className="inline-flex items-center rounded bg-[var(--color-accent-primary)]/15 px-1.5 py-0.5 font-medium text-[var(--color-accent-primary)]">
                          {t.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
