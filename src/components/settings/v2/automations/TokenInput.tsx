// Magic-variable input (Phase 4, redesign Pass 2). A contenteditable field that
// renders `{{token}}` segments as inline PILLS labelled with their friendly
// name — the user inserts data by clicking a variable rather than typing
// mustache syntax (the Apple Shortcuts / Zapier "Insert Data" pattern). The
// value on disk is still the plain `{{token}}` string, so serialization is
// unchanged — a pill is purely a rendering of the same token text.
//
// Research: docs/research/automation-builder-ux.md (R3, magic-variable pills)

import { useEffect, useRef, type KeyboardEvent, type ClipboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { VariablePicker, type TokenOption } from './VariablePicker';

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
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(value)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(value.slice(last, m.index)));
    el.appendChild(makePill(m[0], tokens));
    last = m.index + m[0].length;
  }
  if (last < value.length) el.appendChild(document.createTextNode(value.slice(last)));
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
  // EXTERNAL changes (step switch, recipe pre-fill), never on our own typing
  // (which would reset the caret).
  const last = useRef<string | null>(null);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && value !== last.current) {
      renderInto(el, value, tokensRef.current);
      last.current = value;
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const v = serialize(el);
    last.current = v;
    onChange(v);
  };

  // Remember the caret so a click on the (focus-stealing) picker still inserts
  // where the user was typing.
  const saveRange = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (el && sel && sel.rangeCount && el.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const insertNodeAtCaret = (node: Node) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const saved = savedRange.current;
    const range =
      saved && el.contains(saved.commonAncestorContainer) ? saved : document.createRange();
    if (range !== saved) {
      range.selectNodeContents(el);
      range.collapse(false); // caret at end when we have no saved position
    }
    // A fragment is emptied by insertNode, so capture its last node first.
    const marker = node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? node.lastChild : node;
    range.deleteContents();
    range.insertNode(node);
    if (marker) {
      range.setStartAfter(marker);
      range.collapse(true);
    }
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    savedRange.current = range.cloneRange();
    emit();
  };

  const insertToken = (token: string) => {
    const frag = document.createDocumentFragment();
    frag.appendChild(makePill(token, tokensRef.current));
    frag.appendChild(document.createTextNode(' ')); // a space so the caret leaves the pill
    insertNodeAtCaret(frag);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (multiline) insertNodeAtCaret(document.createTextNode('\n'));
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    insertNodeAtCaret(document.createTextNode(multiline ? text : text.replace(/\n/g, ' ')));
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
        onKeyUp={saveRange}
        onMouseUp={saveRange}
        onBlur={saveRange}
        className={cn(
          'token-input w-full overflow-hidden whitespace-pre-wrap break-words rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          multiline ? 'min-h-18' : 'min-h-9 leading-6',
        )}
      />
    </div>
  );
}
