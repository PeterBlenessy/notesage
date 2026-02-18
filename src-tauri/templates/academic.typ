// Academic template — serif body font, tighter spacing, numbered headings.
// Suitable for papers and reports.

#let template(
  title: "",
  include-toc: true,
  include-page-numbers: true,
  body,
) = {
  set document(title: title)

  set page(
    margin: (top: 2.5cm, bottom: 2.5cm, left: 3cm, right: 3cm),
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: 9pt, fill: luma(120))
        grid(
          columns: (1fr, 1fr),
          align(left, emph(title)),
          align(right, counter(page).display()),
        )
        v(-4pt)
        line(length: 100%, stroke: 0.4pt + luma(200))
      }
    },
    footer: if include-page-numbers {
      context {
        if counter(page).get().first() == 1 {
          align(center, text(size: 9pt, fill: luma(120))[
            #counter(page).display()
          ])
        }
      }
    },
  )

  set text(
    font: "Source Serif 4",
    size: 11pt,
    fill: luma(20),
  )

  set par(
    leading: 0.7em,
    justify: true,
    first-line-indent: 0em,
  )

  // Numbered headings
  set heading(numbering: "1.1")

  // Heading styles
  show heading.where(level: 1): it => {
    set text(font: "Inter", size: 20pt, weight: "bold")
    v(0.6em)
    it
    v(0.3em)
  }

  show heading.where(level: 2): it => {
    set text(font: "Inter", size: 15pt, weight: "semibold")
    v(0.5em)
    it
    v(0.2em)
  }

  show heading.where(level: 3): it => {
    set text(font: "Inter", size: 12pt, weight: "semibold")
    v(0.4em)
    it
    v(0.15em)
  }

  show heading.where(level: 4): it => {
    set text(font: "Inter", size: 11pt, weight: "semibold")
    v(0.3em)
    it
    v(0.1em)
  }

  // Code block styling
  show raw.where(block: true): it => {
    set text(font: "JetBrains Mono", size: 9pt)
    block(
      width: 100%,
      fill: luma(248),
      radius: 2pt,
      inset: 10pt,
      stroke: 0.5pt + luma(220),
      it,
    )
  }

  show raw.where(block: false): set text(font: "JetBrains Mono", size: 9.5pt)

  // Link styling
  show link: it => {
    set text(fill: luma(50))
    underline(it)
  }

  // Table styling
  show table: set table(
    stroke: 0.5pt + luma(180),
    inset: 6pt,
  )

  show table.cell.where(y: 0): set text(weight: "bold", size: 10pt)

  // Keep headings with following content
  show heading: set block(breakable: false, below: 1.2em)

  // Title page
  if title != "" {
    v(3em)
    align(center)[
      #text(font: "Inter", size: 26pt, weight: "bold")[#title]
    ]
    v(3em)
  }

  // Table of contents
  if include-toc {
    outline(indent: 1.5em, depth: 3)
    pagebreak()
  }

  body
}
