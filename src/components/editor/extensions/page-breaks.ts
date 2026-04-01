import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { DocumentPageSettings, PageHeaderFooter } from '@/lib/page-settings'
import { resolveVariables, hasContent, parsePageSettings } from '@/lib/page-settings'
import { useEditorStore } from '@/stores/editor-store'

export const pageBreaksKey = new PluginKey('pageBreaks')

/** Custom event fired when a header/footer zone is clicked. */
export const PAGE_HF_CLICK_EVENT = 'notesage:page-hf-click'

export interface PageHFClickDetail {
  page: number
  type: 'header' | 'footer'
  /** The zone DOM element that was clicked — used as portal target */
  zoneElement: HTMLDivElement
}

// ---------------------------------------------------------------------------
// Zone DOM helpers
// ---------------------------------------------------------------------------

function createZoneElement(
  zoneType: 'header' | 'footer',
  hf: PageHeaderFooter,
  page: number,
  totalPages: number,
  title: string,
  isFirstPage: boolean,
): HTMLDivElement {
  const zone = document.createElement('div')
  zone.className = `page-${zoneType}-zone`
  zone.setAttribute('contenteditable', 'false')
  zone.dataset.page = String(page)

  const vars = { page, pages: totalPages, title, date: new Date().toLocaleDateString() }
  const cols = isFirstPage && hf.differentFirstPage && hf.firstPage ? hf.firstPage : hf
  const left = resolveVariables(cols.left, vars)
  const center = resolveVariables(cols.center, vars)
  const right = resolveVariables(cols.right, vars)

  const leftSpan = document.createElement('span')
  leftSpan.className = 'page-hf-col page-hf-left'
  leftSpan.textContent = left
  zone.appendChild(leftSpan)

  const centerSpan = document.createElement('span')
  centerSpan.className = 'page-hf-col page-hf-center'
  centerSpan.textContent = center
  zone.appendChild(centerSpan)

  const rightSpan = document.createElement('span')
  rightSpan.className = 'page-hf-col page-hf-right'
  rightSpan.textContent = right
  zone.appendChild(rightSpan)

  if (!hasContent(hf)) {
    zone.classList.add('page-hf-empty')
    // Clear the three columns and show a centered placeholder instead
    leftSpan.textContent = ''
    centerSpan.textContent = zoneType === 'header' ? 'Click to add header' : 'Click to add footer'
    rightSpan.textContent = ''
  }

  zone.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(
      new CustomEvent<PageHFClickDetail>(PAGE_HF_CLICK_EVENT, {
        detail: { page, type: zoneType, zoneElement: zone },
      }),
    )
  })

  return zone
}

function resolveDocumentTitle(doc: { firstChild: { type: { name: string }; textContent: string } | null }): string {
  const first = doc.firstChild
  return first && first.type.name === 'heading' ? (first.textContent || '') : ''
}

// ---------------------------------------------------------------------------
// Overlay: renders all header/footer zones as absolute-positioned elements
// inside the contentRef wrapper, completely independent of gap decorations.
// ---------------------------------------------------------------------------

const OVERLAY_CLASS = 'page-zone-overlay'

function updatePageZones(
  wrapper: HTMLElement | null,
  editorDom: HTMLElement,
  pageSettings: DocumentPageSettings | null,
  totalPages: number,
  docTitle: string,
  pageHeight: number,
  paddingTop: number,
  paddingBottom: number,
) {
  if (!wrapper) return

  // Remove previous overlay
  wrapper.querySelector(`:scope > .${OVERLAY_CLASS}`)?.remove()

  if (!pageSettings || !totalPages || !pageHeight) return

  const overlay = document.createElement('div')
  overlay.className = OVERLAY_CLASS
  wrapper.appendChild(overlay)

  const editorY = editorDom.offsetTop
  const gaps = Array.from(editorDom.querySelectorAll<HTMLElement>('.page-break-gap'))

  // Each zone fills the entire margin area (top margin = header, bottom margin = footer)
  const addZone = (zoneType: 'header' | 'footer', page: number, marginY: number, marginSize: number) => {
    const zone = createZoneElement(zoneType, zoneType === 'header' ? pageSettings.header : pageSettings.footer,
      page, totalPages, docTitle, page === 1)
    zone.style.top = `${Math.round(marginY)}px`
    zone.style.height = `${Math.round(marginSize)}px`
    overlay.appendChild(zone)
  }

  // --- Page 1 ---
  addZone('header', 1, editorY, paddingTop)

  if (gaps.length === 0) {
    // Single page: footer at the bottom of the editor
    addZone('footer', 1, editorY + editorDom.offsetHeight - paddingBottom, paddingBottom)
    return
  }

  // Footer for page 1: sits in the bottom-margin area before the first gap strip.
  // The gap includes: remainder + paddingBottom + gapStrip + paddingTop.
  // The bottom margin of the current page occupies [gapTop, gapTop + remainder + paddingBottom].
  const gap0 = gaps[0]
  const gap0Top = editorY + gap0.offsetTop
  const gap0Remainder = parseFloat(gap0.style.getPropertyValue('--page-remainder')) || 0
  addZone('footer', 1, gap0Top + gap0Remainder, paddingBottom)

  // --- Interior pages (between gaps) ---
  for (let g = 0; g < gaps.length; g++) {
    const gap = gaps[g]
    const gapTop = editorY + gap.offsetTop
    const gapH = gap.offsetHeight
    const pageBelow = g + 2

    // Header for the page below this gap: in the top-margin area after the gap strip.
    // Top margin starts at gapTop + gapH - paddingTop.
    addZone('header', pageBelow, gapTop + gapH - paddingTop, paddingTop)

    // Footer for that page: before the NEXT gap, or at the editor bottom for the last page.
    if (g + 1 < gaps.length) {
      const nextGap = gaps[g + 1]
      const nextGapTop = editorY + nextGap.offsetTop
      const nextRemainder = parseFloat(nextGap.style.getPropertyValue('--page-remainder')) || 0
      addZone('footer', pageBelow, nextGapTop + nextRemainder, paddingBottom)
    } else {
      // Last page footer
      addZone('footer', pageBelow, editorY + editorDom.offsetHeight - paddingBottom, paddingBottom)
    }
  }
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const PageBreaks = Extension.create({
  name: 'pageBreaks',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pageBreaksKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, old) {
            const meta = tr.getMeta(pageBreaksKey)
            if (meta !== undefined) return meta
            if (tr.docChanged) return old.map(tr.mapping, tr.doc)
            return old
          },
        },
        props: {
          decorations(state) {
            return pageBreaksKey.getState(state)
          },
        },
        view(editorView) {
          let rafId: number | null = null
          let zoneRafId: number | null = null

          const calculate = () => {
            rafId = null

            // Read page settings directly from the Zustand store
            const store = useEditorStore.getState()
            const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
            const pageSettings: DocumentPageSettings = parsePageSettings(activeTab?.frontmatter ?? null)
            const docTitle = resolveDocumentTitle(editorView.state.doc)

            const wrapper = editorView.dom.parentElement
            const pageHeightStr = wrapper
              ? getComputedStyle(wrapper).getPropertyValue('--page-height')
              : ''
            const pageHeight = parseFloat(pageHeightStr) || 0

            if (!pageHeight) {
              const current = pageBreaksKey.getState(editorView.state)
              if (current && current !== DecorationSet.empty) {
                editorView.dispatch(
                  editorView.state.tr.setMeta(pageBreaksKey, DecorationSet.empty)
                )
              }
              // Clean up overlay when not in paged mode
              updatePageZones(wrapper, editorView.dom, null, 0, '', 0, 0, 0)
              return
            }

            const editorStyle = getComputedStyle(editorView.dom)
            const paddingTop = parseFloat(editorStyle.paddingTop) || 0
            const paddingBottom = parseFloat(editorStyle.paddingBottom) || 0
            const usablePerPage = pageHeight - paddingTop - paddingBottom
            if (usablePerPage <= 0) return

            const { doc } = editorView.state
            const decorations: Decoration[] = []
            let contentHeight = 0
            let pageNumber = 1

            // Collect node info for page break calculation
            const nodes: { node: typeof doc.firstChild; offset: number; height: number }[] = []
            doc.forEach((node, offset) => {
              const dom = editorView.nodeDOM(offset)
              if (!dom || !(dom instanceof HTMLElement)) return
              const style = getComputedStyle(dom)
              const marginTop = parseFloat(style.marginTop) || 0
              const marginBottom = parseFloat(style.marginBottom) || 0
              nodes.push({ node, offset, height: dom.offsetHeight + marginTop + marginBottom })
            })

            for (let i = 0; i < nodes.length; i++) {
              const { offset, height: nodeHeight } = nodes[i]

              if (contentHeight > 0 && contentHeight + nodeHeight > pageNumber * usablePerPage) {
                let breakOffset = offset
                const breakKey = pageNumber
                if (i > 0 && nodes[i - 1].node?.type.name === 'heading') {
                  breakOffset = nodes[i - 1].offset
                  contentHeight -= nodes[i - 1].height
                }

                const usedOnPage = contentHeight - (pageNumber - 1) * usablePerPage
                const pageRemainder = usablePerPage - usedOnPage

                // Gap decoration — purely visual, no header/footer children
                decorations.push(
                  Decoration.widget(breakOffset, () => {
                    const gap = document.createElement('div')
                    gap.className = 'page-break-gap'
                    gap.setAttribute('contenteditable', 'false')
                    gap.style.setProperty('--page-remainder', `${Math.max(0, pageRemainder)}px`)
                    return gap
                  }, { side: -1, key: `page-break-${breakKey}` })
                )
                contentHeight = pageNumber * usablePerPage
                pageNumber++
              }

              contentHeight += nodeHeight
            }

            const totalPages = pageNumber

            // Pad the last page to full height
            const lastPageUsed = contentHeight - (pageNumber - 1) * usablePerPage
            const remaining = usablePerPage - lastPageUsed
            if (remaining > 1) {
              decorations.push(
                Decoration.widget(doc.content.size, () => {
                  const pad = document.createElement('div')
                  pad.style.height = `${remaining}px`
                  pad.style.pointerEvents = 'none'
                  pad.setAttribute('contenteditable', 'false')
                  return pad
                }, { side: 1, key: 'page-pad-last' })
              )
            }

            const newSet = DecorationSet.create(doc, decorations)
            editorView.dispatch(
              editorView.state.tr.setMeta(pageBreaksKey, newSet)
            )

            // After the decoration dispatch, wait one frame for the DOM to
            // update with the new gap elements, then position the overlay zones.
            if (zoneRafId !== null) cancelAnimationFrame(zoneRafId)
            zoneRafId = requestAnimationFrame(() => {
              zoneRafId = null
              updatePageZones(
                wrapper, editorView.dom, pageSettings,
                totalPages, docTitle, pageHeight, paddingTop, paddingBottom,
              )
            })
          }

          const scheduleCalculation = () => {
            if (rafId !== null) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(calculate)
          }

          scheduleCalculation()

          const resizeObserver = new ResizeObserver(() => {
            scheduleCalculation()
          })
          resizeObserver.observe(editorView.dom)

          const unsubStore = useEditorStore.subscribe(scheduleCalculation)

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCalculation()
              }
            },
            destroy() {
              if (rafId !== null) cancelAnimationFrame(rafId)
              if (zoneRafId !== null) cancelAnimationFrame(zoneRafId)
              resizeObserver.disconnect()
              unsubStore()
              updatePageZones(editorView.dom.parentElement, editorView.dom, null, 0, '', 0, 0, 0)
            },
          }
        },
      }),
    ]
  },
})
