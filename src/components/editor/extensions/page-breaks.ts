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
  rect: DOMRect
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
  }

  zone.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    window.dispatchEvent(
      new CustomEvent<PageHFClickDetail>(PAGE_HF_CLICK_EVENT, {
        detail: { page, type: zoneType, rect: zone.getBoundingClientRect() },
      }),
    )
  })

  return zone
}

function resolveDocumentTitle(doc: { firstChild: { type: { name: string }; textContent: string } | null }): string {
  const first = doc.firstChild
  return first && first.type.name === 'heading' ? (first.textContent || '') : ''
}

/**
 * Update the page-1 header and last-page footer that live as direct DOM
 * children of the editor element (outside ProseMirror's decoration system).
 */
function updateEdgeZones(
  editorDom: HTMLElement,
  pageSettings: DocumentPageSettings | null,
  totalPages: number,
  docTitle: string,
) {
  // Remove previous edge zones
  editorDom.querySelectorAll(':scope > .page-edge-header, :scope > .page-edge-footer').forEach((el) => el.remove())

  if (!pageSettings) return

  // Page 1 header — sits inside the editor's top padding
  const headerWrapper = document.createElement('div')
  headerWrapper.className = 'page-edge-header'
  headerWrapper.setAttribute('contenteditable', 'false')
  headerWrapper.appendChild(createZoneElement('header', pageSettings.header, 1, totalPages, docTitle, true))
  editorDom.insertBefore(headerWrapper, editorDom.firstChild)

  // Last page footer — sits inside the editor's bottom padding (before the last-page pad)
  const footerWrapper = document.createElement('div')
  footerWrapper.className = 'page-edge-footer'
  footerWrapper.setAttribute('contenteditable', 'false')
  footerWrapper.appendChild(createZoneElement('footer', pageSettings.footer, totalPages, totalPages, docTitle, totalPages === 1))
  editorDom.appendChild(footerWrapper)
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

          const calculate = () => {
            rafId = null

            // Read page settings directly from the Zustand store (no dispatch needed)
            const store = useEditorStore.getState()
            const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
            const pageSettings: DocumentPageSettings = parsePageSettings(activeTab?.frontmatter ?? null)
            const docTitle = resolveDocumentTitle(editorView.state.doc)

            // Read page height from CSS variable on the wrapper element
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
              // Clean up edge zones when not in paged mode
              updateEdgeZones(editorView.dom, null, 0, '')
              return
            }

            // Read top and bottom padding separately from the editor element
            const editorStyle = getComputedStyle(editorView.dom)
            const paddingTop = parseFloat(editorStyle.paddingTop) || 0
            const paddingBottom = parseFloat(editorStyle.paddingBottom) || 0

            // Usable content area per page = page height minus top and bottom margins
            const usablePerPage = pageHeight - paddingTop - paddingBottom
            if (usablePerPage <= 0) return

            const { doc } = editorView.state
            const decorations: Decoration[] = []
            let contentHeight = 0
            let pageNumber = 1

            // Collect node info first so we can look back for widow headings
            const nodes: { node: typeof doc.firstChild; offset: number; height: number }[] = []
            doc.forEach((node, offset) => {
              const dom = editorView.nodeDOM(offset)
              if (!dom || !(dom instanceof HTMLElement)) return
              const style = getComputedStyle(dom)
              const marginTop = parseFloat(style.marginTop) || 0
              const marginBottom = parseFloat(style.marginBottom) || 0
              nodes.push({ node, offset, height: dom.offsetHeight + marginTop + marginBottom })
            })

            const breakPages: number[] = []

            for (let i = 0; i < nodes.length; i++) {
              const { offset, height: nodeHeight } = nodes[i]

              if (contentHeight > 0 && contentHeight + nodeHeight > pageNumber * usablePerPage) {
                // Widow heading prevention: if the previous node is a heading,
                // move the break before it so it stays with its following content
                let breakOffset = offset
                const breakKey = pageNumber
                if (i > 0 && nodes[i - 1].node?.type.name === 'heading') {
                  breakOffset = nodes[i - 1].offset
                  contentHeight -= nodes[i - 1].height
                }

                breakPages.push(pageNumber)

                // Remaining whitespace on the current page before the break
                const usedOnPage = contentHeight - (pageNumber - 1) * usablePerPage
                const pageRemainder = usablePerPage - usedOnPage

                const currentPageNumber = pageNumber
                decorations.push(
                  Decoration.widget(breakOffset, () => {
                    const totalPages = breakPages.length + 1
                    const gap = document.createElement('div')
                    gap.className = 'page-break-gap'
                    gap.setAttribute('contenteditable', 'false')
                    gap.style.setProperty('--page-remainder', `${Math.max(0, pageRemainder)}px`)

                    // Footer for the page that just ended (inside the gap)
                    if (pageSettings) {
                      gap.appendChild(createZoneElement(
                        'footer', pageSettings.footer,
                        currentPageNumber, totalPages, docTitle, currentPageNumber === 1,
                      ))
                    }

                    // Header for the next page (inside the gap)
                    if (pageSettings) {
                      gap.appendChild(createZoneElement(
                        'header', pageSettings.header,
                        currentPageNumber + 1, totalPages, docTitle, false,
                      ))
                    }

                    return gap
                  }, { side: -1, key: `page-break-${breakKey}` })
                )
                contentHeight = pageNumber * usablePerPage
                pageNumber++
              }

              contentHeight += nodeHeight
            }

            const totalPages = pageNumber

            // Pad the last page to full height so it renders as a complete page
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

            // Page 1 header & last page footer — direct DOM, not decorations
            updateEdgeZones(editorView.dom, pageSettings, totalPages, docTitle)
          }

          const scheduleCalculation = () => {
            if (rafId !== null) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(calculate)
          }

          // Initial calculation
          scheduleCalculation()

          // Recalculate when editor element resizes (settings changes, window resize)
          const resizeObserver = new ResizeObserver(() => {
            scheduleCalculation()
          })
          resizeObserver.observe(editorView.dom)

          // Subscribe to Zustand store changes so we recalculate when
          // frontmatter (page settings) changes
          const unsubStore = useEditorStore.subscribe(scheduleCalculation)

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCalculation()
              }
            },
            destroy() {
              if (rafId !== null) cancelAnimationFrame(rafId)
              resizeObserver.disconnect()
              unsubStore()
              updateEdgeZones(editorView.dom, null, 0, '')
            },
          }
        },
      }),
    ]
  },
})
