// Report template — company-report style with title page,
// header/footer, and table of contents by default.

#let template(
  title: "",
  include-toc: true,
  include-page-numbers: true,
  body,
) = {
  set document(title: title)

  set page(
    margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
  )

  set text(
    font: "Inter",
    size: 11pt,
    fill: luma(30),
  )

  set par(
    leading: 0.75em,
    justify: true,
  )

  // Title page
  if title != "" {
    v(6em)
    line(length: 100%, stroke: 1.5pt + luma(60))
    v(1em)
    text(size: 32pt, weight: "bold", fill: luma(20))[#title]
    v(0.5em)
    line(length: 100%, stroke: 1.5pt + luma(60))
    v(2em)

    // Date
    text(size: 12pt, fill: luma(100))[
      #datetime.today().display("[month repr:long] [day], [year]")
    ]

    pagebreak()
  }

  // Set up header/footer for remaining pages
  set page(
    header: {
      set text(size: 9pt, fill: luma(120))
      grid(
        columns: (1fr, 1fr),
        align(left, title),
        align(right, datetime.today().display("[year]-[month]-[day]")),
      )
      v(-4pt)
      line(length: 100%, stroke: 0.4pt + luma(200))
    },
    footer: if include-page-numbers {
      line(length: 100%, stroke: 0.4pt + luma(200))
      v(-4pt)
      set text(size: 9pt, fill: luma(120))
      grid(
        columns: (1fr, 1fr),
        align(left, title),
        align(right, context counter(page).display()),
      )
    },
  )

  // Table of contents
  if include-toc {
    text(font: "Inter", size: 20pt, weight: "bold")[Table of Contents]
    v(1em)
    outline(indent: 1.5em, depth: 3)
    pagebreak()
  }

  // Heading styles
  show heading.where(level: 1): it => {
    set text(size: 22pt, weight: "bold")
    v(0.5em)
    it
    v(0.3em)
  }

  show heading.where(level: 2): it => {
    set text(size: 16pt, weight: "semibold")
    v(0.4em)
    it
    v(0.2em)
  }

  show heading.where(level: 3): it => {
    set text(size: 13pt, weight: "semibold")
    v(0.3em)
    it
    v(0.15em)
  }

  show heading.where(level: 4): it => {
    set text(size: 11pt, weight: "semibold")
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
      stroke: 0.5pt + luma(220),
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

  body
}
