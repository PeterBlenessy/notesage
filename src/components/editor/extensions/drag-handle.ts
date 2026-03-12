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
  let handleEl: HTMLElement | null = null;
  let indicatorEl: HTMLElement | null = null;
  let currentView: EditorView | null = null;

  // Track the ProseMirror document position for the block whose handle is showing.
  let activeNodePos: number | null = null;

  // Drag state (only valid during an active HTML5 drag).
  let dragState: DragState | null = null;

  // Delayed hide so moving from text to the handle in the gutter doesn't flash.
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------------
  // Position the handle at a specific clientY, aligned to the left gutter.
  // ---------------------------------------------------------------------------

  function positionHandleAtY(view: EditorView, clientY: number, nodePos: number) {
    if (!handleEl) return;

    const editorRect = view.dom.getBoundingClientRect();
    const paddingLeft = parseInt(getComputedStyle(view.dom).paddingLeft, 10) || 96;

    // Position vertically: convert clientY to editor-relative coordinates
    const top = clientY - editorRect.top - 10; // 10 = half handle height

    handleEl.style.top = `${top + view.dom.scrollTop}px`;
    handleEl.style.left = `${paddingLeft - 28}px`;
    handleEl.style.display = 'flex';

    activeNodePos = nodePos;
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (handleEl) handleEl.style.display = 'none';
      activeNodePos = null;
      hideTimer = null;
    }, 200);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
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

    let bestGapY = -Infinity;
    let bestInsertPos = 0;

    const firstMid = blocks[0].rect.top;
    if (clientY <= firstMid) {
      bestGapY = blocks[0].rect.top;
      bestInsertPos = blocks[0].pos;
    } else {
      for (let i = 0; i < blocks.length - 1; i++) {
        const gapY = (blocks[i].rect.bottom + blocks[i + 1].rect.top) / 2;
        if (clientY > gapY) {
          bestGapY = blocks[i + 1].rect.top;
          bestInsertPos = blocks[i + 1].pos;
        }
      }
      const last = blocks[blocks.length - 1];
      if (clientY > (last.rect.bottom + last.rect.top) / 2) {
        bestGapY = last.rect.bottom;
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
  // Handle drag events
  // ---------------------------------------------------------------------------

  function onHandleDragStart(view: EditorView, e: DragEvent) {
    if (activeNodePos === null) return;

    const { doc } = view.state;
    const node = doc.nodeAt(activeNodePos);
    if (!node) return;

    dragState = {
      sourcePos: activeNodePos,
      sourceNode: node,
      rafId: null,
    };

    try {
      const dom = view.nodeDOM(activeNodePos);
      if (dom instanceof Element) {
        dom.classList.add('dragging-source');
      }
    } catch {
      // ignore
    }

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.textContent);
      try {
        const dom = view.nodeDOM(activeNodePos);
        if (dom instanceof Element) {
          e.dataTransfer.setDragImage(dom as HTMLElement, 20, 20);
        }
      } catch {
        // fallback to default
      }
    }

    if (handleEl) handleEl.style.display = 'none';
  }

  function onHandleDragEnd(view: EditorView) {
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

  function onEditorDragOver(view: EditorView, e: DragEvent) {
    if (!dragState) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

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
    const targetPos = positionIndicatorBetweenBlocks(view, e.clientY);

    hideIndicator();
    onHandleDragEnd(view);

    if (targetPos === null) return true;

    const nodeEnd = sourcePos + sourceNode.nodeSize;
    if (targetPos >= sourcePos && targetPos <= nodeEnd) return true;

    const { state } = view;
    let tr = state.tr;
    const adjustedTarget = targetPos > nodeEnd ? targetPos - sourceNode.nodeSize : targetPos;

    tr = tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
    tr = tr.insert(adjustedTarget, sourceNode);
    tr = tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(adjustedTarget + 1, tr.doc.content.size)))
    );

    view.dispatch(tr);
    return true;
  }

  function onEditorDragLeave(_view: EditorView, e: DragEvent) {
    const related = e.relatedTarget;
    if (!related || !(currentView?.dom.contains(related as Node))) {
      hideIndicator();
    }
  }

  // ---------------------------------------------------------------------------
  // Mousemove — find the top-level block at the mouse's vertical position.
  // Listens on the editor DOM itself (which includes its padding/margin area).
  // ---------------------------------------------------------------------------

  function findBlockAtClientY(view: EditorView, clientY: number): { dom: Element; pos: number } | null {
    const { doc } = view.state;
    let bestDom: Element | null = null;
    let bestPos = -1;
    let bestDist = Infinity;

    doc.forEach((node, offset) => {
      if (isEmptyParagraph(node)) return;
      try {
        const dom = view.nodeDOM(offset);
        if (!(dom instanceof Element)) return;
        const rect = dom.getBoundingClientRect();
        if (clientY >= rect.top - 4 && clientY <= rect.bottom + 4) {
          const mid = (rect.top + rect.bottom) / 2;
          const dist = Math.abs(clientY - mid);
          if (dist < bestDist) {
            bestDist = dist;
            bestDom = dom;
            bestPos = offset;
          }
        }
      } catch {
        // skip
      }
    });

    if (bestDom && bestPos !== -1) return { dom: bestDom, pos: bestPos };
    return null;
  }

  function onMouseMove(view: EditorView, e: MouseEvent) {
    if (dragState) return;

    // If hovering the handle itself, cancel any pending hide
    if (e.target === handleEl || handleEl?.contains(e.target as Node)) {
      cancelHide();
      return;
    }

    const block = findBlockAtClientY(view, e.clientY);
    if (block) {
      cancelHide();
      positionHandleAtY(view, e.clientY, block.pos);
    } else {
      scheduleHide();
    }
  }

  function onMouseLeave(_view: EditorView, e: MouseEvent) {
    const related = e.relatedTarget;
    // Don't hide if moving to the handle element
    if (related === handleEl || handleEl?.contains(related as Node)) return;
    scheduleHide();
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

      // Mount handle and indicator into the editor DOM itself (which has padding
      // for the gutter). This ensures the handle is within the same coordinate
      // space and mouse events fire in the margin area.
      const editorDom = editorView.dom;

      // Ensure editor DOM is a positioning context
      const editorStyle = getComputedStyle(editorDom);
      if (editorStyle.position === 'static') {
        editorDom.style.position = 'relative';
      }

      handleEl = createHandleElement();
      handleEl.style.display = 'none';
      editorDom.appendChild(handleEl);

      indicatorEl = createDropIndicator();
      indicatorEl.style.display = 'none';
      editorDom.appendChild(indicatorEl);

      // Handle drag events
      const handleDragStart = (e: DragEvent) => onHandleDragStart(editorView, e);
      const handleDragEnd = () => onHandleDragEnd(editorView);
      handleEl.addEventListener('dragstart', handleDragStart);
      handleEl.addEventListener('dragend', handleDragEnd);

      // Keep handle visible when hovering it
      const handleMouseEnter = () => cancelHide();
      const handleMouseLeaveHandler = (e: MouseEvent) => {
        const related = e.relatedTarget;
        if (related && editorDom.contains(related as Node)) return;
        scheduleHide();
      };
      handleEl.addEventListener('mouseenter', handleMouseEnter);
      handleEl.addEventListener('mouseleave', handleMouseLeaveHandler);

      // Mouse events on the editor DOM (includes padding = gutter area)
      const editorMouseMove = (e: MouseEvent) => onMouseMove(editorView, e);
      const editorMouseLeave = (e: MouseEvent) => onMouseLeave(editorView, e);
      const editorDragOver = (e: DragEvent) => onEditorDragOver(editorView, e);
      const editorDrop = (e: DragEvent) => { onEditorDrop(editorView, e); };
      const editorDragLeave = (e: DragEvent) => onEditorDragLeave(editorView, e);

      editorDom.addEventListener('mousemove', editorMouseMove);
      editorDom.addEventListener('mouseleave', editorMouseLeave);
      editorDom.addEventListener('dragover', editorDragOver);
      editorDom.addEventListener('drop', editorDrop);
      editorDom.addEventListener('dragleave', editorDragLeave);

      return {
        update(_view: EditorView, _prevState: EditorState) {
          // Handle positioning is driven by mousemove events
        },
        destroy() {
          if (hideTimer) clearTimeout(hideTimer);

          editorDom.removeEventListener('mousemove', editorMouseMove);
          editorDom.removeEventListener('mouseleave', editorMouseLeave);
          editorDom.removeEventListener('dragover', editorDragOver);
          editorDom.removeEventListener('drop', editorDrop);
          editorDom.removeEventListener('dragleave', editorDragLeave);

          if (handleEl) {
            handleEl.removeEventListener('dragstart', handleDragStart);
            handleEl.removeEventListener('dragend', handleDragEnd);
            handleEl.removeEventListener('mouseenter', handleMouseEnter);
            handleEl.removeEventListener('mouseleave', handleMouseLeaveHandler);
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
