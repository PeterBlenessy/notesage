use comrak::nodes::{
    ListType, NodeCode, NodeHeading, NodeLink, NodeList, NodeValue, TableAlignment,
};
use comrak::{parse_document, Arena, Options};

use super::table_utils::*;

/// Convert a markdown string to Typst markup.
///
/// `embedded_svgs` contains pre-rendered SVG strings for inline chart/excalidraw
/// code blocks, matched by position (the Nth chart/excalidraw block in the AST
/// corresponds to the Nth entry in the vec).
pub fn markdown_to_typst(markdown: &str, embedded_svgs: Option<&[String]>) -> String {
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.front_matter_delimiter = Some("---".to_string());

    let arena = Arena::new();
    let root = parse_document(&arena, markdown, &options);

    let mut converter = Converter::new(embedded_svgs);
    converter.convert_node(root, 0);
    converter.finish()
}

struct Converter<'s> {
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
    /// Pre-rendered SVGs for inline chart/excalidraw blocks.
    embedded_svgs: Option<&'s [String]>,
    /// Index into embedded_svgs, incremented for each chart/excalidraw code block.
    embedded_svg_index: usize,
}

impl<'s> Converter<'s> {
    fn new(embedded_svgs: Option<&'s [String]>) -> Self {
        Self {
            output: String::new(),
            list_depth: 0,
            table_alignments: Vec::new(),
            table_cell_index: 0,
            table_is_header_row: false,
            table_cells: Vec::new(),
            cell_buffer: None,
            embedded_svgs,
            embedded_svg_index: 0,
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
                // Use enough backticks to avoid conflict with literal content.
                // Find the longest consecutive run of backticks in the literal,
                // then use one more than that for the delimiters.
                let max_run = {
                    let mut max = 0usize;
                    let mut current = 0usize;
                    for ch in literal.chars() {
                        if ch == '`' {
                            current += 1;
                            if current > max { max = current; }
                        } else {
                            current = 0;
                        }
                    }
                    max
                };
                let delim = "`".repeat(max_run + 1);
                self.write(&delim);
                // Typst requires a space after opening delimiter when content starts with `
                if literal.starts_with('`') { self.write(" "); }
                self.write(literal);
                if literal.ends_with('`') { self.write(" "); }
                self.write(&delim);
            }
            NodeValue::CodeBlock(ref cb) => {
                let lang = if cb.info.is_empty() {
                    ""
                } else {
                    cb.info.split_whitespace().next().unwrap_or("")
                };

                // Inline chart/excalidraw blocks: emit as image from embedded SVGs
                if lang == "chart" || lang == "excalidraw" {
                    let idx = self.embedded_svg_index;
                    self.embedded_svg_index += 1;

                    if let Some(svgs) = self.embedded_svgs {
                        if let Some(svg) = svgs.get(idx) {
                            if !svg.is_empty() {
                                self.write(&format!(
                                    "#image(\"/embedded-{}.svg\", width: 100%)\n\n",
                                    idx
                                ));
                                return;
                            }
                        }
                    }
                    // Fallback: extract title from JSON if possible
                    let title = serde_json::from_str::<serde_json::Value>(&cb.literal)
                        .ok()
                        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()))
                        .unwrap_or_else(|| if lang == "chart" { "Chart".to_string() } else { "Drawing".to_string() });
                    self.write(&format!("[{}]\n\n", title));
                    return;
                }

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
                // Check if this is a link preview card (> [!link](url))
                if let Some(link_info) = detect_link_preview(node) {
                    self.render_link_preview(&link_info);
                // Check if this is a callout block (> [!type] or > [!type] Title)
                } else if let Some(callout) = detect_callout(node) {
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
            NodeValue::HtmlInline(ref html) => {
                // When inside a table cell, pass HTML comments through to the cell buffer
                // so column metadata can be extracted by parse_column_metadata.
                if self.cell_buffer.is_some() && html.trim().starts_with("<!--") {
                    self.write(html);
                }
                // Otherwise skip raw HTML — not representable in Typst
            }
            NodeValue::HtmlBlock(ref hb) => {
                // Handle page break comments
                if hb.literal.trim() == "<!-- pagebreak -->" {
                    self.write("#pagebreak()\n");
                }
                // Otherwise skip raw HTML blocks — not representable in Typst
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

        // Parse column metadata from header cells (HTML comments like <!-- type:number,summary:sum -->)
        let mut col_meta: Vec<ColumnMeta> = vec![ColumnMeta::default(); num_cols];
        let mut clean_headers: Vec<Vec<String>> = Vec::new();

        for (row_idx, row) in all_rows.iter().enumerate() {
            if row_idx < header_row_count {
                let mut cleaned_row = Vec::new();
                for (col_idx, cell) in row.iter().enumerate() {
                    let (clean, meta) = parse_column_metadata(cell);
                    if !meta.props.is_empty() && col_idx < num_cols {
                        col_meta[col_idx] = meta;
                    }
                    cleaned_row.push(clean);
                }
                clean_headers.push(cleaned_row);
            }
        }

        let has_metadata = col_meta.iter().any(|m| !m.props.is_empty());

        // Write header rows as table.header
        for cleaned_row in &clean_headers {
            self.write("  table.header(\n");
            for cell in cleaned_row {
                self.write(&format!("    [{}],\n", cell.trim()));
            }
            self.write("  ),\n");
        }

        // Write data rows, applying sparkline stripping and number formatting
        let data_rows: Vec<&Vec<String>> = all_rows.iter().skip(header_row_count).collect();
        for row in &data_rows {
            for (col_idx, cell) in row.iter().enumerate() {
                let mut text = strip_sparkline_syntax(cell);

                // Apply number formatting if column has type metadata
                if has_metadata && col_idx < num_cols {
                    let meta = &col_meta[col_idx];
                    if let Some(col_type) = meta.col_type() {
                        if let Some(val) = parse_numeric_value(&text) {
                            text = escape_typst(&format_value(
                                val,
                                col_type,
                                meta.currency(),
                            ));
                        }
                    }
                }

                self.write(&format!("  [{}],\n", text.trim()));
            }
        }

        // Render aggregation footer row if any columns have summary metadata
        let has_summary = col_meta.iter().any(|m| m.summary().is_some());
        if has_summary {
            // Collect numeric values per column from data rows
            let mut col_values: Vec<Vec<f64>> = vec![Vec::new(); num_cols];
            for row in &data_rows {
                for (col_idx, cell) in row.iter().enumerate() {
                    if col_idx < num_cols {
                        if let Some(val) = parse_numeric_value(cell) {
                            col_values[col_idx].push(val);
                        }
                    }
                }
            }

            self.write("  table.hline(stroke: 1.5pt + luma(180)),\n");

            for col_idx in 0..num_cols {
                let meta = &col_meta[col_idx];
                if let Some(agg_type) = meta.summary() {
                    if let Some(result) = compute_aggregation(&col_values[col_idx], agg_type) {
                        // Format the aggregation result
                        let formatted = if let Some(col_type) = meta.col_type() {
                            format_value(result, col_type, meta.currency())
                        } else {
                            // Default formatting for untyped columns
                            if result == result.floor() && result.abs() < 1e15 {
                                format!("{}", result as i64)
                            } else {
                                format!("{:.2}", result)
                            }
                        };

                        let label = match agg_type {
                            "sum" => "Sum",
                            "avg" => "Avg",
                            "count" => "Count",
                            "min" => "Min",
                            "max" => "Max",
                            _ => "",
                        };

                        self.write(&format!(
                            "  table.cell(fill: luma(240))[#text(size: 9pt, fill: luma(100))[{}: {}]],\n",
                            label,
                            escape_typst(&formatted)
                        ));
                    } else {
                        self.write("  table.cell(fill: luma(240))[],\n");
                    }
                } else {
                    self.write("  table.cell(fill: luma(240))[],\n");
                }
            }
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
    /// Delegates to the standalone `collect_text` in `table_utils`.
    fn collect_text<'a>(&self, node: &'a comrak::nodes::AstNode<'a>) -> String {
        collect_text(node)
    }

    /// Render a link preview card as a styled Typst block.
    /// Render a link preview card as a styled Typst block (text only, no images).
    fn render_link_preview(&mut self, info: &LinkPreviewInfo) {
        self.write("#block(stroke: 1pt + rgb(\"#E0E0E0\"), fill: rgb(\"#FAFAFA\"), inset: 12pt, radius: 6pt, width: 100%)[\n");

        if let Some(ref site) = info.site_name {
            self.write(&format!(
                "  #text(fill: rgb(\"#888888\"), size: 0.8em)[{}]\n",
                escape_typst(site)
            ));
        }

        if let Some(ref title) = info.title {
            if info.site_name.is_some() {
                self.write("\n");
            }
            self.write(&format!(
                "  #text(weight: \"semibold\")[{}]\n",
                escape_typst(title)
            ));
        }

        if let Some(ref desc) = info.description {
            self.write("\n");
            self.write(&format!(
                "  #text(fill: rgb(\"#666666\"), size: 0.9em)[{}]\n",
                escape_typst(desc)
            ));
        }

        self.write("\n");
        self.write(&format!(
            "  #text(fill: rgb(\"#999999\"), size: 0.8em)[{}]\n",
            escape_typst(&info.url)
        ));

        self.write("]\n\n");
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
            '/' => result.push_str("\\/"),
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
        assert_eq!(markdown_to_typst("# Heading 1", None), "= Heading 1\n");
        assert_eq!(markdown_to_typst("## Heading 2", None), "== Heading 2\n");
        assert_eq!(markdown_to_typst("### Heading 3", None), "=== Heading 3\n");
        assert_eq!(markdown_to_typst("#### Heading 4", None), "==== Heading 4\n");
        assert_eq!(markdown_to_typst("##### Heading 5", None), "===== Heading 5\n");
        assert_eq!(markdown_to_typst("###### Heading 6", None), "====== Heading 6\n");
    }

    #[test]
    fn test_paragraphs() {
        assert_eq!(
            markdown_to_typst("Hello world.\n\nSecond paragraph.", None),
            "Hello world.\n\nSecond paragraph.\n"
        );
    }

    #[test]
    fn test_bold() {
        assert_eq!(
            markdown_to_typst("This is **bold** text.", None),
            "This is *bold* text.\n"
        );
    }

    #[test]
    fn test_italic() {
        assert_eq!(
            markdown_to_typst("This is *italic* text.", None),
            "This is _italic_ text.\n"
        );
    }

    #[test]
    fn test_strikethrough() {
        assert_eq!(
            markdown_to_typst("This is ~~struck~~ text.", None),
            "This is #strike[struck] text.\n"
        );
    }

    #[test]
    fn test_inline_code() {
        assert_eq!(
            markdown_to_typst("Use `println!` to print.", None),
            "Use `println!` to print.\n"
        );
    }

    #[test]
    fn test_code_block() {
        let input = "```rust\nfn main() {}\n```";
        let expected = "```rust\nfn main() {}\n```\n";
        assert_eq!(markdown_to_typst(input, None), expected);
    }

    #[test]
    fn test_code_block_no_lang() {
        let input = "```\nsome code\n```";
        let expected = "```\nsome code\n```\n";
        assert_eq!(markdown_to_typst(input, None), expected);
    }

    #[test]
    fn test_link() {
        assert_eq!(
            markdown_to_typst("[Example](https://example.com)", None),
            "#link(\"https://example.com\")[Example]\n"
        );
    }

    #[test]
    fn test_image() {
        assert_eq!(
            markdown_to_typst("![Alt text](image.png)", None),
            "#image(\"image.png\", alt: \"Alt text\")\n"
        );
    }

    #[test]
    fn test_image_no_alt() {
        assert_eq!(
            markdown_to_typst("![](image.png)", None),
            "#image(\"image.png\")\n"
        );
    }

    #[test]
    fn test_bullet_list() {
        let input = "- First\n- Second\n- Third";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("- First"));
        assert!(output.contains("- Second"));
        assert!(output.contains("- Third"));
    }

    #[test]
    fn test_ordered_list() {
        let input = "1. First\n2. Second\n3. Third";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("+ First"));
        assert!(output.contains("+ Second"));
        assert!(output.contains("+ Third"));
    }

    #[test]
    fn test_task_list() {
        let input = "- [ ] Unchecked\n- [x] Checked";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("- [ ] Unchecked"), "output: {}", output);
        assert!(output.contains("- [x] Checked"), "output: {}", output);
    }

    #[test]
    fn test_nested_list() {
        let input = "- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("- Item 1"), "output: {}", output);
        assert!(output.contains("  - Nested 1"), "output: {}", output);
        assert!(output.contains("- Item 2"), "output: {}", output);
    }

    #[test]
    fn test_blockquote() {
        let output = markdown_to_typst("> This is a quote", None);
        assert!(output.contains("#quote(block: true)["), "output: {}", output);
        assert!(output.contains("This is a quote"), "output: {}", output);
    }

    #[test]
    fn test_horizontal_rule() {
        assert_eq!(
            markdown_to_typst("---", None),
            "#line(length: 100%)\n"
        );
    }

    #[test]
    fn test_table() {
        let input = "| A | B |\n|---|---|\n| 1 | 2 |";
        let output = markdown_to_typst(input, None);
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
        let output = markdown_to_typst(input, None);
        assert!(!output.contains("title"), "output: {}", output);
        assert!(output.contains("= Hello"), "output: {}", output);
    }

    #[test]
    fn test_escape_special_chars() {
        let input = "Price is $10 and @user said #hashtag";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("\\$10"), "output: {}", output);
        assert!(output.contains("\\@user"), "output: {}", output);
        assert!(output.contains("\\#hashtag"), "output: {}", output);
    }

    #[test]
    fn test_bold_italic_combined() {
        let output = markdown_to_typst("***bold and italic***", None);
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
        let output = markdown_to_typst(input, None);
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
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#block("), "missing block: {}", output);
        assert!(output.contains("Note"), "missing label: {}", output);
        assert!(output.contains("This is a note."), "missing content: {}", output);
    }

    #[test]
    fn test_callout_with_title() {
        let input = "> [!tip] Pro Tip\n> This is helpful.";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("Pro Tip"), "missing custom title: {}", output);
        assert!(output.contains("This is helpful."), "missing content: {}", output);
    }

    #[test]
    fn test_callout_all_types() {
        for callout_type in &["note", "tip", "warning", "important"] {
            let input = format!("> [!{}]\n> Content here.", callout_type);
            let output = markdown_to_typst(&input, None);
            assert!(output.contains("#block("), "missing block for {}: {}", callout_type, output);
        }
    }

    #[test]
    fn test_invalid_callout_remains_blockquote() {
        let input = "> [!custom]\n> Some text.";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#quote(block: true)"), "invalid type should be blockquote: {}", output);
    }

    #[test]
    fn test_drawing_image_to_svg() {
        let input = "![drawing](/.notesage/drawings/abc123.excalidraw)";
        let output = markdown_to_typst(input, None);
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
        let output = markdown_to_typst(input, None);
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
        let output = markdown_to_typst(input, None);
        assert!(
            output.contains("images/photo.png"),
            "regular image should be unchanged: {}",
            output
        );
    }

    #[test]
    fn test_link_preview_basic() {
        let input = "> [!link](https://example.com)\n> **Example Title**\n> A description of the page\n> example.com";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#block("), "missing block: {}", output);
        assert!(output.contains("Example Title"), "missing title: {}", output);
        assert!(output.contains("A description of the page"), "missing description: {}", output);
        assert!(output.contains("example.com"), "missing site name: {}", output);
        assert!(output.contains("https:\\/\\/example.com"), "missing URL: {}", output);
    }

    #[test]
    fn test_link_preview_url_only() {
        let input = "> [!link](https://example.com)";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#block("), "missing block: {}", output);
        assert!(output.contains("https:\\/\\/example.com"), "missing URL: {}", output);
    }

    #[test]
    fn test_link_preview_does_not_affect_callouts() {
        let input = "> [!note]\n> This is a note.";
        let output = markdown_to_typst(input, None);
        // Should be a callout, not a link preview
        assert!(output.contains("Note"), "should be callout: {}", output);
        assert!(!output.contains("stroke: 1pt"), "should not be link preview card: {}", output);
    }

    #[test]
    fn test_link_preview_with_metadata_comments() {
        let input = "> [!link](https://example.com)\n> **Title**\n> Description\n> example.com\n> <!--image:https://example.com/img.png-->\n> <!--favicon:https://example.com/fav.ico-->";
        let output = markdown_to_typst(input, None);
        let _ = &output; // used below
        assert!(output.contains("#block("), "missing block: {}", output);
        assert!(output.contains("Title"), "missing title: {}", output);
        assert!(!output.contains("<!--"), "metadata comments should be stripped: {}", output);
        assert!(!output.contains("image:"), "image metadata leaked: {}", output);
    }

    #[test]
    fn test_link_preview_with_metadata_compiles_to_pdf() {
        use super::super::typst_world::NotesageWorld;

        let markdown = "# Test\n\n> [!link](https://example.com)\n> **Example**\n> A description\n> example.com\n> <!--image:https://example.com/img.png-->\n> <!--favicon:https://example.com/fav.ico-->\n";
        let typst = markdown_to_typst(markdown, None);
        let _ = &typst; // used below
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }

    #[test]
    fn test_link_preview_gmail_compiles_to_pdf() {
        use super::super::typst_world::NotesageWorld;

        // Simulate what the app actually saves for a gmail.com link preview
        let markdown = r#"# Test

> [!link](https://gmail.com)
> **Gmail**
> Preview unavailable
> gmail.com
> <!--image:https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico-->
> <!--favicon:https://gmail.com/favicon.ico-->
"#;
        let typst = markdown_to_typst(markdown, None);
        let _ = &typst; // used below
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }

    #[test]
    fn test_real_document_with_link_previews() {
        use super::super::typst_world::NotesageWorld;

        let markdown = "## Changes\n\n/\n\n> [!link](https://github.com)\n> **GitHub**\n> Description\n> GitHub\n> <!--image:https://example.com/img.png-->\n> <!--favicon:https://github.com/fav.ico-->\n".to_string();
        let typst = markdown_to_typst(&markdown, None);
        let _ = &typst; // used below
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }

    #[test]
    fn test_link_preview_does_not_affect_regular_blockquote() {
        let input = "> This is a regular quote";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#quote(block: true)"), "should be blockquote: {}", output);
    }

    // --- Enhanced table tests ---

    #[test]
    fn test_table_without_metadata_unchanged() {
        // Tables without column metadata should produce identical output to before
        let input = "| Name | Value |\n|------|-------|\n| Alice | 100 |\n| Bob | 200 |";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#table("), "output: {}", output);
        assert!(output.contains("columns: 2"), "output: {}", output);
        assert!(output.contains("[Name]"), "output: {}", output);
        assert!(output.contains("[Value]"), "output: {}", output);
        assert!(output.contains("[Alice]"), "output: {}", output);
        assert!(output.contains("[100]"), "output: {}", output);
        // No footer row
        assert!(!output.contains("table.hline"), "output: {}", output);
        assert!(!output.contains("table.cell"), "output: {}", output);
    }

    #[test]
    fn test_parse_column_metadata() {
        let (clean, meta) = parse_column_metadata("Amount <!-- type:currency,currency:USD,summary:sum -->");
        assert_eq!(clean, "Amount");
        assert_eq!(meta.col_type(), Some("currency"));
        assert_eq!(meta.currency(), Some("USD"));
        assert_eq!(meta.summary(), Some("sum"));
    }

    #[test]
    fn test_parse_column_metadata_no_comment() {
        let (clean, meta) = parse_column_metadata("Plain Header");
        assert_eq!(clean, "Plain Header");
        assert!(meta.props.is_empty());
    }

    #[test]
    fn test_compute_aggregation_sum() {
        assert_eq!(compute_aggregation(&[10.0, 20.0, 30.0], "sum"), Some(60.0));
    }

    #[test]
    fn test_compute_aggregation_avg() {
        assert_eq!(compute_aggregation(&[10.0, 20.0, 30.0], "avg"), Some(20.0));
    }

    #[test]
    fn test_compute_aggregation_count() {
        assert_eq!(compute_aggregation(&[10.0, 20.0, 30.0], "count"), Some(3.0));
    }

    #[test]
    fn test_compute_aggregation_min_max() {
        assert_eq!(compute_aggregation(&[10.0, 5.0, 30.0], "min"), Some(5.0));
        assert_eq!(compute_aggregation(&[10.0, 5.0, 30.0], "max"), Some(30.0));
    }

    #[test]
    fn test_compute_aggregation_empty() {
        assert_eq!(compute_aggregation(&[], "sum"), None);
    }

    #[test]
    fn test_compute_aggregation_unknown() {
        assert_eq!(compute_aggregation(&[1.0], "median"), None);
    }

    #[test]
    fn test_format_value_currency_usd() {
        assert_eq!(format_value(42.50, "currency", Some("USD")), "$42.50");
    }

    #[test]
    fn test_format_value_currency_eur() {
        assert_eq!(format_value(42.50, "currency", Some("EUR")), "\u{20AC}42.50");
    }

    #[test]
    fn test_format_value_percentage() {
        assert_eq!(format_value(0.85, "percentage", None), "85.0%");
    }

    #[test]
    fn test_format_value_number_integer() {
        assert_eq!(format_value(42.0, "number", None), "42");
    }

    #[test]
    fn test_format_value_number_decimal() {
        assert_eq!(format_value(42.567, "number", None), "42.57");
    }

    #[test]
    fn test_strip_sparkline() {
        assert_eq!(strip_sparkline_syntax("{{spark:12,15,9,22,18}}"), "12, 15, 9, 22, 18");
    }

    #[test]
    fn test_strip_sparkline_with_spaces() {
        assert_eq!(strip_sparkline_syntax("{{spark:12, 15, 9}}"), "12, 15, 9");
    }

    #[test]
    fn test_strip_sparkline_no_match() {
        assert_eq!(strip_sparkline_syntax("plain text"), "plain text");
    }

    #[test]
    fn test_table_with_summary_footer() {
        let input = "| Item | Amount <!-- type:number,summary:sum --> |\n|------|--------|\n| A | 10 |\n| B | 20 |\n| C | 30 |";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("#table("), "missing table: {}", output);
        assert!(output.contains("table.hline"), "missing footer hline: {}", output);
        assert!(output.contains("table.cell(fill: luma(240))"), "missing footer cell: {}", output);
        assert!(output.contains("Sum: 60"), "missing sum value: {}", output);
    }

    #[test]
    fn test_table_with_currency_formatting() {
        let input = "| Item | Price <!-- type:currency,currency:USD,summary:sum --> |\n|------|-------|\n| A | 10.50 |\n| B | 20.75 |";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("\\$10.50"), "missing formatted price 10.50: {}", output);
        assert!(output.contains("\\$20.75"), "missing formatted price 20.75: {}", output);
        assert!(output.contains("Sum: \\$31.25"), "missing sum: {}", output);
    }

    #[test]
    fn test_table_with_sparkline_degraded() {
        let input = "| Item | Trend |\n|------|-------|\n| A | {{spark:12,15,9,22,18}} |";
        let output = markdown_to_typst(input, None);
        assert!(output.contains("12, 15, 9, 22, 18"), "sparkline should degrade to numbers: {}", output);
        assert!(!output.contains("{{spark"), "sparkline syntax should be stripped: {}", output);
    }

    #[test]
    fn test_table_mixed_columns_some_with_metadata() {
        let input = "| Name | Score <!-- type:number,summary:avg --> |\n|------|-------|\n| Alice | 85 |\n| Bob | 95 |";
        let output = markdown_to_typst(input, None);
        // First column footer should be empty
        assert!(output.contains("table.cell(fill: luma(240))[]"), "missing empty footer cell: {}", output);
        // Second column should have avg
        assert!(output.contains("Avg: 90"), "missing avg: {}", output);
    }

    #[test]
    fn test_table_header_comment_stripped() {
        let input = "| Item | Amount <!-- type:number --> |\n|------|--------|\n| A | 10 |";
        let output = markdown_to_typst(input, None);
        assert!(!output.contains("<!--"), "HTML comment should be stripped: {}", output);
        assert!(output.contains("[Amount]"), "header text should remain: {}", output);
    }

    #[test]
    fn test_table_with_metadata_compiles_to_pdf() {
        use super::super::typst_world::NotesageWorld;

        let markdown = "# Budget\n\n| Item | Amount <!-- type:currency,currency:USD,summary:sum --> |\n|------|--------|\n| Rent | 1200 |\n| Food | 400 |\n| Utils | 150 |\n";
        let typst = markdown_to_typst(markdown, None);
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }

    #[test]
    fn test_table_with_sparkline_compiles_to_pdf() {
        use super::super::typst_world::NotesageWorld;

        let markdown = "# Trends\n\n| Item | Trend |\n|------|-------|\n| A | {{spark:1,2,3,4,5}} |\n| B | {{spark:5,4,3,2,1}} |\n";
        let typst = markdown_to_typst(markdown, None);
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }

    #[test]
    fn test_parse_numeric_value() {
        assert_eq!(parse_numeric_value("42"), Some(42.0));
        assert_eq!(parse_numeric_value("$1,234.56"), Some(1234.56));
        assert_eq!(parse_numeric_value("85%"), Some(85.0));
        assert_eq!(parse_numeric_value("not a number"), None);
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
        let typst = markdown_to_typst(markdown, None);
        let world = NotesageWorld::new(typst);
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
    }
}
