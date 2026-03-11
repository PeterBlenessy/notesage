import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// ---------------------------------------------------------------------------
// Plugin key
// ---------------------------------------------------------------------------

export const DragHandlePluginKey = new PluginKey<DragHandlePluginState>('dragHandle');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DragHandlePluginState {
  hoveredNodePos: number | null;
}

interface DragState {
  sourcePos: number;
  sourceNode: PMNode;
  /** rAF handle for throttling dragover updates */
  rafId: number | null;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Returns the nearest ancestor (or self) of a DOM node that is a direct child
 *  of the ProseMirror editor root element. */
function getTopLevelDOMNode(
  dom: Node,
  editorRoot: Element
): Element | null {
  let node: Node | null = dom;
  while (node && node.parentNode !== editorRoot) {
    node = node.parentNode;
  }
  return node instanceof Element ? node : null;
}

/** Finds the ProseMirror position of the top-level node whose DOM element
 *  is `domNode`. Returns -1 if not found. */
function getPosForDOMNode(view: EditorView, domNode: Element): number {
  const { doc } = view.state;
  let found = -1;

  doc.forEach((_node, offset) => {
    if (found !== -1) return;
    try {
      const nodeDOM = view.nodeDOM(offset);
      if (nodeDOM === domNode || (nodeDOM instanceof Node && domNode.contains(nodeDOM as Node))) {
        found = offset;
      }
    } catch {
      // nodeDOM may throw for some positions; skip
    }
  });

  return found;
}

/** True if the node at this position is an empty paragraph (renders as placeholder). */
function isEmptyParagraph(node: PMNode): boolean {
  return node.type.name === 'paragraph' && node.nodeSize === 2;
}

// ---------------------------------------------------------------------------
// Handle element factory
// ---------------------------------------------------------------------------

function createHandleElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'drag-handle';
  el.setAttribute('draggable', 'true');
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-label', 'Drag to reorder block');

  // 6-dot SVG grip icon
  el.innerHTML = `<svg
    width="10"
    height="16"
    viewBox="0 0 10 16"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <circle cx="3" cy="3" r="1.5"/>
    <circle cx="7" cy="3" r="1.5"/>
    <circle cx="3" cy="8" r="1.5"/>
    <circle cx="7" cy="8" r="1.5"/>
    <circle cx="3" cy="13" r="1.5"/>
    <circle cx="7" cy="13" r="1.5"/>
  </svg>`;

  return el;
}

/** Creates the drop indicator line element (2px horizontal rule). */
function createDropIndicator(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'drag-drop-indicator';
  return el;
}

// ---------------------------------------------------------------------------
// Drag-handle plugin
// ---------------------------------------------------------------------------

function createDragHandlePlugin() {
  // The handle and indicator live outside ProseMirror's DOM tree so that they
  // don't interfere with the editor's content or selection.
  let handleEl: HTMLElement | null = null;
  let indicatorEl: HTMLElement | null = null;
  let currentView: EditorView | null = null;

  // Track the ProseMirror document position for the block whose handle is showing.
  let activeNodePos: number | null = null;

  // Drag state (only valid during an active HTML5 drag).
  let dragState: DragState | null = null;

  // ---------------------------------------------------------------------------
  // Position the handle next to `blockDOMNode`
  // ---------------------------------------------------------------------------

  function positionHandle(view: EditorView, blockDOMNode: Element, nodePos: number) {
    if (!handleEl) return;

    const editorRect = view.dom.getBoundingClientRect();
    const blockRect = blockDOMNode.getBoundingClientRect();

    // Vertically: align with the first line (top of block + half of line-height)
    const lineHeight = parseInt(getComputedStyle(view.dom).lineHeight, 10) || 24;
    const top = blockRect.top - editorRect.top + lineHeight / 2 - 8; // 8 = half handle height

    // Horizontally: place in the left padding gutter, close to content
    const paddingLeft = parseInt(getComputedStyle(view.dom).paddingLeft, 10) || 96;
    const left = paddingLeft - 28; // 28px from content edge into the gutter

    handleEl.style.top = `${top + view.dom.scrollTop}px`;
    handleEl.style.left = `${left}px`;
    handleEl.style.display = 'flex';

    activeNodePos = nodePos;
  }

  function hideHandle() {
    if (handleEl) {
      handleEl.style.display = 'none';
    }
    activeNodePos = null;
  }

  // ---------------------------------------------------------------------------
  // Drop indicator positioning
  // ---------------------------------------------------------------------------

  function positionIndicatorBetweenBlocks(
    view: EditorView,
    clientY: number
  ): number | null {
    if (!indicatorEl) return null;

    const editorRect = view.dom.getBoundingClientRect();
    const { doc } = view.state;
    const paddingLeft = parseInt(getComputedStyle(view.dom).paddingLeft, 10) || 96;
    const paddingRight = parseInt(getComputedStyle(view.dom).paddingRight, 10) || 96;

    // Collect the bounding rects of all top-level block DOM nodes.
    interface BlockInfo { pos: number; rect: DOMRect }
    const blocks: BlockInfo[] = [];

    doc.forEach((_node, offset) => {
      try {
        const dom = view.nodeDOM(offset);
        if (dom instanceof Element) {
          blocks.push({ pos: offset, rect: dom.getBoundingClientRect() });
        }
      } catch {
        // skip
      }
    });

    if (blocks.length === 0) return null;

    // Find the gap nearest to clientY.
    // Gaps: before block[0], between block[i] and block[i+1], after last block.
    let bestGapY = -Infinity;
    let bestInsertPos = 0; // ProseMirror position to insert before

    // Before first block
    const firstMid = blocks[0].rect.top;
    if (clientY <= firstMid) {
      bestGapY = blocks[0].rect.top;
      bestInsertPos = blocks[0].pos;
    } else {
      // Between blocks
      for (let i = 0; i < blocks.length - 1; i++) {
        const gapY = (blocks[i].rect.bottom + blocks[i + 1].rect.top) / 2;
        if (clientY > gapY) {
          bestGapY = blocks[i + 1].rect.top;
          // Insert before blocks[i+1] means the position AFTER blocks[i].
          bestInsertPos = blocks[i + 1].pos;
        }
      }
      // After last block
      const last = blocks[blocks.length - 1];
      if (clientY > (last.rect.bottom + last.rect.top) / 2) {
        bestGapY = last.rect.bottom;
        // Insert after the last block = doc.content.size - 0
        bestInsertPos = last.pos + doc.nodeAt(last.pos)!.nodeSize;
      }
    }

    const indicatorTop = bestGapY - editorRect.top + view.dom.scrollTop - 1;
    indicatorEl.style.top = `${indicatorTop}px`;
    indicatorEl.style.left = `${paddingLeft - 4}px`;
    indicatorEl.style.right = `${paddingRight - 4}px`;
    indicatorEl.style.width = 'auto';
    indicatorEl.style.display = 'block';

    return bestInsertPos;
  }

  function hideIndicator() {
    if (indicatorEl) indicatorEl.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Handle drag events attached to the handle element itself
  // ---------------------------------------------------------------------------

  function onHandleDragStart(view: EditorView, e: DragEvent) {
    if (activeNodePos === null) return;

    const { doc } = view.state;
    const node = doc.nodeAt(activeNodePos);
    if (!node) return;

    // Store drag state
    dragState = {
      sourcePos: activeNodePos,
      sourceNode: node,
      rafId: null,
    };

    // Apply dragging-source class to the block DOM node
    try {
      const dom = view.nodeDOM(activeNodePos);
      if (dom instanceof Element) {
        dom.classList.add('dragging-source');
      }
    } catch {
      // ignore
    }

    // Set drag data so the HTML5 drag is valid
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.textContent);
      // Provide a custom drag image using the block itself if available
      try {
        const dom = view.nodeDOM(activeNodePos);
        if (dom instanceof Element) {
          e.dataTransfer.setDragImage(dom as HTMLElement, 20, 20);
        }
      } catch {
        // fallback to default
      }
    }

    hideHandle();
  }

  function onHandleDragEnd(view: EditorView) {
    // Clean up source highlight
    if (dragState) {
      if (dragState.rafId !== null) {
        cancelAnimationFrame(dragState.rafId);
      }
      try {
        const dom = view.nodeDOM(dragState.sourcePos);
        if (dom instanceof Element) {
          dom.classList.remove('dragging-source');
        }
      } catch {
        // ignore
      }
      dragState = null;
    }
    hideIndicator();
  }

  // ---------------------------------------------------------------------------
  // Editor-level drag events (on view.dom)
  // ---------------------------------------------------------------------------

  function onEditorDragOver(view: EditorView, e: DragEvent) {
    if (!dragState) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    // Throttle via rAF
    if (dragState.rafId !== null) return;
    dragState.rafId = requestAnimationFrame(() => {
      if (dragState) {
        dragState.rafId = null;
        positionIndicatorBetweenBlocks(view, e.clientY);
      }
    });
  }

  function onEditorDrop(view: EditorView, e: DragEvent): boolean {
    if (!dragState) return false;
    e.preventDefault();
    e.stopPropagation();

    const { sourcePos, sourceNode } = dragState;

    // Determine insert position from indicator placement
    const targetPos = positionIndicatorBetweenBlocks(view, e.clientY);

    hideIndicator();
    onHandleDragEnd(view);

    if (targetPos === null) return true;

    // Don't move if dropping at same position
    const nodeEnd = sourcePos + sourceNode.nodeSize;
    if (targetPos >= sourcePos && targetPos <= nodeEnd) return true;

    // Build transaction: delete source, insert at target (adjusted for deletion)
    const { state } = view;
    let tr = state.tr;

    // Adjust target position if it comes after the source
    const adjustedTarget = targetPos > nodeEnd ? targetPos - sourceNode.nodeSize : targetPos;

    // Delete the source node
    tr = tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
    // Insert at the adjusted position
    tr = tr.insert(adjustedTarget, sourceNode);

    // Scroll selection to the moved node
    tr = tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(adjustedTarget + 1, tr.doc.content.size)))
    );

    view.dispatch(tr);
    return true;
  }

  function onEditorDragLeave(_view: EditorView, e: DragEvent) {
    // Only hide indicator if leaving the editor entirely
    const related = e.relatedTarget;
    if (!related || !(currentView?.dom.contains(related as Node))) {
      hideIndicator();
    }
  }

  // ---------------------------------------------------------------------------
  // Mousemove handler — detect hovered top-level block
  // ---------------------------------------------------------------------------

  function onMouseMove(view: EditorView, e: MouseEvent) {
    if (dragState) return; // don't update handle during drag

    const target = e.target as Node | null;
    if (!target) {
      hideHandle();
      return;
    }

    const topLevelDom = getTopLevelDOMNode(target, view.dom);
    if (!topLevelDom) {
      hideHandle();
      return;
    }

    const nodePos = getPosForDOMNode(view, topLevelDom);
    if (nodePos === -1) {
      hideHandle();
      return;
    }

    const node = view.state.doc.nodeAt(nodePos);
    if (!node) {
      hideHandle();
      return;
    }

    // Don't show handle for empty paragraphs
    if (isEmptyParagraph(node)) {
      hideHandle();
      return;
    }

    positionHandle(view, topLevelDom, nodePos);
  }

  function onMouseLeave(_view: EditorView, e: MouseEvent) {
    // Only hide if the mouse truly left the editor (not moved to handle)
    const related = e.relatedTarget;
    if (related === handleEl || handleEl?.contains(related as Node)) return;
    hideHandle();
  }

  // ---------------------------------------------------------------------------
  // Plugin
  // ---------------------------------------------------------------------------

  return new Plugin({
    key: DragHandlePluginKey,

    state: {
      init(): DragHandlePluginState {
        return { hoveredNodePos: null };
      },
      apply(_tr, value): DragHandlePluginState {
        return value;
      },
    },

    view(editorView: EditorView) {
      currentView = editorView;

      // Mount handle and indicator into the editor's parent container so they
      // can be absolutely positioned relative to it.
      const container = editorView.dom.parentElement;
      if (!container) {
        return {
          update() {},
          destroy() {},
        };
      }

      // Ensure container has position:relative for absolute children
      const containerStyle = getComputedStyle(container);
      if (containerStyle.position === 'static') {
        container.style.position = 'relative';
      }

      handleEl = createHandleElement();
      handleEl.style.display = 'none';
      container.appendChild(handleEl);

      indicatorEl = createDropIndicator();
      indicatorEl.style.display = 'none';
      container.appendChild(indicatorEl);

      // Bind handle drag events
      const handleDragStart = (e: DragEvent) => onHandleDragStart(editorView, e);
      const handleDragEnd = () => onHandleDragEnd(editorView);
      handleEl.addEventListener('dragstart', handleDragStart);
      handleEl.addEventListener('dragend', handleDragEnd);

      // Bind editor DOM events
      const editorMouseMove = (e: MouseEvent) => onMouseMove(editorView, e);
      const editorMouseLeave = (e: MouseEvent) => onMouseLeave(editorView, e);
      const editorDragOver = (e: DragEvent) => onEditorDragOver(editorView, e);
      const editorDrop = (e: DragEvent) => {
        // Drop is also handled via props.handleDOMEvents but we need it here
        // for the indicator. Return value is handled in props below.
        onEditorDrop(editorView, e);
      };
      const editorDragLeave = (e: DragEvent) => onEditorDragLeave(editorView, e);

      editorView.dom.addEventListener('mousemove', editorMouseMove);
      editorView.dom.addEventListener('mouseleave', editorMouseLeave);
      editorView.dom.addEventListener('dragover', editorDragOver);
      editorView.dom.addEventListener('drop', editorDrop);
      editorView.dom.addEventListener('dragleave', editorDragLeave);

      return {
        update(_view: EditorView, _prevState: EditorState) {
          // Nothing to update on state changes; handle positioning is driven by
          // mousemove events
        },
        destroy() {
          editorView.dom.removeEventListener('mousemove', editorMouseMove);
          editorView.dom.removeEventListener('mouseleave', editorMouseLeave);
          editorView.dom.removeEventListener('dragover', editorDragOver);
          editorView.dom.removeEventListener('drop', editorDrop);
          editorView.dom.removeEventListener('dragleave', editorDragLeave);

          if (handleEl) {
            handleEl.removeEventListener('dragstart', handleDragStart);
            handleEl.removeEventListener('dragend', handleDragEnd);
            handleEl.remove();
            handleEl = null;
          }

          if (indicatorEl) {
            indicatorEl.remove();
            indicatorEl = null;
          }

          currentView = null;
          dragState = null;
          activeNodePos = null;
        },
      };
    },

    props: {
      handleDOMEvents: {
        drop(view: EditorView, e: Event): boolean {
          // If we have an active drag from our handle, consume the drop event
          // to prevent ProseMirror's default drop handling.
          if (dragState && e instanceof DragEvent) {
            return onEditorDrop(view, e);
          }
          return false;
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const DragHandle = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    return [createDragHandlePlugin()];
  },
});
