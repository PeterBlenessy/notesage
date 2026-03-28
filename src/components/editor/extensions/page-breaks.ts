import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const pageBreaksKey = new PluginKey('pageBreaks')

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

            doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset)
              if (!dom || !(dom instanceof HTMLElement)) return

              const style = getComputedStyle(dom)
              const marginTop = parseFloat(style.marginTop) || 0
              const marginBottom = parseFloat(style.marginBottom) || 0
              const nodeHeight = dom.offsetHeight + marginTop + marginBottom

              if (contentHeight > 0 && contentHeight + nodeHeight > pageNumber * usablePerPage) {
                decorations.push(
                  Decoration.widget(offset, () => {
                    const gap = document.createElement('div')
                    gap.className = 'page-break-gap'
                    gap.setAttribute('contenteditable', 'false')
                    return gap
                  }, { side: -1, key: `page-break-${pageNumber}` })
                )
                pageNumber++
              }

              contentHeight += nodeHeight
            })

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

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCalculation()
              }
            },
            destroy() {
              if (rafId !== null) cancelAnimationFrame(rafId)
              resizeObserver.disconnect()
            },
          }
        },
      }),
    ]
  },
})
