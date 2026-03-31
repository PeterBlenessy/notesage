use comrak::nodes::NodeValue;
use regex::Regex;
use std::collections::HashMap;

/// Column metadata extracted from HTML comments in table header cells.
/// E.g., `<!-- type:number,currency:USD,summary:sum -->`
#[derive(Default, Clone)]
pub struct ColumnMeta {
    pub props: HashMap<String, String>,
}

impl ColumnMeta {
    pub fn col_type(&self) -> Option<&str> {
        self.props.get("type").map(|s| s.as_str())
    }
    pub fn currency(&self) -> Option<&str> {
        self.props.get("currency").map(|s| s.as_str())
    }
    pub fn summary(&self) -> Option<&str> {
        self.props.get("summary").map(|s| s.as_str())
    }
}

/// Parse column metadata from an HTML comment in a header cell.
/// Returns (clean_text, metadata) where metadata contains key:value pairs.
pub fn parse_column_metadata(cell_text: &str) -> (String, ColumnMeta) {
    let re = Regex::new(r"<!--\s*([\w:,\s]+)\s*-->").unwrap();
    if let Some(caps) = re.captures(cell_text) {
        let comment = caps.get(1).unwrap().as_str();
        let clean = re.replace(cell_text, "").trim().to_string();
        let mut props = HashMap::new();
        for pair in comment.split(',') {
            if let Some((key, value)) = pair.trim().split_once(':') {
                props.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        (clean, ColumnMeta { props })
    } else {
        (cell_text.to_string(), ColumnMeta::default())
    }
}

/// Compute an aggregation over a slice of numeric values.
pub fn compute_aggregation(values: &[f64], agg_type: &str) -> Option<f64> {
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

/// Format a numeric value based on column type and currency.
pub fn format_value(value: f64, col_type: &str, currency: Option<&str>) -> String {
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
        "number" => {
            if value == value.floor() && value.abs() < 1e15 {
                format!("{}", value as i64)
            } else {
                format!("{:.2}", value)
            }
        }
        _ => format!("{}", value),
    }
}

/// Replace `{{spark:1,2,3}}` patterns with plain comma-separated numbers.
pub fn strip_sparkline_syntax(text: &str) -> String {
    let re = Regex::new(r"\{\{spark:([\d.,\s-]+)\}\}").unwrap();
    re.replace_all(text, |caps: &regex::Captures| {
        let nums = caps.get(1).map_or("", |m| m.as_str());
        // Normalize spacing: ensure single space after each comma
        nums.split(',')
            .map(|s| s.trim())
            .collect::<Vec<_>>()
            .join(", ")
    })
    .to_string()
}

/// Try to parse a numeric value from cell text, stripping currency symbols and percent signs.
pub fn parse_numeric_value(text: &str) -> Option<f64> {
    let cleaned = text
        .trim()
        .replace(',', "")
        .replace('$', "")
        .replace('\u{20AC}', "")
        .replace('\u{00A3}', "")
        .replace('\u{00A5}', "")
        .replace("kr ", "")
        .replace("kr", "")
        .replace('%', "");
    cleaned.trim().parse::<f64>().ok()
}

pub struct CalloutInfo {
    pub callout_type: String,
    pub title: Option<String>,
}

pub struct LinkPreviewInfo {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    #[allow(dead_code)]
    pub image_url: Option<String>,
}

/// Collect all text content from a node's descendants without formatting.
pub fn collect_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
    let mut text = String::new();
    for child in node.descendants() {
        if let NodeValue::Text(ref t) = child.data.borrow().value {
            text.push_str(t);
        }
    }
    text
}

/// Detect if a blockquote is a callout by checking the first text for `[!type]`.
pub fn detect_callout<'a>(node: &'a comrak::nodes::AstNode<'a>) -> Option<CalloutInfo> {
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

/// Detect if a blockquote is a link preview card by checking for `[!link](url)`.
///
/// Comrak parses `[!link](url)` as a `Link` node with child text "!link",
/// so we detect a Link whose text content is exactly "!link".
pub fn detect_link_preview<'a>(
    node: &'a comrak::nodes::AstNode<'a>,
) -> Option<LinkPreviewInfo> {
    let first_child = node.first_child()?;
    if !matches!(first_child.data.borrow().value, NodeValue::Paragraph) {
        return None;
    }

    let first_inline = first_child.first_child()?;
    let url = match &first_inline.data.borrow().value {
        NodeValue::Link(link) => {
            let link_text = collect_text(first_inline);
            if link_text != "!link" {
                return None;
            }
            link.url.clone()
        }
        _ => return None,
    };

    let mut title: Option<String> = None;
    let mut description: Option<String> = None;
    let mut site_name: Option<String> = None;
    let mut image_url: Option<String> = None;
    let mut lines: Vec<String> = Vec::new();
    let mut first_para = true;

    // Helper: extract image URL from HTML comment nodes or text
    let extract_metadata = |text: &str, image_url: &mut Option<String>| {
        let trimmed = text.trim();
        if let Some(rest) = trimmed.strip_prefix("<!--image:") {
            if let Some(url) = rest.strip_suffix("-->") {
                *image_url = Some(url.to_string());
            }
        }
    };

    for child in node.children() {
        if !matches!(child.data.borrow().value, NodeValue::Paragraph) {
            continue;
        }
        if first_para {
            first_para = false;
            let mut skip_link = true;
            for inner in child.children() {
                let inner_val = inner.data.borrow().value.clone();
                if skip_link {
                    skip_link = false;
                    if matches!(inner_val, NodeValue::Link(_)) {
                        continue;
                    }
                }
                match inner_val {
                    NodeValue::Strong => {
                        let bold_text = collect_text(inner);
                        if !bold_text.is_empty() {
                            title = Some(bold_text);
                        }
                    }
                    NodeValue::Text(ref t) => {
                        for line in t.lines() {
                            let trimmed = line.trim();
                            if trimmed.starts_with("<!--") {
                                extract_metadata(trimmed, &mut image_url);
                                continue;
                            }
                            if !trimmed.is_empty() {
                                lines.push(trimmed.to_string());
                            }
                        }
                    }
                    NodeValue::HtmlInline(ref html) => {
                        extract_metadata(html, &mut image_url);
                    }
                    NodeValue::HtmlBlock(ref hb) => {
                        extract_metadata(&hb.literal, &mut image_url);
                    }
                    NodeValue::SoftBreak => {}
                    _ => {}
                }
            }
        } else {
            for inner in child.children() {
                let inner_val = inner.data.borrow().value.clone();
                match inner_val {
                    NodeValue::Strong => {
                        let bold_text = collect_text(inner);
                        if title.is_none() && !bold_text.is_empty() {
                            title = Some(bold_text);
                        }
                    }
                    NodeValue::Text(ref t) => {
                        for line in t.lines() {
                            let trimmed = line.trim();
                            if trimmed.starts_with("<!--") {
                                extract_metadata(trimmed, &mut image_url);
                                continue;
                            }
                            if !trimmed.is_empty() {
                                lines.push(trimmed.to_string());
                            }
                        }
                    }
                    NodeValue::HtmlInline(ref html) => {
                        extract_metadata(html, &mut image_url);
                    }
                    NodeValue::HtmlBlock(ref hb) => {
                        extract_metadata(&hb.literal, &mut image_url);
                    }
                    _ => {}
                }
            }
        }
    }

    for line in &lines {
        if description.is_none() {
            description = Some(line.clone());
        } else if site_name.is_none() {
            site_name = Some(line.clone());
        } else {
            let prev_site = site_name.take().unwrap();
            let d = description.as_mut().unwrap();
            d.push(' ');
            d.push_str(&prev_site);
            site_name = Some(line.clone());
        }
    }

    Some(LinkPreviewInfo {
        url,
        title,
        description,
        site_name,
        image_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use comrak::{parse_document, Arena, Options};

    // ── parse_column_metadata ──────────────────────────────────────────

    #[test]
    fn parse_column_metadata_empty_string() {
        let (clean, meta) = parse_column_metadata("");
        assert_eq!(clean, "");
        assert!(meta.col_type().is_none());
        assert!(meta.currency().is_none());
        assert!(meta.summary().is_none());
    }

    #[test]
    fn parse_column_metadata_single_prop() {
        let (clean, meta) = parse_column_metadata("Amount <!-- type:currency -->");
        assert_eq!(clean, "Amount");
        assert_eq!(meta.col_type(), Some("currency"));
    }

    #[test]
    fn parse_column_metadata_multiple_props() {
        let (clean, meta) =
            parse_column_metadata("Sales <!-- type:currency,currency:USD,summary:sum -->");
        assert_eq!(clean, "Sales");
        assert_eq!(meta.col_type(), Some("currency"));
        assert_eq!(meta.currency(), Some("USD"));
        assert_eq!(meta.summary(), Some("sum"));
    }

    #[test]
    fn parse_column_metadata_no_comment() {
        let (clean, meta) = parse_column_metadata("Plain text");
        assert_eq!(clean, "Plain text");
        assert!(meta.col_type().is_none());
    }

    // ── compute_aggregation ────────────────────────────────────────────

    #[test]
    fn compute_aggregation_sum() {
        assert_eq!(compute_aggregation(&[10.0, 20.0, 30.0], "sum"), Some(60.0));
    }

    #[test]
    fn compute_aggregation_avg() {
        assert_eq!(compute_aggregation(&[10.0, 20.0, 30.0], "avg"), Some(20.0));
    }

    #[test]
    fn compute_aggregation_count() {
        assert_eq!(
            compute_aggregation(&[10.0, 20.0, 30.0], "count"),
            Some(3.0)
        );
    }

    #[test]
    fn compute_aggregation_min() {
        assert_eq!(compute_aggregation(&[5.0, 1.0, 3.0], "min"), Some(1.0));
    }

    #[test]
    fn compute_aggregation_max() {
        assert_eq!(compute_aggregation(&[5.0, 1.0, 3.0], "max"), Some(5.0));
    }

    #[test]
    fn compute_aggregation_empty() {
        assert_eq!(compute_aggregation(&[], "sum"), None);
    }

    #[test]
    fn compute_aggregation_unknown_type() {
        assert_eq!(compute_aggregation(&[1.0], "median"), None);
    }

    // ── format_value ───────────────────────────────────────────────────

    #[test]
    fn format_value_number_integer() {
        assert_eq!(format_value(42.0, "number", None), "42");
    }

    #[test]
    fn format_value_number_decimal() {
        assert_eq!(format_value(3.14, "number", None), "3.14");
    }

    #[test]
    fn format_value_currency_usd() {
        assert_eq!(format_value(1234.56, "currency", Some("USD")), "$1234.56");
    }

    #[test]
    fn format_value_currency_eur() {
        assert_eq!(
            format_value(1234.56, "currency", Some("EUR")),
            "\u{20AC}1234.56"
        );
    }

    #[test]
    fn format_value_percentage() {
        assert_eq!(format_value(0.75, "percentage", None), "75.0%");
    }

    // ── parse_numeric_value ────────────────────────────────────────────

    #[test]
    fn parse_numeric_value_plain() {
        assert_eq!(parse_numeric_value("42"), Some(42.0));
    }

    #[test]
    fn parse_numeric_value_currency() {
        assert_eq!(parse_numeric_value("$1,234.56"), Some(1234.56));
    }

    #[test]
    fn parse_numeric_value_percent() {
        assert_eq!(parse_numeric_value("75%"), Some(75.0));
    }

    #[test]
    fn parse_numeric_value_non_numeric() {
        assert_eq!(parse_numeric_value("hello"), None);
    }

    // ── strip_sparkline_syntax ─────────────────────────────────────────

    #[test]
    fn strip_sparkline_with_sparkline() {
        assert_eq!(strip_sparkline_syntax("{{spark:1,2,3}}"), "1, 2, 3");
    }

    #[test]
    fn strip_sparkline_without() {
        assert_eq!(strip_sparkline_syntax("plain text"), "plain text");
    }

    #[test]
    fn strip_sparkline_mixed() {
        assert_eq!(
            strip_sparkline_syntax("Value {{spark:10,20,30}} end"),
            "Value 10, 20, 30 end"
        );
    }

    // ── detect_callout (via comrak AST) ────────────────────────────────

    fn comrak_options() -> Options<'static> {
        let mut opts = Options::default();
        opts.extension.table = true;
        opts.extension.tasklist = true;
        opts.extension.strikethrough = true;
        opts.extension.autolink = true;
        opts.extension.footnotes = true;
        opts.extension.front_matter_delimiter = Some("---".to_string());
        opts
    }

    fn find_blockquote<'a>(
        root: &'a comrak::nodes::AstNode<'a>,
    ) -> Option<&'a comrak::nodes::AstNode<'a>> {
        for node in root.descendants() {
            if matches!(node.data.borrow().value, NodeValue::BlockQuote) {
                return Some(node);
            }
        }
        None
    }

    #[test]
    fn detect_callout_note_with_title() {
        let arena = Arena::new();
        let root = parse_document(&arena, "> [!note] Title\n", &comrak_options());
        let bq = find_blockquote(root).expect("should find blockquote");
        let info = detect_callout(bq).expect("should detect callout");
        assert_eq!(info.callout_type, "note");
        assert_eq!(info.title, Some("Title".to_string()));
    }

    #[test]
    fn detect_callout_warning_no_title() {
        let arena = Arena::new();
        let root = parse_document(&arena, "> [!warning]\n", &comrak_options());
        let bq = find_blockquote(root).expect("should find blockquote");
        let info = detect_callout(bq).expect("should detect callout");
        assert_eq!(info.callout_type, "warning");
        assert!(info.title.is_none());
    }

    #[test]
    fn detect_callout_regular_quote() {
        let arena = Arena::new();
        let root = parse_document(&arena, "> Regular quote\n", &comrak_options());
        let bq = find_blockquote(root).expect("should find blockquote");
        assert!(detect_callout(bq).is_none());
    }

    // ── detect_link_preview (via comrak AST) ───────────────────────────

    #[test]
    fn detect_link_preview_basic() {
        let arena = Arena::new();
        let md = "> [!link](https://example.com)\n> **My Title**\n> Some description\n";
        let root = parse_document(&arena, md, &comrak_options());
        let bq = find_blockquote(root).expect("should find blockquote");
        let info = detect_link_preview(bq).expect("should detect link preview");
        assert_eq!(info.url, "https://example.com");
        assert_eq!(info.title, Some("My Title".to_string()));
        assert_eq!(info.description, Some("Some description".to_string()));
    }

    #[test]
    fn detect_link_preview_regular_quote_is_none() {
        let arena = Arena::new();
        let root = parse_document(&arena, "> Regular quote\n", &comrak_options());
        let bq = find_blockquote(root).expect("should find blockquote");
        assert!(detect_link_preview(bq).is_none());
    }
}
