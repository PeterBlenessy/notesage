import mammoth from "mammoth";

/**
 * Convert an HTML string (from mammoth DOCX conversion) to clean markdown.
 * Handles headings, paragraphs, bold, italic, links, lists, and images.
 */
export function htmlToMarkdown(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return convertNode(doc.body).trim() + "\n";
}

function convertNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const children = () =>
    Array.from(el.childNodes)
      .map(convertNode)
      .join("");

  switch (tag) {
    case "h1":
      return `# ${children().trim()}\n\n`;
    case "h2":
      return `## ${children().trim()}\n\n`;
    case "h3":
      return `### ${children().trim()}\n\n`;
    case "h4":
      return `#### ${children().trim()}\n\n`;
    case "h5":
      return `##### ${children().trim()}\n\n`;
    case "h6":
      return `###### ${children().trim()}\n\n`;
    case "p":
      return `${children().trim()}\n\n`;
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${children()}**`;
    case "em":
    case "i":
      return `*${children()}*`;
    case "u":
      return children(); // Markdown doesn't have underline
    case "s":
    case "strike":
    case "del":
      return `~~${children()}~~`;
    case "code":
      return `\`${children()}\``;
    case "pre": {
      const code = el.querySelector("code");
      const text = code ? code.textContent : el.textContent;
      return `\`\`\`\n${text?.trim()}\n\`\`\`\n\n`;
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = children();
      return `[${text}](${href})`;
    }
    case "img": {
      const src = el.getAttribute("src") ?? "";
      const alt = el.getAttribute("alt") ?? "";
      return `![${alt}](${src})`;
    }
    case "ul":
      return convertList(el, "ul") + "\n";
    case "ol":
      return convertList(el, "ol") + "\n";
    case "li": {
      return children().trim();
    }
    case "blockquote":
      return (
        children()
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    case "hr":
      return "---\n\n";
    case "table":
      return convertTable(el) + "\n\n";
    case "div":
    case "span":
    case "section":
    case "article":
    case "main":
    case "body":
      return children();
    default:
      return children();
  }
}

function convertList(el: HTMLElement, type: "ul" | "ol", depth = 0): string {
  const items: string[] = [];
  const indent = "  ".repeat(depth);

  let index = 1;
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === "li") {
      const prefix = type === "ul" ? `${indent}- ` : `${indent}${index}. `;
      // Process children: separate text from nested lists
      let text = "";
      let nestedList = "";
      for (const liChild of Array.from(child.childNodes)) {
        if (
          liChild.nodeType === Node.ELEMENT_NODE &&
          ((liChild as HTMLElement).tagName.toLowerCase() === "ul" ||
            (liChild as HTMLElement).tagName.toLowerCase() === "ol")
        ) {
          const nestedType = (liChild as HTMLElement).tagName.toLowerCase() as "ul" | "ol";
          nestedList += "\n" + convertList(liChild as HTMLElement, nestedType, depth + 1);
        } else {
          text += convertNode(liChild);
        }
      }
      items.push(`${prefix}${text.trim()}${nestedList}`);
      index++;
    }
  }

  return items.join("\n");
}

function convertTable(table: HTMLElement): string {
  const rows: string[][] = [];

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const cells: string[] = [];
    for (const cell of Array.from(row.querySelectorAll("th, td"))) {
      cells.push(convertNode(cell).trim().replace(/\n/g, " "));
    }
    rows.push(cells);
  }

  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  // Header row
  const header = rows[0] ?? [];
  lines.push("| " + Array.from({ length: colCount }, (_, i) => header[i] ?? "").join(" | ") + " |");
  lines.push("| " + Array.from({ length: colCount }, () => "---").join(" | ") + " |");

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    lines.push("| " + Array.from({ length: colCount }, (_, j) => row[j] ?? "").join(" | ") + " |");
  }

  return lines.join("\n");
}

/**
 * Convert a DOCX file (as Uint8Array) to markdown via mammoth + HTML-to-markdown.
 */
export async function docxToMarkdown(data: Uint8Array): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer: data.buffer });
  return htmlToMarkdown(result.value);
}
