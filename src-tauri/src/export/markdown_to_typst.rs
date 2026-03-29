use comrak::nodes::{
    ListType, NodeCode, NodeHeading, NodeLink, NodeList, NodeValue, TableAlignment,
};
use comrak::{parse_document, Arena, Options};

/// Convert a markdown string to Typst markup.
pub fn markdown_to_typst(markdown: &str) -> String {
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.front_matter_delimiter = Some("---".to_string());

    let arena = Arena::new();
    let root = parse_document(&arena, markdown, &options);

    let mut converter = Converter::new();
    converter.convert_node(root, 0);
    converter.finish()
}

struct CalloutInfo {
    callout_type: String,
    title: Option<String>,
}

struct Converter {
    output: String,
    /// Track list nesting depth for indentation.
    list_depth: usize,
    /// Track current table column count and alignments.
    table_alignments: Vec<TableAlignment>,
    /// Track which cell index we're on in a table row.
    table_cell_index: usize,
    /// Whether current table row is header.
    table_is_header_row: bool,
    /// Collect table cells as strings, flush at row end.
    table_cells: Vec<String>,
    /// When collecting table cell content, push to this instead of output.
    cell_buffer: Option<String>,
}

impl Converter {
    fn new() -> Self {
        Self {
            output: String::new(),
            list_depth: 0,
            table_alignments: Vec::new(),
            table_cell_index: 0,
            table_is_header_row: false,
            table_cells: Vec::new(),
            cell_buffer: None,
        }
    }

    fn finish(self) -> String {
        self.output.trim_end().to_string() + "\n"
    }

    /// Write text to the active buffer (cell buffer if inside a table cell, else main output).
    fn write(&mut self, s: &str) {
        if let Some(ref mut buf) = self.cell_buffer {
            buf.push_str(s);
        } else {
            self.output.push_str(s);
        }
    }

    fn convert_node<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>, _depth: usize) {
        let val = node.data.borrow().value.clone();
        match val {
            NodeValue::Document => {
                self.convert_children(node);
            }
            NodeValue::FrontMatter(_) => {
                // Strip YAML frontmatter — don't render
            }
            NodeValue::Heading(NodeHeading { level, .. }) => {
                let prefix = "=".repeat(level as usize);
                self.write(&prefix);
                self.write(" ");
                self.convert_children(node);
                self.write("\n\n");
            }
            NodeValue::Paragraph => {
                self.convert_children(node);
                // Don't add blank line if inside a list item (tight lists)
                if !self.is_inside_list_item(node) {
                    self.write("\n\n");
                } else {
                    self.write("\n");
                }
            }
            NodeValue::Text(ref text) => {
                self.write(&escape_typst(text));
            }
            NodeValue::Strong => {
                self.write("*");
                self.convert_children(node);
                self.write("*");
            }
            NodeValue::Emph => {
                self.write("_");
                self.convert_children(node);
                self.write("_");
            }
            NodeValue::Strikethrough => {
                self.write("#strike[");
                self.convert_children(node);
                self.write("]");
            }
            NodeValue::Code(NodeCode { ref literal, .. }) => {
                self.write("`");
                self.write(literal);
                self.write("`");
            }
            NodeValue::CodeBlock(ref cb) => {
                let lang = if cb.info.is_empty() {
                    ""
                } else {
                    cb.info.split_whitespace().next().unwrap_or("")
                };
                if lang.is_empty() {
                    self.write("```\n");
                } else {
                    self.write(&format!("```{}\n", lang));
                }
                self.write(&cb.literal);
                if !cb.literal.ends_with('\n') {
                    self.write("\n");
                }
                self.write("```\n\n");
            }
            NodeValue::Link(ref link) => {
                let NodeLink { ref url, .. } = **link;
                self.write(&format!("#link(\"{}\")[", escape_typst_string(url)));
                self.convert_children(node);
                self.write("]");
            }
            NodeValue::Image(ref link) => {
                let NodeLink { ref url, .. } = **link;
                // Collect alt text from children
                let alt = self.collect_text(node);

                // Drawing files: reference the SVG preview instead of .excalidraw
                // Chart files: reference the cached SVG preview instead of .json
                let resolved_url = if url.ends_with(".excalidraw") {
                    format!("{}.svg", url.trim_end_matches(".excalidraw"))
                } else if url.contains("/.notesage/charts/") && url.ends_with(".json") {
                    format!("{}.svg", url.trim_end_matches(".json"))
                } else {
                    url.to_string()
                };

                if alt.is_empty() {
                    self.write(&format!(
                        "#image(\"{}\")",
                        escape_typst_string(&resolved_url)
                    ));
                } else {
                    self.write(&format!(
                        "#image(\"{}\", alt: \"{}\")",
                        escape_typst_string(&resolved_url),
                        escape_typst_string(&alt)
                    ));
                }
            }
            NodeValue::List(ref data) => {
                self.list_depth += 1;
                if data.is_task_list {
                    self.convert_task_list(node);
                } else {
                    self.convert_children(node);
                }
                self.list_depth -= 1;
                // Add blank line after top-level list
                if self.list_depth == 0 {
                    self.write("\n");
                }
            }
            NodeValue::Item(ref list_data) => {
                self.convert_list_item(node, list_data);
            }
            NodeValue::TaskItem(_) => {
                // Handled by convert_task_list — skip if encountered standalone
            }
            NodeValue::BlockQuote => {
                // Check if this is a callout block (> [!type] or > [!type] Title)
                if let Some(callout) = self.detect_callout(node) {
                    self.render_callout(node, &callout);
                } else {
                    self.write("#quote(block: true)[");
                    let content = self.collect_block_content(node);
                    self.write(content.trim());
                    self.write("]\n\n");
                }
            }
            NodeValue::ThematicBreak => {
                self.write("#line(length: 100%)\n\n");
            }
            NodeValue::SoftBreak => {
                self.write(" ");
            }
            NodeValue::LineBreak => {
                self.write("\\\n");
            }
            NodeValue::HtmlInline(_) | NodeValue::HtmlBlock(_) => {
                // Skip raw HTML — not representable in Typst
            }
            NodeValue::Table(ref table) => {
                self.table_alignments = table.alignments.clone();
                self.convert_table(node, &table.alignments);
            }
            NodeValue::TableRow(is_header) => {
                // Handled by convert_table
                self.table_is_header_row = is_header;
                self.table_cell_index = 0;
                self.table_cells.clear();
                self.convert_children(node);
            }
            NodeValue::TableCell => {
                self.cell_buffer = Some(String::new());
                self.convert_children(node);
                let content = self.cell_buffer.take().unwrap_or_default();
                self.table_cells.push(content);
                self.table_cell_index += 1;
            }
            _ => {
                // For any unhandled node, just process children
                self.convert_children(node);
            }
        }
    }

    fn convert_children<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>) {
        for child in node.children() {
            self.convert_node(child, 0);
        }
    }

    /// Handle task lists where TaskItem nodes wrap Paragraph children.
    fn convert_task_list<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>) {
        let indent = "  ".repeat(self.list_depth - 1);

        for child in node.children() {
            let child_val = child.data.borrow().value.clone();
            if let NodeValue::TaskItem(ref task) = child_val {
                let checked = task.symbol.is_some();
                self.write(&indent);
                self.write("- ");
                if checked {
                    self.write("[x] ");
                } else {
                    self.write("[ ] ");
                }
                // TaskItem children are typically a Paragraph wrapping the text
                for grandchild in child.children() {
                    let gc_val = grandchild.data.borrow().value.clone();
                    match gc_val {
                        NodeValue::Paragraph => {
                            self.convert_children(grandchild);
                        }
                        _ => {
                            self.convert_node(grandchild, 0);
                        }
                    }
                }
                self.write("\n");
            } else {
                self.convert_node(child, 0);
            }
        }
    }

    fn convert_list_item<'a>(
        &mut self,
        node: &'a comrak::nodes::AstNode<'a>,
        list_data: &NodeList,
    ) {
        let indent = "  ".repeat(self.list_depth - 1);

        let marker = match list_data.list_type {
            ListType::Bullet => "- ".to_string(),
            ListType::Ordered => "+ ".to_string(),
        };

        self.write(&indent);
        self.write(&marker);

        // Convert children inline (skip paragraph wrapping for tight lists)
        let mut first = true;
        for child in node.children() {
            let child_val = child.data.borrow().value.clone();
            match child_val {
                NodeValue::Paragraph => {
                    if !first {
                        self.write(&indent);
                        self.write("  ");
                    }
                    self.convert_children(child);
                    if first {
                        first = false;
                    }
                }
                NodeValue::List(_) => {
                    // Nested list
                    self.convert_node(child, 0);
                }
                _ => {
                    self.convert_node(child, 0);
                }
            }
        }

        // Ensure newline at end of item
        if !self.output.ends_with('\n') {
            self.write("\n");
        }
    }

    fn convert_table<'a>(
        &mut self,
        node: &'a comrak::nodes::AstNode<'a>,
        alignments: &[TableAlignment],
    ) {
        let num_cols = alignments.len();

        // Build alignment spec
        let align_str = alignments
            .iter()
            .map(|a| match a {
                TableAlignment::Left => "left",
                TableAlignment::Center => "center",
                TableAlignment::Right => "right",
                TableAlignment::None => "auto",
            })
            .collect::<Vec<_>>()
            .join(", ");

        self.write(&format!(
            "#table(\n  columns: {},\n  align: ({}),\n",
            num_cols, align_str
        ));

        // Process rows to collect cells
        let mut all_rows: Vec<Vec<String>> = Vec::new();
        let mut header_row_count = 0;

        for row_node in node.children() {
            let row_val = row_node.data.borrow().value.clone();
            if let NodeValue::TableRow(is_header) = row_val {
                self.table_is_header_row = is_header;
                self.table_cell_index = 0;
                self.table_cells.clear();

                for cell_node in row_node.children() {
                    self.cell_buffer = Some(String::new());
                    self.convert_children(cell_node);
                    let content = self.cell_buffer.take().unwrap_or_default();
                    self.table_cells.push(content);
                }

                if is_header {
                    header_row_count += 1;
                }
                all_rows.push(self.table_cells.clone());
            }
        }

        // Write header rows as table.header
        let mut row_idx = 0;
        for row in &all_rows {
            if row_idx < header_row_count {
                self.write("  table.header(\n");
                for cell in row {
                    self.write(&format!("    [{}],\n", cell.trim()));
                }
                self.write("  ),\n");
            } else {
                for cell in row {
                    self.write(&format!("  [{}],\n", cell.trim()));
                }
            }
            row_idx += 1;
        }

        self.write(")\n\n");
    }

    fn is_inside_list_item<'a>(&self, node: &'a comrak::nodes::AstNode<'a>) -> bool {
        let mut current = node.parent();
        while let Some(parent) = current {
            if let NodeValue::Item(_) = parent.data.borrow().value {
                return true;
            }
            current = parent.parent();
        }
        false
    }

    /// Collect all text content from children without formatting.
    fn collect_text<'a>(&self, node: &'a comrak::nodes::AstNode<'a>) -> String {
        let mut text = String::new();
        for child in node.descendants() {
            if let NodeValue::Text(ref t) = child.data.borrow().value {
                text.push_str(t);
            }
        }
        text
    }

    /// Detect if a blockquote is a callout by checking the first text for `[!type]`.
    fn detect_callout<'a>(&self, node: &'a comrak::nodes::AstNode<'a>) -> Option<CalloutInfo> {
        // Get the first text content of the first paragraph
        let first_child = node.first_child()?;
        if !matches!(first_child.data.borrow().value, NodeValue::Paragraph) {
            return None;
        }
        let first_text_node = first_child.first_child()?;
        let text = match &first_text_node.data.borrow().value {
            NodeValue::Text(t) => t.clone(),
            _ => return None,
        };

        // Match [!type] or [!type] Title
        let re = regex::Regex::new(r"^\[!(\w+)\](?:\s+(.+))?$").ok()?;
        let line = text.lines().next().unwrap_or(&text);
        let caps = re.captures(line)?;
        let callout_type = caps.get(1)?.as_str().to_lowercase();

        // Only match valid types
        match callout_type.as_str() {
            "note" | "tip" | "warning" | "important" => {}
            _ => return None,
        }

        let title = caps.get(2).map(|m| m.as_str().to_string());

        Some(CalloutInfo {
            callout_type,
            title,
        })
    }

    /// Render a callout block as a styled Typst block.
    fn render_callout<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>, info: &CalloutInfo) {
        let (stroke_color, fill_color, label) = match info.callout_type.as_str() {
            "note" => ("rgb(\"#5B7B9E\")", "rgb(\"#5B7B9E\").lighten(92%)", "Note"),
            "tip" => ("rgb(\"#4A9E6B\")", "rgb(\"#4A9E6B\").lighten(92%)", "Tip"),
            "warning" => ("rgb(\"#B8860B\")", "rgb(\"#B8860B\").lighten(92%)", "Warning"),
            "important" => ("rgb(\"#C0392B\")", "rgb(\"#C0392B\").lighten(92%)", "Important"),
            _ => ("rgb(\"#5B7B9E\")", "rgb(\"#5B7B9E\").lighten(92%)", "Note"),
        };

        let display_title = info.title.as_deref().unwrap_or(label);

        // Collect content, skipping the first line (the [!type] header)
        let content = self.collect_callout_body(node);

        self.write(&format!(
            "#block(stroke: (left: 3pt + {stroke}), fill: {fill}, inset: 10pt, radius: 4pt, width: 100%)[\n",
            stroke = stroke_color,
            fill = fill_color,
        ));
        self.write(&format!(
            "  #text(fill: {stroke}, weight: \"bold\", size: 0.9em)[{title}]\n",
            stroke = stroke_color,
            title = escape_typst(display_title),
        ));
        if !content.trim().is_empty() {
            self.write("\n");
            self.write(&content);
        }
        self.write("]\n\n");
    }

    /// Collect callout body content, skipping the `[!type]` header line.
    fn collect_callout_body<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>) -> String {
        let saved = std::mem::take(&mut self.output);
        let mut first_para = true;
        for child in node.children() {
            if first_para {
                first_para = false;
                // For the first paragraph, skip the [!type] text and render remaining
                if matches!(child.data.borrow().value, NodeValue::Paragraph) {
                    let mut skip_first_text = true;
                    for inner in child.children() {
                        if skip_first_text {
                            skip_first_text = false;
                            // Skip the [!type] text node but render siblings
                            if matches!(inner.data.borrow().value, NodeValue::Text(_)) {
                                // Check if there's remaining text after the [!type] line
                                if let NodeValue::Text(ref t) = inner.data.borrow().value {
                                    // Remove the [!type] header from the first line
                                    let remainder = if let Some(pos) = t.find('\n') {
                                        t[pos + 1..].to_string()
                                    } else {
                                        String::new()
                                    };
                                    if !remainder.is_empty() {
                                        self.write(&escape_typst(&remainder));
                                    }
                                }
                                continue;
                            }
                        }
                        self.convert_node(inner, 0);
                    }
                    // Add paragraph break if there was content
                    if !self.output.trim().is_empty() {
                        self.write("\n\n");
                    }
                    continue;
                }
            }
            self.convert_node(child, 0);
        }
        let content = std::mem::replace(&mut self.output, saved);
        content
    }

    /// Render block content to a string (for blockquotes).
    fn collect_block_content<'a>(&mut self, node: &'a comrak::nodes::AstNode<'a>) -> String {
        let saved = std::mem::take(&mut self.output);
        self.convert_children(node);
        let content = std::mem::replace(&mut self.output, saved);
        content
    }
}

/// Escape characters that have special meaning in Typst content mode.
fn escape_typst(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '#' => result.push_str("\\#"),
            '*' => result.push_str("\\*"),
            '_' => result.push_str("\\_"),
            '@' => result.push_str("\\@"),
            '<' => result.push_str("\\<"),
            '>' => result.push_str("\\>"),
            '$' => result.push_str("\\$"),
            '\\' => result.push_str("\\\\"),
            _ => result.push(ch),
        }
    }
    result
}

/// Escape characters for Typst string literals (inside double quotes).
fn escape_typst_string(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_headings() {
        assert_eq!(markdown_to_typst("# Heading 1"), "= Heading 1\n");
        assert_eq!(markdown_to_typst("## Heading 2"), "== Heading 2\n");
        assert_eq!(markdown_to_typst("### Heading 3"), "=== Heading 3\n");
        assert_eq!(markdown_to_typst("#### Heading 4"), "==== Heading 4\n");
        assert_eq!(markdown_to_typst("##### Heading 5"), "===== Heading 5\n");
        assert_eq!(markdown_to_typst("###### Heading 6"), "====== Heading 6\n");
    }

    #[test]
    fn test_paragraphs() {
        assert_eq!(
            markdown_to_typst("Hello world.\n\nSecond paragraph."),
            "Hello world.\n\nSecond paragraph.\n"
        );
    }

    #[test]
    fn test_bold() {
        assert_eq!(
            markdown_to_typst("This is **bold** text."),
            "This is *bold* text.\n"
        );
    }

    #[test]
    fn test_italic() {
        assert_eq!(
            markdown_to_typst("This is *italic* text."),
            "This is _italic_ text.\n"
        );
    }

    #[test]
    fn test_strikethrough() {
        assert_eq!(
            markdown_to_typst("This is ~~struck~~ text."),
            "This is #strike[struck] text.\n"
        );
    }

    #[test]
    fn test_inline_code() {
        assert_eq!(
            markdown_to_typst("Use `println!` to print."),
            "Use `println!` to print.\n"
        );
    }

    #[test]
    fn test_code_block() {
        let input = "```rust\nfn main() {}\n```";
        let expected = "```rust\nfn main() {}\n```\n";
        assert_eq!(markdown_to_typst(input), expected);
    }

    #[test]
    fn test_code_block_no_lang() {
        let input = "```\nsome code\n```";
        let expected = "```\nsome code\n```\n";
        assert_eq!(markdown_to_typst(input), expected);
    }

    #[test]
    fn test_link() {
        assert_eq!(
            markdown_to_typst("[Example](https://example.com)"),
            "#link(\"https://example.com\")[Example]\n"
        );
    }

    #[test]
    fn test_image() {
        assert_eq!(
            markdown_to_typst("![Alt text](image.png)"),
            "#image(\"image.png\", alt: \"Alt text\")\n"
        );
    }

    #[test]
    fn test_image_no_alt() {
        assert_eq!(
            markdown_to_typst("![](image.png)"),
            "#image(\"image.png\")\n"
        );
    }

    #[test]
    fn test_bullet_list() {
        let input = "- First\n- Second\n- Third";
        let output = markdown_to_typst(input);
        assert!(output.contains("- First"));
        assert!(output.contains("- Second"));
        assert!(output.contains("- Third"));
    }

    #[test]
    fn test_ordered_list() {
        let input = "1. First\n2. Second\n3. Third";
        let output = markdown_to_typst(input);
        assert!(output.contains("+ First"));
        assert!(output.contains("+ Second"));
        assert!(output.contains("+ Third"));
    }

    #[test]
    fn test_task_list() {
        let input = "- [ ] Unchecked\n- [x] Checked";
        let output = markdown_to_typst(input);
        assert!(output.contains("- [ ] Unchecked"), "output: {}", output);
        assert!(output.contains("- [x] Checked"), "output: {}", output);
    }

    #[test]
    fn test_nested_list() {
        let input = "- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2";
        let output = markdown_to_typst(input);
        assert!(output.contains("- Item 1"), "output: {}", output);
        assert!(output.contains("  - Nested 1"), "output: {}", output);
        assert!(output.contains("- Item 2"), "output: {}", output);
    }

    #[test]
    fn test_blockquote() {
        let output = markdown_to_typst("> This is a quote");
        assert!(output.contains("#quote(block: true)["), "output: {}", output);
        assert!(output.contains("This is a quote"), "output: {}", output);
    }

    #[test]
    fn test_horizontal_rule() {
        assert_eq!(
            markdown_to_typst("---"),
            "#line(length: 100%)\n"
        );
    }

    #[test]
    fn test_table() {
        let input = "| A | B |\n|---|---|\n| 1 | 2 |";
        let output = markdown_to_typst(input);
        assert!(output.contains("#table("), "output: {}", output);
        assert!(output.contains("columns: 2"), "output: {}", output);
        assert!(output.contains("[A]"), "output: {}", output);
        assert!(output.contains("[B]"), "output: {}", output);
        assert!(output.contains("[1]"), "output: {}", output);
        assert!(output.contains("[2]"), "output: {}", output);
    }

    #[test]
    fn test_frontmatter_stripped() {
        let input = "---\ntitle: Test\n---\n\n# Hello";
        let output = markdown_to_typst(input);
        assert!(!output.contains("title"), "output: {}", output);
        assert!(output.contains("= Hello"), "output: {}", output);
    }

    #[test]
    fn test_escape_special_chars() {
        let input = "Price is $10 and @user said #hashtag";
        let output = markdown_to_typst(input);
        assert!(output.contains("\\$10"), "output: {}", output);
        assert!(output.contains("\\@user"), "output: {}", output);
        assert!(output.contains("\\#hashtag"), "output: {}", output);
    }

    #[test]
    fn test_bold_italic_combined() {
        let output = markdown_to_typst("***bold and italic***");
        assert!(output.contains("*_bold and italic_*") || output.contains("_*bold and italic*_"),
            "output: {}", output);
    }

    #[test]
    fn test_complex_document() {
        let input = r#"---
title: Test Doc
---

# Main Title

This is a paragraph with **bold**, *italic*, and `code`.

## Section 1

- Item one
- Item two
  - Nested item

> A blockquote here.

```python
print("hello")
```

| Name | Value |
|------|-------|
| A    | 1     |

---

[Link](https://example.com)
"#;
        let output = markdown_to_typst(input);
        // Verify key elements are present
        assert!(output.contains("= Main Title"), "missing heading");
        assert!(output.contains("*bold*"), "missing bold");
        assert!(output.contains("_italic_"), "missing italic");
        assert!(output.contains("`code`"), "missing inline code");
        assert!(output.contains("== Section 1"), "missing h2");
        assert!(output.contains("- Item one"), "missing bullet");
        assert!(output.contains("#quote(block: true)"), "missing blockquote");
        assert!(output.contains("```python"), "missing code block");
        assert!(output.contains("#table("), "missing table");
        assert!(output.contains("#line(length: 100%)"), "missing hr");
        assert!(output.contains("#link("), "missing link");
        // Frontmatter stripped
        assert!(!output.contains("title: Test Doc"), "frontmatter not stripped");
    }

    #[test]
    fn test_callout_note() {
        let input = "> [!note]\n> This is a note.";
        let output = markdown_to_typst(input);
        assert!(output.contains("#block("), "missing block: {}", output);
        assert!(output.contains("Note"), "missing label: {}", output);
        assert!(output.contains("This is a note."), "missing content: {}", output);
    }

    #[test]
    fn test_callout_with_title() {
        let input = "> [!tip] Pro Tip\n> This is helpful.";
        let output = markdown_to_typst(input);
        assert!(output.contains("Pro Tip"), "missing custom title: {}", output);
        assert!(output.contains("This is helpful."), "missing content: {}", output);
    }

    #[test]
    fn test_callout_all_types() {
        for callout_type in &["note", "tip", "warning", "important"] {
            let input = format!("> [!{}]\n> Content here.", callout_type);
            let output = markdown_to_typst(&input);
            assert!(output.contains("#block("), "missing block for {}: {}", callout_type, output);
        }
    }

    #[test]
    fn test_invalid_callout_remains_blockquote() {
        let input = "> [!custom]\n> Some text.";
        let output = markdown_to_typst(input);
        assert!(output.contains("#quote(block: true)"), "invalid type should be blockquote: {}", output);
    }

    #[test]
    fn test_drawing_image_to_svg() {
        let input = "![drawing](/.notesage/drawings/abc123.excalidraw)";
        let output = markdown_to_typst(input);
        assert!(
            output.contains("/.notesage/drawings/abc123.svg"),
            "should reference SVG: {}",
            output
        );
        assert!(
            !output.contains(".excalidraw"),
            "should not reference .excalidraw: {}",
            output
        );
    }

    #[test]
    fn test_drawing_image_to_svg_with_alt() {
        let input = "![My Drawing](/.notesage/drawings/sketch.excalidraw)";
        let output = markdown_to_typst(input);
        assert!(
            output.contains("/.notesage/drawings/sketch.svg"),
            "should reference SVG: {}",
            output
        );
        assert!(
            output.contains("My Drawing"),
            "should preserve alt text: {}",
            output
        );
        assert!(
            !output.contains(".excalidraw"),
            "should not reference .excalidraw: {}",
            output
        );
    }

    #[test]
    fn test_regular_image_unchanged() {
        let input = "![photo](images/photo.png)";
        let output = markdown_to_typst(input);
        assert!(
            output.contains("images/photo.png"),
            "regular image should be unchanged: {}",
            output
        );
    }

    #[test]
    fn test_compiles_to_pdf() {
        use super::super::typst_world::NotesageWorld;

        let markdown = r#"# Hello World

This is **bold** and *italic* text.

- Item 1
- Item 2

```rust
fn main() {}
```

| A | B |
|---|---|
| 1 | 2 |
"#;
        let typst = markdown_to_typst(markdown);
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }
}
