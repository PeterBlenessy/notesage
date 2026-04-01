import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { DocumentPageSettings, PageHeaderFooter } from '@/lib/page-settings'
import { resolveVariables, hasContent, parsePageSettings, getEffectiveColumns } from '@/lib/page-settings'
import { useEditorStore } from '@/stores/editor-store'
import { useSettingsStore } from '@/stores/settings-store'
import { PX_PER_CM, CONTENT_HEIGHTS } from '@/components/editor/editor-utils'

export const pageBreaksKey = new PluginKey('pageBreaks')

/** Custom event fired when a header/footer zone is clicked. */
export const PAGE_HF_CLICK_EVENT = 'notesage:page-hf-click'

/** Custom event fired to request recalculation (e.g. after closing the HF editor). */
export const PAGE_BREAKS_RECALC_EVENT = 'notesage:page-breaks-recalc'

export interface PageHFClickDetail {
  page: number
  type: 'header' | 'footer'
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
  pageNumberStart: number,
): HTMLDivElement {
  const zone = document.createElement('div')
  zone.className = `page-${zoneType}-zone`
  zone.setAttribute('contenteditable', 'false')
  zone.dataset.page = String(page)

  const displayPage = page + (pageNumberStart - 1)
  const displayTotal = totalPages + (pageNumberStart - 1)
  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const vars = { page: displayPage, pages: displayTotal, title, date: dateStr }
  const cols = getEffectiveColumns(hf, displayPage)
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
    leftSpan.textContent = ''
    centerSpan.textContent = zoneType === 'header' ? 'Click to add header' : 'Click to add footer'
    rightSpan.textContent = ''
  }

  zone.addEventListener('click', (e) => {
    if (zone.classList.contains('page-hf-editing')) return
    e.stopPropagation()
    window.dispatchEvent(
      new CustomEvent<PageHFClickDetail>(PAGE_HF_CLICK_EVENT, {
        detail: { page, type: zoneType, zoneElement: zone },
      }),
    )
  })

  return zone
}

/** Simple fingerprint of settings to bust ProseMirror's decoration key cache. */
function settingsFingerprint(ps: DocumentPageSettings, title: string): string {
  return JSON.stringify([ps.header, ps.footer, ps.pageNumberStart, title])
}

function resolveDocumentTitle(doc: { forEach: (fn: (node: { type: { name: string }; textContent: string }) => boolean | void) => void }): string {
  let title = ''
  doc.forEach((node) => {
    if (!title && node.type.name === 'heading') {
      title = node.textContent || ''
      return false
    }
  })
  return title
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

            const wrapper = editorView.dom.parentElement

            // Skip recalc while editing a header/footer zone
            if (wrapper?.querySelector('.page-hf-editing')) return

            const editorStore = useEditorStore.getState()
            const settingsStore = useSettingsStore.getState()
            const activeTab = editorStore.tabs.find((t) => t.id === editorStore.activeTabId)
            const pageSettings: DocumentPageSettings = parsePageSettings(activeTab?.frontmatter ?? null)
            const docTitle = resolveDocumentTitle(editorView.state.doc)

            // Read page layout state directly from the settings store
            const { contentWidth, printLayout } = settingsStore
            const isPaperMode = contentWidth === 'a4' || contentWidth === 'a5' || contentWidth === 'letter'
            const isPrintLayout = isPaperMode && printLayout
            const pageHeight = isPaperMode ? (CONTENT_HEIGHTS[contentWidth] ?? 0) : 0

            if (!pageHeight || !isPrintLayout) {
              // No page layout or print layout off — clear all decorations
              const current = pageBreaksKey.getState(editorView.state)
              if (current && current !== DecorationSet.empty) {
                editorView.dispatch(
                  editorView.state.tr.setMeta(pageBreaksKey, DecorationSet.empty)
                )
              }
              return
            }

            // Read margin values directly from the settings store (in cm → px)
            const marginTopPx = settingsStore.marginTop * PX_PER_CM
            const marginBottomPx = settingsStore.marginBottom * PX_PER_CM
            const usablePerPage = pageHeight - marginTopPx - marginBottomPx
            if (usablePerPage <= 0) return

            const { doc } = editorView.state

            // --- Measure all nodes ---
            const nodes: { offset: number; height: number; typeName: string }[] = []
            doc.forEach((node, offset) => {
              const dom = editorView.nodeDOM(offset)
              if (!dom || !(dom instanceof HTMLElement)) return
              const style = getComputedStyle(dom)
              const mt = parseFloat(style.marginTop) || 0
              const mb = parseFloat(style.marginBottom) || 0
              nodes.push({ offset, height: dom.offsetHeight + mt + mb, typeName: node.type.name })
            })

            // --- Calculate page breaks ---
            let contentHeight = 0
            let pageNumber = 1
            const breaks: { offset: number; remainder: number }[] = []

            for (let i = 0; i < nodes.length; i++) {
              const { offset, height: nodeHeight } = nodes[i]

              if (contentHeight > 0 && contentHeight + nodeHeight > pageNumber * usablePerPage) {
                let breakOffset = offset
                if (i > 0 && nodes[i - 1].typeName === 'heading') {
                  breakOffset = nodes[i - 1].offset
                  contentHeight -= nodes[i - 1].height
                }

                const usedOnPage = contentHeight - (pageNumber - 1) * usablePerPage
                const pageRemainder = Math.max(0, usablePerPage - usedOnPage)

                breaks.push({ offset: breakOffset, remainder: pageRemainder })

                contentHeight = pageNumber * usablePerPage
                pageNumber++
              }

              contentHeight += nodeHeight
            }

            const totalPages = pageNumber

            // Last page remainder
            const lastUsed = contentHeight - (pageNumber - 1) * usablePerPage
            const lastRemainder = Math.max(0, usablePerPage - lastUsed)

            // --- Build final decorations ---
            const finalDecorations: Decoration[] = []
            // Include settings fingerprint in keys so ProseMirror recreates
            // widgets when header/footer content changes (not just position).
            const fp = settingsFingerprint(pageSettings, docTitle)
            const marginBottomRound = Math.round(marginBottomPx)

            // Page 1 top-margin at position 0
            finalDecorations.push(
              Decoration.widget(0, () => {
                const container = document.createElement('div')
                container.className = 'page-top-margin'
                container.setAttribute('contenteditable', 'false')
                container.style.height = `${Math.round(marginTopPx)}px`
                const zone = createZoneElement(
                  'header', pageSettings.header,
                  1, totalPages, docTitle, pageSettings.pageNumberStart,
                )
                container.appendChild(zone)
                return container
              }, { side: -1, key: `page-top-margin-1-${fp}` })
            )

            // Between pages: bottom-margin + gap + top-margin at each break
            for (let b = 0; b < breaks.length; b++) {
              const { offset, remainder } = breaks[b]
              const pageEnding = b + 1    // page that just ended
              const pageStarting = b + 2  // page that's starting

              // Bottom-margin for page that ended (height = remainder + marginBottom)
              const bmHeight = remainder + marginBottomPx
              finalDecorations.push(
                Decoration.widget(offset, () => {
                  const container = document.createElement('div')
                  container.className = 'page-bottom-margin'
                  container.setAttribute('contenteditable', 'false')
                  container.style.height = `${Math.round(bmHeight)}px`
                  const zone = createZoneElement(
                    'footer', pageSettings.footer,
                    pageEnding, totalPages, docTitle, pageSettings.pageNumberStart,
                  )
                  zone.style.height = `${marginBottomRound}px`
                  container.appendChild(zone)
                  return container
                }, { side: -1, key: `page-bottom-margin-${pageEnding}-${fp}` })
              )

              // Gap strip (32px visual separator)
              finalDecorations.push(
                Decoration.widget(offset, () => {
                  const gap = document.createElement('div')
                  gap.className = 'page-gap'
                  gap.setAttribute('contenteditable', 'false')
                  return gap
                }, { side: -1, key: `page-gap-${pageEnding}` })
              )

              // Top-margin for next page
              finalDecorations.push(
                Decoration.widget(offset, () => {
                  const container = document.createElement('div')
                  container.className = 'page-top-margin'
                  container.setAttribute('contenteditable', 'false')
                  container.style.height = `${Math.round(marginTopPx)}px`
                  const zone = createZoneElement(
                    'header', pageSettings.header,
                    pageStarting, totalPages, docTitle, pageSettings.pageNumberStart,
                  )
                  container.appendChild(zone)
                  return container
                }, { side: -1, key: `page-top-margin-${pageStarting}-${fp}` })
              )
            }

            // Last page bottom-margin at doc end (height = lastRemainder + marginBottom)
            const lastBmHeight = lastRemainder + marginBottomPx
            finalDecorations.push(
              Decoration.widget(doc.content.size, () => {
                const container = document.createElement('div')
                container.className = 'page-bottom-margin'
                container.setAttribute('contenteditable', 'false')
                container.style.height = `${Math.round(lastBmHeight)}px`
                const zone = createZoneElement(
                  'footer', pageSettings.footer,
                  totalPages, totalPages, docTitle, pageSettings.pageNumberStart,
                )
                zone.style.height = `${marginBottomRound}px`
                container.appendChild(zone)
                return container
              }, { side: 1, key: `page-bottom-margin-${totalPages}-${fp}` })
            )

            const newSet = DecorationSet.create(doc, finalDecorations)
            editorView.dispatch(
              editorView.state.tr.setMeta(pageBreaksKey, newSet)
            )
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

          const unsubEditorStore = useEditorStore.subscribe(scheduleCalculation)
          const unsubSettingsStore = useSettingsStore.subscribe(scheduleCalculation)

          // Listen for recalc requests (e.g. after closing the HF editor)
          const handleRecalc = () => scheduleCalculation()
          window.addEventListener(PAGE_BREAKS_RECALC_EVENT, handleRecalc)

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCalculation()
              }
            },
            destroy() {
              if (rafId !== null) cancelAnimationFrame(rafId)
              resizeObserver.disconnect()
              unsubEditorStore()
              unsubSettingsStore()
              window.removeEventListener(PAGE_BREAKS_RECALC_EVENT, handleRecalc)
            },
          }
        },
      }),
    ]
  },
})
