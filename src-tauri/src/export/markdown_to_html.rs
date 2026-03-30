use comrak::nodes::NodeValue;
use comrak::{format_html_with_plugins, parse_document, Arena, Options};
use comrak::options::Plugins;
use comrak::plugins::syntect::SyntectAdapter;
use regex::Regex;
use std::collections::HashMap;

/// Convert a markdown string to an HTML body fragment.
///
/// The `theme` parameter selects the syntax highlighting theme:
/// - `"light"` uses a light code highlighting theme
/// - `"dark"` uses a dark code highlighting theme
///
/// `project_root` is used to resolve local image paths (drawings, charts).
pub fn markdown_to_html(markdown: &str, theme: &str, project_root: Option<&str>) -> String {
    // Pre-process: extract table metadata and drawing blocks before comrak parsing
    let (preprocessed, table_metadata) = preprocess_markdown(markdown, project_root);

    // Configure comrak options — GFM extensions
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.footnotes = true;
    options.extension.front_matter_delimiter = Some("---".to_string());

    // Parse the document
    let arena = Arena::new();
    let root = parse_document(&arena, &preprocessed, &options);

    // Strip frontmatter nodes (comrak parses them but we don't want them in output)
    strip_frontmatter_nodes(root);

    // Set up syntect syntax highlighter
    let syntax_theme = match theme {
        "dark" => "base16-ocean.dark",
        _ => "InspiredGitHub",
    };
    let adapter = SyntectAdapter::new(Some(syntax_theme));

    let mut plugins = Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(&adapter);

    // Render to HTML
    let mut html_output = String::new();
    format_html_with_plugins(root, &options, &mut html_output, &plugins)
        .expect("HTML rendering failed");

    // Post-process the HTML
    let html = postprocess_callouts(&html_output);
    let html = postprocess_link_previews(&html);
    let html = postprocess_sparklines(&html);
    let html = postprocess_drawing_placeholders(&html);
    let html = postprocess_table_footers(&html, &table_metadata);

    html
}

// ---------------------------------------------------------------------------
// Pre-processing (before comrak parsing)
// ---------------------------------------------------------------------------

/// Table metadata per table index: maps column index → metadata props.
type TableMetadata = Vec<HashMap<usize, ColumnMeta>>;

/// Column metadata extracted from HTML comments in table header cells.
#[derive(Default, Clone, Debug)]
struct ColumnMeta {
    props: HashMap<String, String>,
}

impl ColumnMeta {
    fn col_type(&self) -> Option<&str> {
        self.props.get("type").map(|s| s.as_str())
    }
    fn currency(&self) -> Option<&str> {
        self.props.get("currency").map(|s| s.as_str())
    }
    fn summary(&self) -> Option<&str> {
        self.props.get("summary").map(|s| s.as_str())
    }
}

/// Pre-process markdown before comrak parsing:
/// - Extract table column metadata from HTML comments
/// - Replace drawing blocks with text placeholders (since comrak strips raw HTML)
fn preprocess_markdown(markdown: &str, project_root: Option<&str>) -> (String, TableMetadata) {
    let mut result = String::with_capacity(markdown.len());
    let mut table_metadata: TableMetadata = Vec::new();
    let mut current_table_meta: HashMap<usize, ColumnMeta> = HashMap::new();
    let mut in_table = false;
    let mut header_seen = false;

    // Regex for table metadata comments
    let meta_re = Regex::new(r"<!--\s*([\w:,\s]+)\s*-->").unwrap();
    // Regex for drawing blocks
    let drawing_re = Regex::new(
        r#"<div\s+data-drawing-id="([^"]+)"\s+data-type="drawing"\s+class="drawing-block"\s*>\s*</div>"#,
    ).unwrap();

    for line in markdown.lines() {
        let trimmed = line.trim();

        // Detect drawing blocks and replace with placeholder
        if drawing_re.is_match(trimmed) {
            if let Some(caps) = drawing_re.captures(trimmed) {
                let drawing_path = caps.get(1).unwrap().as_str();
                // Resolve SVG path
                let svg_path = if drawing_path.ends_with(".excalidraw") {
                    format!("{}.svg", drawing_path.trim_end_matches(".excalidraw"))
                } else {
                    format!("{}.svg", drawing_path)
                };

                // Try to read SVG and embed as a data URI
                let img_src = if let Some(root) = project_root {
                    let full_path = if svg_path.starts_with('/') {
                        format!("{}{}", root, svg_path)
                    } else {
                        format!("{}/{}", root, svg_path)
                    };
                    if let Ok(svg_content) = std::fs::read_to_string(&full_path) {
                        // Encode SVG as a data URI using URL-safe encoding
                        let encoded = svg_content
                            .replace('%', "%25")
                            .replace('#', "%23")
                            .replace('<', "%3C")
                            .replace('>', "%3E")
                            .replace('"', "%22")
                            .replace('\'', "%27")
                            .replace('\n', "%0A");
                        format!("data:image/svg+xml,{}", encoded)
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };

                if img_src.is_empty() {
                    result.push_str(&format!(
                        "NOTESAGE_DRAWING_PLACEHOLDER_{}_END\n",
                        drawing_path
                    ));
                } else {
                    result.push_str(&format!(
                        "![Drawing]({})\n",
                        img_src
                    ));
                }
                continue;
            }
        }

        // Track table boundaries and extract metadata
        let is_table_row = trimmed.starts_with('|') && trimmed.ends_with('|');
        let is_separator = is_table_row
            && trimmed
                .chars()
                .all(|c| c == '|' || c == '-' || c == ':' || c == ' ');

        if is_table_row && !is_separator {
            if !in_table {
                in_table = true;
                header_seen = false;
                current_table_meta.clear();
            }

            if !header_seen {
                // This is a header row — extract metadata from cells
                let cells: Vec<&str> = trimmed
                    .trim_matches('|')
                    .split('|')
                    .collect();
                for (col_idx, cell) in cells.iter().enumerate() {
                    let cell_text = cell.trim();
                    if let Some(caps) = meta_re.captures(cell_text) {
                        let comment = caps.get(1).unwrap().as_str();
                        let mut props = HashMap::new();
                        for pair in comment.split(',') {
                            if let Some((key, value)) = pair.trim().split_once(':') {
                                props.insert(key.trim().to_string(), value.trim().to_string());
                            }
                        }
                        current_table_meta.insert(col_idx, ColumnMeta { props });
                    }
                }
                // Strip metadata comments from the header line
                let cleaned = meta_re.replace_all(trimmed, "").to_string();
                result.push_str(&cleaned);
                result.push('\n');
                continue;
            }
        } else if is_separator && in_table && !header_seen {
            header_seen = true;
        } else if !is_table_row && in_table {
            // End of table
            in_table = false;
            if !current_table_meta.is_empty() {
                table_metadata.push(current_table_meta.clone());
            }
            current_table_meta.clear();
        }

        result.push_str(line);
        result.push('\n');
    }

    // Handle table at end of document
    if in_table && !current_table_meta.is_empty() {
        table_metadata.push(current_table_meta);
    }

    // Remove trailing newline we added
    if result.ends_with('\n') && !markdown.ends_with('\n') {
        result.pop();
    }

    (result, table_metadata)
}

// ---------------------------------------------------------------------------
// Post-processing (after comrak rendering)
// ---------------------------------------------------------------------------

/// SVG icon paths for callout types.
fn callout_icon_svg(callout_type: &str) -> &'static str {
    match callout_type {
        "note" => r#"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>"#,
        "tip" => r#"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>"#,
        "warning" => r#"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>"#,
        "important" => r#"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>"#,
        _ => "",
    }
}

/// CSS styles for each callout type (border-color, background-color, icon-color).
fn callout_colors(callout_type: &str) -> (&'static str, &'static str, &'static str) {
    match callout_type {
        "note" => ("#5B7B9E", "#F0F4F8", "#5B7B9E"),
        "tip" => ("#4A9E6B", "#F0F8F3", "#4A9E6B"),
        "warning" => ("#B8860B", "#FDF8F0", "#B8860B"),
        "important" => ("#C0392B", "#FDF0F0", "#C0392B"),
        _ => ("#5B7B9E", "#F0F4F8", "#5B7B9E"),
    }
}

/// Transform `<blockquote>` elements containing `[!type]` markers into styled callout divs.
fn postprocess_callouts(html: &str) -> String {
    // comrak renders `> [!note]\n> Content` as:
    // <blockquote>\n<p>[!note]\nContent</p>\n</blockquote>
    // Or with custom title: `> [!note] Title\n> Content` as:
    // <blockquote>\n<p>[!note] Title\nContent</p>\n</blockquote>
    let re = Regex::new(
        r"(?s)<blockquote>\s*<p>\[!(note|tip|warning|important)\]([ \t]+([^\n]*))?\n?(.*?)</p>\s*(.*?)\s*</blockquote>"
    ).unwrap();

    re.replace_all(html, |caps: &regex::Captures| {
        let callout_type = caps.get(1).unwrap().as_str();
        // Group 3 is the custom title (text after [!type] on the same line, excluding the leading spaces)
        let custom_title = caps.get(3).map(|m| m.as_str().trim()).filter(|s| !s.is_empty());
        // Group 4 is the remaining content of the first <p> after the [!type] line
        let first_para_rest = caps.get(4).map(|m| m.as_str().trim()).unwrap_or("");
        // Group 5 is any additional paragraphs/elements after the first <p>
        let remaining = caps.get(5).map(|m| m.as_str().trim()).unwrap_or("");

        let title = custom_title.unwrap_or(match callout_type {
            "note" => "Note",
            "tip" => "Tip",
            "warning" => "Warning",
            "important" => "Important",
            _ => "Note",
        });

        let (border, bg, icon_color) = callout_colors(callout_type);
        let icon = callout_icon_svg(callout_type);

        let mut content = String::new();
        if !first_para_rest.is_empty() {
            content.push_str(&format!("<p>{}</p>", first_para_rest));
        }
        if !remaining.is_empty() {
            content.push_str(remaining);
        }

        format!(
            r#"<div class="callout callout-{}" style="border-left: 3px solid {}; background: {}; padding: 12px 16px; border-radius: 4px; margin: 16px 0;">
<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: {}; font-weight: 600; font-size: 0.9em;">
{} {}
</div>
<div class="callout-content">{}</div>
</div>"#,
            callout_type, border, bg, icon_color, icon, title, content
        )
    }).to_string()
}

/// Transform link preview blockquotes (`> [!link](url)`) into styled link cards.
fn postprocess_link_previews(html: &str) -> String {
    // comrak renders > [!link](url) as:
    // <blockquote>\n<p><a href="url">!link</a>...</p>\n</blockquote>
    let re = Regex::new(
        r#"(?s)<blockquote>\s*<p><a href="([^"]+)">!link</a>(.*?)</p>\s*(?:(.*?))\s*</blockquote>"#
    ).unwrap();

    re.replace_all(html, |caps: &regex::Captures| {
        let url = caps.get(1).unwrap().as_str();
        let inline_text = caps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
        let remaining = caps.get(3).map(|m| m.as_str().trim()).unwrap_or("");

        // Extract title from bold text or remaining content
        let mut title = String::new();
        let mut description = String::new();

        // Parse inline text: may contain <strong>Title</strong> and description
        let strong_re = Regex::new(r"<strong>(.*?)</strong>").unwrap();
        if let Some(caps) = strong_re.captures(inline_text) {
            title = caps.get(1).unwrap().as_str().to_string();
            let rest = strong_re.replace(inline_text, "").trim().to_string();
            if !rest.is_empty() {
                description = rest;
            }
        } else if !inline_text.is_empty() {
            title = inline_text.to_string();
        }

        // If no title was found, use the URL domain
        if title.is_empty() {
            title = url.to_string();
        }

        if description.is_empty() && !remaining.is_empty() {
            // Strip <p> tags from remaining
            let p_re = Regex::new(r"<p>(.*?)</p>").unwrap();
            for m in p_re.captures_iter(remaining) {
                if description.is_empty() {
                    description = m.get(1).unwrap().as_str().to_string();
                }
            }
        }

        let desc_html = if !description.is_empty() {
            format!(
                r#"<div style="color: #666; font-size: 0.9em; margin-top: 4px;">{}</div>"#,
                description
            )
        } else {
            String::new()
        };

        format!(
            r#"<a href="{}" class="link-preview" style="display: block; text-decoration: none; color: inherit; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 16px; margin: 16px 0; transition: background 0.15s;" onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
<div style="font-weight: 600;">{}</div>
{}
<div style="color: #999; font-size: 0.8em; margin-top: 4px;">{}</div>
</a>"#,
            url, title, desc_html, url
        )
    }).to_string()
}

/// Replace `{{spark:1,2,3}}` patterns with inline SVG polyline charts.
fn postprocess_sparklines(html: &str) -> String {
    let re = Regex::new(r"\{\{spark:([\d.,\s-]+)\}\}").unwrap();

    re.replace_all(html, |caps: &regex::Captures| {
        let nums_str = caps.get(1).unwrap().as_str();
        let values: Vec<f64> = nums_str
            .split(',')
            .filter_map(|s| s.trim().parse::<f64>().ok())
            .collect();

        if values.is_empty() {
            return String::new();
        }

        render_sparkline_svg(&values)
    }).to_string()
}

/// Render an inline SVG sparkline from a slice of values.
fn render_sparkline_svg(values: &[f64]) -> String {
    let width = 60.0_f64;
    let height = 20.0_f64;
    let padding = 2.0_f64;

    let min = values.iter().cloned().reduce(f64::min).unwrap_or(0.0);
    let max = values.iter().cloned().reduce(f64::max).unwrap_or(1.0);
    let range = if (max - min).abs() < f64::EPSILON { 1.0 } else { max - min };

    let points: Vec<String> = values
        .iter()
        .enumerate()
        .map(|(i, &v)| {
            let x = padding + (i as f64 / (values.len() - 1).max(1) as f64) * (width - 2.0 * padding);
            let y = padding + (1.0 - (v - min) / range) * (height - 2.0 * padding);
            format!("{:.1},{:.1}", x, y)
        })
        .collect();

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}" style="vertical-align: middle; display: inline-block;"><polyline points="{}" fill="none" stroke="#888" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>"##,
        width as i32, height as i32, points.join(" ")
    )
}

/// Replace drawing placeholders with styled fallback elements.
fn postprocess_drawing_placeholders(html: &str) -> String {
    let re = Regex::new(r"NOTESAGE_DRAWING_PLACEHOLDER_(.+?)_END").unwrap();
    re.replace_all(html, |caps: &regex::Captures| {
        let path = caps.get(1).unwrap().as_str();
        format!(
            r#"<div class="drawing-placeholder" style="padding: 24px; text-align: center; color: #999; border: 1px dashed #ddd; border-radius: 8px; margin: 16px 0;">Drawing: {}</div>"#,
            path
        )
    }).to_string()
}

/// Compute and append `<tfoot>` rows for tables with aggregation metadata.
fn postprocess_table_footers(html: &str, table_metadata: &TableMetadata) -> String {
    if table_metadata.is_empty() {
        return html.to_string();
    }

    // Find each <table>...</table> block and match with metadata
    let table_re = Regex::new(r"(?s)(<table>.*?</table>)").unwrap();
    let mut meta_idx = 0;
    let mut result = String::new();
    let mut last_end = 0;

    for m in table_re.find_iter(html) {
        result.push_str(&html[last_end..m.start()]);

        let table_html = m.as_str();
        if meta_idx < table_metadata.len() {
            let meta = &table_metadata[meta_idx];
            let has_summary = meta.values().any(|m| m.summary().is_some());
            if has_summary {
                result.push_str(&add_table_footer(table_html, meta));
            } else {
                result.push_str(table_html);
            }
            meta_idx += 1;
        } else {
            result.push_str(table_html);
        }

        last_end = m.end();
    }
    result.push_str(&html[last_end..]);

    result
}

/// Parse table body cells and compute aggregation footer.
fn add_table_footer(table_html: &str, meta: &HashMap<usize, ColumnMeta>) -> String {
    // Count columns from the header
    let th_re = Regex::new(r"<th[^>]*>.*?</th>").unwrap();
    let num_cols = th_re.find_iter(table_html).count();
    if num_cols == 0 {
        return table_html.to_string();
    }

    // Extract body cell values
    let tbody_re = Regex::new(r"(?s)<tbody>(.*?)</tbody>").unwrap();
    let td_re = Regex::new(r"(?s)<td[^>]*>(.*?)</td>").unwrap();
    let tag_strip_re = Regex::new(r"<[^>]+>").unwrap();

    let mut col_values: Vec<Vec<f64>> = vec![Vec::new(); num_cols];

    if let Some(tbody_caps) = tbody_re.captures(table_html) {
        let tbody = tbody_caps.get(1).unwrap().as_str();
        let row_re = Regex::new(r"(?s)<tr>(.*?)</tr>").unwrap();
        for row_match in row_re.captures_iter(tbody) {
            let row = row_match.get(1).unwrap().as_str();
            for (col_idx, td_match) in td_re.captures_iter(row).enumerate() {
                if col_idx < num_cols {
                    let cell_text = tag_strip_re.replace_all(
                        td_match.get(1).unwrap().as_str(), ""
                    ).trim().to_string();
                    if let Some(val) = parse_numeric_value(&cell_text) {
                        col_values[col_idx].push(val);
                    }
                }
            }
        }
    }

    // Build footer row
    let mut footer_cells = Vec::new();
    for col_idx in 0..num_cols {
        if let Some(col_meta) = meta.get(&col_idx) {
            if let Some(agg_type) = col_meta.summary() {
                if let Some(result) = compute_aggregation(&col_values[col_idx], agg_type) {
                    let formatted = if let Some(col_type) = col_meta.col_type() {
                        format_value(result, col_type, col_meta.currency())
                    } else {
                        format_number(result)
                    };
                    let label = match agg_type {
                        "sum" => "Sum",
                        "avg" => "Avg",
                        "count" => "Count",
                        "min" => "Min",
                        "max" => "Max",
                        _ => "",
                    };
                    footer_cells.push(format!(
                        r#"<td style="font-weight: 600; font-size: 0.9em; color: #666; background: #f5f5f5; border-top: 2px solid #ddd;">{}: {}</td>"#,
                        label, formatted
                    ));
                } else {
                    footer_cells.push(r#"<td style="background: #f5f5f5; border-top: 2px solid #ddd;"></td>"#.to_string());
                }
            } else {
                footer_cells.push(r#"<td style="background: #f5f5f5; border-top: 2px solid #ddd;"></td>"#.to_string());
            }
        } else {
            footer_cells.push(r#"<td style="background: #f5f5f5; border-top: 2px solid #ddd;"></td>"#.to_string());
        }
    }

    let footer = format!(
        "<tfoot><tr>{}</tr></tfoot>",
        footer_cells.join("")
    );

    // Insert <tfoot> before </table>
    table_html.replace("</table>", &format!("{}</table>", footer))
}

/// Try to parse a numeric value from cell text, stripping currency symbols and percent signs.
fn parse_numeric_value(text: &str) -> Option<f64> {
    let cleaned = text
        .trim()
        .replace(',', "")
        .replace('$', "")
        .replace('\u{20AC}', "")  // €
        .replace('\u{00A3}', "")  // £
        .replace('\u{00A5}', "")  // ¥
        .replace("kr ", "")
        .replace("kr", "")
        .replace('%', "");
    cleaned.trim().parse::<f64>().ok()
}

/// Compute an aggregation over a slice of numeric values.
fn compute_aggregation(values: &[f64], agg_type: &str) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    match agg_type {
        "sum" => Some(values.iter().sum()),
        "avg" => Some(values.iter().sum::<f64>() / values.len() as f64),
        "count" => Some(values.len() as f64),
        "min" => values.iter().cloned().reduce(f64::min),
        "max" => values.iter().cloned().reduce(f64::max),
        _ => None,
    }
}

/// Format a numeric value based on column type.
fn format_value(value: f64, col_type: &str, currency: Option<&str>) -> String {
    match col_type {
        "currency" => {
            let symbol = match currency.unwrap_or("USD") {
                "USD" => "$",
                "EUR" => "\u{20AC}",
                "GBP" => "\u{00A3}",
                "SEK" => "kr ",
                "JPY" => "\u{00A5}",
                "CNY" => "\u{00A5}",
                _ => "$",
            };
            format!("{}{:.2}", symbol, value)
        }
        "percentage" => format!("{:.1}%", value * 100.0),
        "number" => format_number(value),
        _ => format!("{}", value),
    }
}

/// Format a number, using integer display when appropriate.
fn format_number(value: f64) -> String {
    if value == value.floor() && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        format!("{:.2}", value)
    }
}

/// Remove FrontMatter nodes from the AST so they don't appear in the output.
fn strip_frontmatter_nodes<'a>(root: &'a comrak::nodes::AstNode<'a>) {
    let mut to_detach = Vec::new();
    for child in root.children() {
        if matches!(child.data.borrow().value, NodeValue::FrontMatter(_)) {
            to_detach.push(child);
        }
    }
    for node in to_detach {
        node.detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Task #1: Basic GFM rendering ---

    #[test]
    fn test_headings() {
        let html = markdown_to_html("# Heading 1\n\n## Heading 2\n\n### Heading 3", "light", None);
        assert!(html.contains("<h1>Heading 1</h1>"));
        assert!(html.contains("<h2>Heading 2</h2>"));
        assert!(html.contains("<h3>Heading 3</h3>"));
    }

    #[test]
    fn test_paragraphs() {
        let html = markdown_to_html("Hello world.\n\nSecond paragraph.", "light", None);
        assert!(html.contains("<p>Hello world.</p>"));
        assert!(html.contains("<p>Second paragraph.</p>"));
    }

    #[test]
    fn test_bold_italic() {
        let html = markdown_to_html("**bold** and *italic*", "light", None);
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
    }

    #[test]
    fn test_strikethrough() {
        let html = markdown_to_html("~~deleted~~", "light", None);
        assert!(html.contains("<del>deleted</del>"));
    }

    #[test]
    fn test_inline_code() {
        let html = markdown_to_html("Use `code` here", "light", None);
        assert!(html.contains("<code>code</code>"));
    }

    #[test]
    fn test_code_block_highlighted() {
        let html = markdown_to_html("```rust\nfn main() {}\n```", "light", None);
        assert!(html.contains("<pre"));
        assert!(html.contains("<code"));
        assert!(html.contains("<span"));
    }

    #[test]
    fn test_code_block_dark_theme() {
        let html = markdown_to_html("```js\nconst x = 1;\n```", "dark", None);
        assert!(html.contains("<pre"));
        assert!(html.contains("background-color:"));
    }

    #[test]
    fn test_links() {
        let html = markdown_to_html("[Example](https://example.com)", "light", None);
        assert!(html.contains("<a href=\"https://example.com\">Example</a>"));
    }

    #[test]
    fn test_images() {
        let html = markdown_to_html("![alt text](image.png)", "light", None);
        assert!(html.contains("<img"));
        assert!(html.contains("src=\"image.png\""));
        assert!(html.contains("alt=\"alt text\""));
    }

    #[test]
    fn test_bullet_list() {
        let html = markdown_to_html("- Item 1\n- Item 2\n- Item 3", "light", None);
        assert!(html.contains("<ul>"));
        assert!(html.contains("<li>Item 1</li>"));
    }

    #[test]
    fn test_ordered_list() {
        let html = markdown_to_html("1. First\n2. Second", "light", None);
        assert!(html.contains("<ol>"));
        assert!(html.contains("<li>First</li>"));
    }

    #[test]
    fn test_task_list() {
        let html = markdown_to_html("- [x] Done\n- [ ] Not done", "light", None);
        assert!(html.contains("checked=\"\""));
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("disabled=\"\""));
    }

    #[test]
    fn test_blockquote() {
        let html = markdown_to_html("> A quote", "light", None);
        assert!(html.contains("<blockquote>"));
        assert!(html.contains("A quote"));
    }

    #[test]
    fn test_horizontal_rule() {
        let html = markdown_to_html("---\n\nText after", "light", None);
        assert!(html.contains("<hr"));
    }

    #[test]
    fn test_table() {
        let md = "| Col A | Col B |\n|-------|-------|\n| 1     | 2     |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<table>"));
        assert!(html.contains("<thead>"));
        assert!(html.contains("<tbody>"));
        assert!(html.contains("<th>Col A</th>"));
        assert!(html.contains("<td>1</td>"));
    }

    #[test]
    fn test_frontmatter_stripped() {
        let md = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Content";
        let html = markdown_to_html(md, "light", None);
        assert!(!html.contains("title: Hello"));
        assert!(!html.contains("tags:"));
        assert!(html.contains("<h1>Content</h1>"));
    }

    #[test]
    fn test_footnotes() {
        let md = "Text with a footnote[^1].\n\n[^1]: This is the footnote.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("footnote"));
    }

    #[test]
    fn test_autolinks() {
        let html = markdown_to_html("Visit https://example.com for more.", "light", None);
        assert!(html.contains("<a href=\"https://example.com\">"));
    }

    #[test]
    fn test_xss_prevention() {
        let html = markdown_to_html("<script>alert('xss')</script>", "light", None);
        assert!(!html.contains("<script>"));
        assert!(!html.contains("alert"));
    }

    #[test]
    fn test_xss_img_onerror() {
        let html = markdown_to_html("<img src=x onerror=alert(1)>", "light", None);
        assert!(!html.contains("onerror"));
    }

    #[test]
    fn test_empty_input() {
        let html = markdown_to_html("", "light", None);
        assert!(html.is_empty() || html.trim().is_empty());
    }

    #[test]
    fn test_theme_parameter() {
        let light = markdown_to_html("```py\nprint('hi')\n```", "light", None);
        let dark = markdown_to_html("```py\nprint('hi')\n```", "dark", None);
        assert!(light.contains("<pre"));
        assert!(dark.contains("<pre"));
        assert_ne!(light, dark);
    }

    // --- Task #2: Callout blocks ---

    #[test]
    fn test_callout_note() {
        let md = "> [!note]\n> This is a note.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("callout-note"));
        assert!(html.contains("Note"));
        assert!(html.contains("This is a note."));
        assert!(!html.contains("<blockquote>"));
    }

    #[test]
    fn test_callout_tip() {
        let md = "> [!tip]\n> A helpful tip.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("callout-tip"));
        assert!(html.contains("Tip"));
    }

    #[test]
    fn test_callout_warning() {
        let md = "> [!warning]\n> Be careful!";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("callout-warning"));
        assert!(html.contains("Warning"));
    }

    #[test]
    fn test_callout_important() {
        let md = "> [!important]\n> Critical info.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("callout-important"));
        assert!(html.contains("Important"));
    }

    #[test]
    fn test_callout_with_custom_title() {
        let md = "> [!note] Custom Title\n> Content here.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("Custom Title"));
        assert!(html.contains("callout-note"));
    }

    #[test]
    fn test_callout_with_bold_content() {
        let md = "> [!tip]\n> This has **bold** text.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("callout-tip"));
        assert!(html.contains("<strong>bold</strong>"));
    }

    #[test]
    fn test_regular_blockquote_preserved() {
        let md = "> This is a regular blockquote.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<blockquote>"));
        assert!(!html.contains("callout"));
    }

    #[test]
    fn test_callout_has_svg_icon() {
        let md = "> [!note]\n> Content.";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<svg"));
    }

    // --- Task #3: Sparklines ---

    #[test]
    fn test_sparkline_renders_svg() {
        let md = "| Data |\n|------|\n| {{spark:12,15,9,22}} |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<svg"));
        assert!(html.contains("polyline"));
        assert!(!html.contains("{{spark:"));
    }

    #[test]
    fn test_sparkline_inline() {
        let html = markdown_to_html("Values: {{spark:1,2,3,4,5}}", "light", None);
        assert!(html.contains("<svg"));
        assert!(html.contains("polyline"));
    }

    // --- Task #3: Link previews ---

    #[test]
    fn test_link_preview() {
        let md = "> [!link](https://example.com)";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("link-preview"));
        assert!(html.contains("https://example.com"));
        assert!(!html.contains("<blockquote>"));
    }

    // --- Task #3: Drawing placeholders ---

    #[test]
    fn test_drawing_missing_svg_placeholder() {
        let md = r#"<div data-drawing-id="test.excalidraw" data-type="drawing" class="drawing-block"></div>"#;
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("drawing-placeholder") || html.contains("Drawing"));
    }

    // --- Task #3: Table metadata stripped ---

    #[test]
    fn test_table_metadata_stripped() {
        let md = "| Price <!-- type:currency,currency:USD,summary:sum --> |\n|-------|\n| $100 |";
        let html = markdown_to_html(md, "light", None);
        assert!(!html.contains("<!--"));
        assert!(!html.contains("type:currency"));
        assert!(html.contains("Price"));
    }

    // --- Task #4: Table aggregation footers ---

    #[test]
    fn test_table_footer_sum() {
        let md = "| Amount <!-- type:number,summary:sum --> |\n|--------|\n| 10 |\n| 20 |\n| 30 |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<tfoot>"));
        assert!(html.contains("Sum"));
        assert!(html.contains("60"));
    }

    #[test]
    fn test_table_footer_avg() {
        let md = "| Score <!-- type:number,summary:avg --> |\n|-------|\n| 10 |\n| 20 |\n| 30 |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<tfoot>"));
        assert!(html.contains("Avg"));
        assert!(html.contains("20"));
    }

    #[test]
    fn test_table_footer_currency() {
        let md = "| Price <!-- type:currency,currency:USD,summary:sum --> |\n|-------|\n| $10.00 |\n| $20.00 |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<tfoot>"));
        assert!(html.contains("$30.00"));
    }

    #[test]
    fn test_table_no_metadata_no_footer() {
        let md = "| Col A | Col B |\n|-------|-------|\n| 1 | 2 |";
        let html = markdown_to_html(md, "light", None);
        assert!(!html.contains("<tfoot>"));
    }

    #[test]
    fn test_table_footer_count() {
        let md = "| Items <!-- type:number,summary:count --> |\n|-------|\n| 5 |\n| 10 |\n| 15 |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("<tfoot>"));
        assert!(html.contains("Count"));
        assert!(html.contains("3"));
    }

    #[test]
    fn test_table_footer_min_max() {
        let md = "| Val <!-- type:number,summary:min --> |\n|-----|\n| 5 |\n| 3 |\n| 8 |";
        let html = markdown_to_html(md, "light", None);
        assert!(html.contains("Min"));
        assert!(html.contains("3"));
    }

    // --- Utility tests ---

    #[test]
    fn test_parse_numeric_value() {
        assert_eq!(parse_numeric_value("42"), Some(42.0));
        assert_eq!(parse_numeric_value("$1,234.56"), Some(1234.56));
        assert_eq!(parse_numeric_value("50%"), Some(50.0));
        assert_eq!(parse_numeric_value("€99.99"), Some(99.99));
        assert_eq!(parse_numeric_value("text"), None);
    }

    #[test]
    fn test_compute_aggregation() {
        let vals = vec![10.0, 20.0, 30.0];
        assert_eq!(compute_aggregation(&vals, "sum"), Some(60.0));
        assert_eq!(compute_aggregation(&vals, "avg"), Some(20.0));
        assert_eq!(compute_aggregation(&vals, "count"), Some(3.0));
        assert_eq!(compute_aggregation(&vals, "min"), Some(10.0));
        assert_eq!(compute_aggregation(&vals, "max"), Some(30.0));
        assert_eq!(compute_aggregation(&[], "sum"), None);
    }

    #[test]
    fn test_sparkline_svg_generation() {
        let svg = render_sparkline_svg(&[1.0, 2.0, 3.0, 2.0, 1.0]);
        assert!(svg.contains("<svg"));
        assert!(svg.contains("<polyline"));
        assert!(svg.contains("points="));
    }
}
