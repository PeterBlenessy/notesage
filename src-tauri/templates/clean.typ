// Clean template — minimal, generous whitespace, sans-serif body.
// Good for general notes and sharing.

#let template(
  title: "",
  include-toc: false,
  include-page-numbers: false,
  body,
) = {
  set document(title: title)

  set page(
    margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
    footer: if include-page-numbers {
      context align(center, text(size: 9pt, fill: luma(120))[
        #counter(page).display()
      ])
    },
  )

  set text(
    font: "Inter",
    size: 11pt,
    fill: luma(30),
  )

  set par(
    leading: 0.8em,
    justify: false,
  )

  // Heading styles
  show heading.where(level: 1): it => {
    set text(size: 24pt, weight: "bold")
    v(0.5em)
    it
    v(0.3em)
  }

  show heading.where(level: 2): it => {
    set text(size: 18pt, weight: "semibold")
    v(0.4em)
    it
    v(0.2em)
  }

  show heading.where(level: 3): it => {
    set text(size: 14pt, weight: "semibold")
    v(0.3em)
    it
    v(0.15em)
  }

  show heading.where(level: 4): it => {
    set text(size: 12pt, weight: "semibold")
    v(0.2em)
    it
    v(0.1em)
  }

  // Code block styling
  show raw.where(block: true): it => {
    set text(font: "JetBrains Mono", size: 9.5pt)
    block(
      width: 100%,
      fill: luma(245),
      radius: 4pt,
      inset: 12pt,
      it,
    )
  }

  show raw.where(block: false): set text(font: "JetBrains Mono", size: 10pt)

  // Link styling
  show link: it => {
    set text(fill: luma(60))
    underline(it)
  }

  // Table styling
  show table: set table(
    stroke: 0.5pt + luma(200),
    inset: 8pt,
  )

  show table.cell.where(y: 0): set text(weight: "semibold")

  // Keep headings with following content
  show heading: set block(breakable: false, below: 1.2em)

  // Title
  if title != "" {
    text(size: 28pt, weight: "bold")[#title]
    v(1.5em)
  }

  // Table of contents
  if include-toc {
    outline(indent: 1.5em)
    v(2em)
  }

  body
}
