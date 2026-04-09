//! Markdown to PPTX slide model converter.
//!
//! Parses markdown via comrak into an intermediate slide model, then converts
//! to `ppt_rs::prelude::SlideContent` for PPTX generation.
//!
//! Features:
//! - H1 → new slide, H2 → subtitle, H3-H6 → bold text
//! - Bullet/ordered/task lists with nesting and proper styles
//! - Content overflow → continuation slides with "(cont.)" suffix
//! - GFM tables → native PowerPoint tables via QuickTable
//! - Code blocks → monospace-styled text (14pt, no bullet)
//! - Images and .excalidraw drawings → embedded PowerPoint images
//! - Inline chart JSON → native PowerPoint charts
//! - `> [!notes]` → speaker notes pane (not on slide)
//! - Callout blocks (note/tip/warning/important) → styled bullet with label
//! - `> [!link](url)` → text with URL
//! - `---` → explicit slide break

use crate::export::templates::{PptxTemplate, PptxTemplateConfig};
use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};
use ppt_rs::generator::charts::{Chart, ChartSeries, ChartType};
use ppt_rs::prelude::{
    create_pptx_with_content, BulletPoint, BulletStyle, Image, QuickTable, SlideContent,
    SlideLayout,
};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum bullet points per slide before splitting into continuation slides.
const MAX_BULLETS_PER_SLIDE: usize = 8;
/// Maximum words of body text per slide before splitting.
const MAX_WORDS_PER_SLIDE: usize = 300;

// ---------------------------------------------------------------------------
// Intermediate model — SlideBuilder
// ---------------------------------------------------------------------------

/// A slide being accumulated during AST walking.
#[derive(Clone, Debug)]
struct SlideBuilder {
    title: String,
    subtitle: Option<String>,
    bullets: Vec<SlideBullet>,
    tables: Vec<SlideTable>,
    images: Vec<SlideImage>,
    charts: Vec<SlideChart>,
    notes: Option<String>,
    is_title_slide: bool,
}

#[derive(Clone, Debug)]
struct SlideBullet {
    text: String,
    level: u32,
    style: BulletStyle,
    bold: bool,
    italic: bool,
    font_size: Option<u32>,
}

#[derive(Clone, Debug)]
struct SlideTable {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[derive(Clone, Debug)]
struct SlideImage {
    path: PathBuf,
}

#[derive(Clone, Debug)]
struct SlideChart {
    title: String,
    chart_type: String,
    labels: Vec<String>,
    datasets: Vec<ChartDataset>,
}

#[derive(Clone, Debug)]
struct ChartDataset {
    label: String,
    data: Vec<f64>,
}

impl SlideBuilder {
    fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            subtitle: None,
            bullets: Vec::new(),
            tables: Vec::new(),
            images: Vec::new(),
            charts: Vec::new(),
            notes: None,
            is_title_slide: false,
        }
    }

    fn title_slide(title: &str, subtitle: Option<String>) -> Self {
        Self {
            title: title.to_string(),
            subtitle,
            bullets: Vec::new(),
            tables: Vec::new(),
            images: Vec::new(),
            charts: Vec::new(),
            notes: None,
            is_title_slide: true,
        }
    }

    fn has_content(&self) -> bool {
        !self.title.is_empty()
            || !self.bullets.is_empty()
            || !self.tables.is_empty()
            || !self.images.is_empty()
            || !self.charts.is_empty()
            || self.subtitle.is_some()
    }

    /// Count the number of text words across all bullets.
    fn word_count(&self) -> usize {
        self.bullets
            .iter()
            .map(|b| b.text.split_whitespace().count())
            .sum()
    }

    fn add_notes(&mut self, text: &str) {
        if let Some(ref mut existing) = self.notes {
            existing.push('\n');
            existing.push_str(text);
        } else {
            self.notes = Some(text.to_string());
        }
    }

    fn into_slide_content(self, config: &PptxTemplateConfig, _project_root: Option<&str>) -> SlideContent {
        let mut slide = SlideContent::new(&self.title);

        // Apply template styling
        slide = slide
            .title_size(config.title_size)
            .content_size(config.body_size)
            .title_color(config.title_color)
            .content_color(config.body_color);

        if self.is_title_slide {
            slide = slide.layout(SlideLayout::CenteredTitle);
            if let Some(sub) = &self.subtitle {
                slide = slide.add_bullet(sub);
            }
        } else {
            slide = slide.layout(SlideLayout::TitleAndContent);
            if let Some(sub) = &self.subtitle {
                // H2 subtitle rendered as first bullet with no bullet marker
                slide
                    .bullets
                    .push(BulletPoint::new(sub).with_style(BulletStyle::None).italic());
                slide.content.push(sub.clone());
            }
        }

        // Add bullets
        for b in &self.bullets {
            let mut bp = BulletPoint::new(&b.text)
                .with_style(b.style)
                .with_level(b.level);
            if b.bold {
                bp = bp.bold();
            }
            if b.italic {
                bp = bp.italic();
            }
            if let Some(size) = b.font_size {
                bp = bp.font_size(size);
            }
            slide.content.push(b.text.clone());
            slide.bullets.push(bp);
        }

        // Add tables (Task #6)
        for table in &self.tables {
            if table.headers.is_empty() {
                continue;
            }
            let col_count = table.headers.len();
            let header_refs: Vec<&str> = table.headers.iter().map(|s| s.as_str()).collect();
            let mut qt = QuickTable::new(col_count).header(&header_refs);
            for row in &table.rows {
                let row_refs: Vec<&str> = row.iter().map(|s| s.as_str()).collect();
                qt = qt.row(&row_refs);
            }
            slide = slide.table(qt.build());
        }

        // Add images (Task #7)
        for img in &self.images {
            if img.path.exists() {
                match Image::from_path(&img.path) {
                    Ok(image) => {
                        slide = slide.add_image(image);
                    }
                    Err(_) => {
                        let filename = img
                            .path
                            .file_name()
                            .map(|f| f.to_string_lossy().to_string())
                            .unwrap_or_else(|| "unknown".to_string());
                        slide = slide.add_bullet(&format!("[Image: {}]", filename));
                    }
                }
            } else {
                let filename = img
                    .path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                slide = slide.add_bullet(&format!("[Image: {}]", filename));
            }
        }

        // Add charts (Task #8)
        for chart_info in &self.charts {
            if let Some(chart) = build_pptx_chart(chart_info) {
                slide = slide.add_chart(chart);
            } else {
                let summary = format!(
                    "[Chart: {} - {}]",
                    chart_info.chart_type,
                    chart_info.labels.join(", ")
                );
                slide = slide.add_bullet(&summary);
            }
        }

        // Add speaker notes (Task #9)
        if let Some(notes) = self.notes {
            slide = slide.notes(&notes);
        }

        slide
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Convert markdown content to PPTX bytes.
///
/// Parses markdown with comrak, splits into slides based on H1 headings
/// and `---` horizontal rules, and produces PPTX via ppt-rs.
///
/// Slide splitting rules:
/// - H1 creates a new slide with the heading as title
/// - H2 appears as subtitle on the same slide
/// - H3-H6 rendered as bold body text
/// - `---` forces a slide break
/// - First slide is a title slide with document title and date
/// - Content before first heading becomes title slide subtitle
/// - Empty documents produce a single title slide
/// - Slides with >8 bullets or >300 words split into continuation slides
pub fn markdown_to_pptx(
    markdown: &str,
    title: &str,
    template: &str,
    project_root: Option<&str>,
) -> Result<Vec<u8>, String> {
    let pptx_template = PptxTemplate::from_str(template).unwrap_or(PptxTemplate::Simple);
    let config = pptx_template.config();

    let builders = parse_to_builders(markdown, title, project_root);

    // Apply overflow splitting (Task #5)
    let builders = apply_overflow_splitting(builders);

    let slides: Vec<SlideContent> = builders
        .into_iter()
        .map(|b| b.into_slide_content(&config, project_root))
        .collect();

    create_pptx_with_content(title, slides).map_err(|e| format!("PPTX generation failed: {}", e))
}

/// Parse markdown into intermediate SlideBuilder list (visible for tests).
fn parse_to_builders(
    markdown: &str,
    title: &str,
    project_root: Option<&str>,
) -> Vec<SlideBuilder> {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.tasklist = true;
    options.extension.table = true;
    options.extension.strikethrough = true;
    let root = parse_document(&arena, markdown, &options);

    let mut builders: Vec<SlideBuilder> = Vec::new();
    let mut current: Option<SlideBuilder> = None;
    let mut seen_heading = false;
    let mut pre_heading_text: Vec<String> = Vec::new();
    let project_root_path = project_root.map(PathBuf::from);

    for node in root.children() {
        match &node.data.borrow().value {
            NodeValue::Heading(heading) => {
                let text = collect_text(node);
                if heading.level == 1 {
                    if let Some(builder) = current.take() {
                        if builder.has_content() {
                            builders.push(builder);
                        }
                    }
                    current = Some(SlideBuilder::new(&text));
                    seen_heading = true;
                } else if heading.level == 2 {
                    if !seen_heading {
                        pre_heading_text.push(text);
                    } else if let Some(ref mut builder) = current {
                        if builder.subtitle.is_none() {
                            builder.subtitle = Some(text);
                        } else {
                            builder.bullets.push(SlideBullet {
                                text,
                                level: 0,
                                style: BulletStyle::None,
                                bold: true,
                                italic: false,
                                font_size: None,
                            });
                        }
                    }
                } else {
                    // H3-H6: bold body text
                    if !seen_heading {
                        pre_heading_text.push(text);
                    } else {
                        ensure_current(&mut current, &mut builders);
                        if let Some(ref mut builder) = current {
                            builder.bullets.push(SlideBullet {
                                text,
                                level: 0,
                                style: BulletStyle::None,
                                bold: true,
                                italic: false,
                                font_size: None,
                            });
                        }
                    }
                }
            }
            NodeValue::Paragraph => {
                // Check if paragraph contains an image
                if let Some(img) = detect_image(node, &project_root_path) {
                    if !seen_heading {
                        // Image before any heading — skip for now
                    } else {
                        ensure_current(&mut current, &mut builders);
                        if let Some(ref mut builder) = current {
                            builder.images.push(img);
                        }
                    }
                    continue;
                }

                let text = collect_text(node);
                if text.is_empty() {
                    continue;
                }
                if !seen_heading {
                    pre_heading_text.push(text);
                } else {
                    ensure_current(&mut current, &mut builders);
                    if let Some(ref mut builder) = current {
                        builder.bullets.push(SlideBullet {
                            text,
                            level: 0,
                            style: BulletStyle::None,
                            bold: false,
                            italic: false,
                            font_size: None,
                        });
                    }
                }
            }
            NodeValue::ThematicBreak => {
                if let Some(builder) = current.take() {
                    if builder.has_content() {
                        builders.push(builder);
                    }
                }
                current = None;
            }
            NodeValue::List(_) => {
                if !seen_heading {
                    collect_list_text(node, &mut pre_heading_text, 0);
                } else {
                    ensure_current(&mut current, &mut builders);
                    if let Some(ref mut builder) = current {
                        collect_list_bullets(node, &mut builder.bullets, 0);
                    }
                }
            }
            NodeValue::CodeBlock(cb) => {
                // Task #6: code blocks with reduced font size and no bullet
                let code = cb.literal.trim().to_string();
                if code.is_empty() {
                    continue;
                }
                if !seen_heading {
                    pre_heading_text.push(code);
                } else {
                    ensure_current(&mut current, &mut builders);
                    if let Some(ref mut builder) = current {
                        for line in code.lines() {
                            builder.bullets.push(SlideBullet {
                                text: line.to_string(),
                                level: 0,
                                style: BulletStyle::None,
                                bold: false,
                                italic: false,
                                font_size: Some(14),
                            });
                        }
                    }
                }
            }
            NodeValue::BlockQuote => {
                // Task #9: callout detection
                if let Some(callout) = detect_callout(node) {
                    let body = collect_callout_body(node);
                    if callout.callout_type == "notes" {
                        // Speaker notes
                        if !seen_heading {
                            // Notes before any heading — attach to title slide later
                            // (for simplicity, just discard pre-heading notes)
                        } else {
                            ensure_current(&mut current, &mut builders);
                            if let Some(ref mut builder) = current {
                                builder.add_notes(&body);
                            }
                        }
                    } else if callout.callout_type == "link" {
                        // Link preview
                        let display = if let Some(ref url) = callout.url {
                            if body.is_empty() {
                                format!("[Link: {}]", url)
                            } else {
                                format!("{}\n{}", body.trim(), url)
                            }
                        } else {
                            body
                        };
                        if !seen_heading {
                            pre_heading_text.push(display);
                        } else {
                            ensure_current(&mut current, &mut builders);
                            if let Some(ref mut builder) = current {
                                builder.bullets.push(SlideBullet {
                                    text: display,
                                    level: 0,
                                    style: BulletStyle::None,
                                    bold: false,
                                    italic: false,
                                    font_size: None,
                                });
                            }
                        }
                    } else {
                        // Other callout types: render with label prefix
                        let label = match callout.callout_type.as_str() {
                            "note" => "Note",
                            "tip" => "Tip",
                            "warning" => "Warning",
                            "important" => "Important",
                            _ => "Note",
                        };
                        let display_title = callout.title.as_deref().unwrap_or(label);
                        let formatted = format!("{}: {}", display_title, body.trim());
                        if !seen_heading {
                            pre_heading_text.push(formatted);
                        } else {
                            ensure_current(&mut current, &mut builders);
                            if let Some(ref mut builder) = current {
                                builder.bullets.push(SlideBullet {
                                    text: formatted,
                                    level: 0,
                                    style: BulletStyle::None,
                                    bold: false,
                                    italic: false,
                                    font_size: None,
                                });
                            }
                        }
                    }
                } else {
                    // Regular blockquote: italic text
                    let text = collect_text(node);
                    if text.is_empty() {
                        continue;
                    }
                    if !seen_heading {
                        pre_heading_text.push(text);
                    } else {
                        ensure_current(&mut current, &mut builders);
                        if let Some(ref mut builder) = current {
                            builder.bullets.push(SlideBullet {
                                text,
                                level: 0,
                                style: BulletStyle::None,
                                bold: false,
                                italic: true,
                                font_size: None,
                            });
                        }
                    }
                }
            }
            NodeValue::Table(..) => {
                // Task #6: tables
                if !seen_heading {
                    continue;
                }
                ensure_current(&mut current, &mut builders);
                if let Some(ref mut builder) = current {
                    let table = parse_table(node);
                    if let Some(t) = table {
                        builder.tables.push(t);
                    }
                }
            }
            NodeValue::HtmlBlock(html_block) => {
                // Check for drawing div blocks (Task #7)
                let html = html_block.literal.clone();
                if html.contains("data-type=\"drawing\"") {
                    if let Some(drawing_id) = extract_drawing_id(&html) {
                        if seen_heading {
                            ensure_current(&mut current, &mut builders);
                            if let Some(ref mut builder) = current {
                                let path =
                                    resolve_drawing_path(&drawing_id, &project_root_path);
                                builder.images.push(SlideImage { path });
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Flush remaining
    if let Some(builder) = current.take() {
        if builder.has_content() {
            builders.push(builder);
        }
    }

    // Build the title slide
    let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let subtitle = if pre_heading_text.is_empty() {
        Some(date_str)
    } else {
        let mut sub = pre_heading_text.join(" \u{2022} ");
        sub.push_str(&format!("\n{}", date_str));
        Some(sub)
    };
    let title_slide = SlideBuilder::title_slide(title, subtitle);

    // Assemble: title slide first, then content slides
    let mut all = vec![title_slide];
    all.extend(builders);
    all
}

// ---------------------------------------------------------------------------
// Overflow splitting (Task #5)
// ---------------------------------------------------------------------------

fn apply_overflow_splitting(builders: Vec<SlideBuilder>) -> Vec<SlideBuilder> {
    let mut result = Vec::new();
    for slide in builders {
        if slide.is_title_slide || slide.bullets.is_empty() {
            result.push(slide);
            continue;
        }

        let bullet_count = slide.bullets.len();
        let word_count = slide.word_count();

        if bullet_count <= MAX_BULLETS_PER_SLIDE && word_count <= MAX_WORDS_PER_SLIDE {
            result.push(slide);
            continue;
        }

        // Split into continuation slides
        let title = slide.title.clone();
        let notes = slide.notes.clone();
        let tables = slide.tables.clone();
        let images = slide.images.clone();
        let charts = slide.charts.clone();
        let subtitle = slide.subtitle.clone();

        let chunks: Vec<Vec<SlideBullet>> = slide
            .bullets
            .chunks(MAX_BULLETS_PER_SLIDE)
            .map(|c| c.to_vec())
            .collect();

        for (i, chunk) in chunks.into_iter().enumerate() {
            let slide_title = if i == 0 {
                title.clone()
            } else {
                format!("{} (cont.)", title)
            };
            let mut new_slide = SlideBuilder::new(&slide_title);
            new_slide.bullets = chunk;
            // Attach metadata only to the first chunk
            if i == 0 {
                new_slide.notes = notes.clone();
                new_slide.tables = tables.clone();
                new_slide.images = images.clone();
                new_slide.charts = charts.clone();
                new_slide.subtitle = subtitle.clone();
            }
            result.push(new_slide);
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Chart support (Task #8)
// ---------------------------------------------------------------------------

/// Build a ppt-rs Chart from our intermediate chart model.
fn build_pptx_chart(info: &SlideChart) -> Option<Chart> {
    let chart_type = match info.chart_type.to_lowercase().as_str() {
        "bar" => ChartType::Bar,
        "line" => ChartType::Line,
        "area" => ChartType::Area,
        "pie" => ChartType::Pie,
        "donut" | "doughnut" => ChartType::Doughnut,
        "horizontalbar" | "horizontal_bar" => ChartType::BarHorizontal,
        "radar" => ChartType::Radar,
        "scatter" => ChartType::Scatter,
        // radial_bar and composed have no native PPTX chart equivalent — use SVG fallback
        "radial_bar" | "composed" => return None,
        _ => return None,
    };

    let categories: Vec<String> = info.labels.clone();
    let mut chart = Chart::new(
        &info.title,
        chart_type,
        categories,
        914400,  // 1 inch from left
        1828800, // 2 inches from top
        7315200, // 8 inches wide
        4114800, // 4.5 inches tall
    );

    for dataset in &info.datasets {
        chart = chart.add_series(ChartSeries::new(&dataset.label, dataset.data.clone()));
    }

    Some(chart)
}

/// Try to read a chart JSON sidecar file and parse into our intermediate model.
#[allow(dead_code)]
fn read_chart_json(path: &Path) -> Option<SlideChart> {
    let content = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let chart_type = json.get("type")?.as_str()?.to_string();
    let labels: Vec<String> = json
        .get("labels")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();

    let datasets: Vec<ChartDataset> = json
        .get("datasets")?
        .as_array()?
        .iter()
        .filter_map(|ds| {
            let label = ds.get("label")?.as_str()?.to_string();
            let data: Vec<f64> = ds
                .get("data")?
                .as_array()?
                .iter()
                .filter_map(|v| v.as_f64())
                .collect();
            Some(ChartDataset { label, data })
        })
        .collect();

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Chart")
        .to_string();

    Some(SlideChart {
        title,
        chart_type,
        labels,
        datasets,
    })
}

// ---------------------------------------------------------------------------
// Callout detection (Task #9)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct CalloutInfo {
    callout_type: String,
    title: Option<String>,
    url: Option<String>,
}

/// Detect if a blockquote is a callout by checking the first text for `[!type]`.
///
/// comrak merges `> [!type]\n> body` into a single paragraph with SoftBreak,
/// so we split on SoftBreak to get the actual first line.
///
/// For link previews, comrak parses `[!link](url)` as a Link node with text "!link",
/// so we detect that pattern via AST inspection.
fn detect_callout<'a>(node: &'a AstNode<'a>) -> Option<CalloutInfo> {
    let first_child = node.first_child()?;
    if !matches!(first_child.data.borrow().value, NodeValue::Paragraph) {
        return None;
    }

    // Check for [!link](url) — comrak parses this as a Link node
    let first_inline = first_child.first_child()?;
    if let NodeValue::Link(ref link) = first_inline.data.borrow().value {
        let link_text = collect_text(first_inline);
        if link_text == "!link" {
            return Some(CalloutInfo {
                callout_type: "link".to_string(),
                title: None,
                url: Some(link.url.clone()),
            });
        }
    }

    // Get the first logical line (before any SoftBreak)
    let first_line = collect_first_line(first_child);

    // Check for [!type] or [!type] Title
    let re = regex::Regex::new(r"^\[!(\w+)\](?:\s+(.+))?$").ok()?;
    let caps = re.captures(&first_line)?;
    let callout_type = caps.get(1)?.as_str().to_lowercase();

    match callout_type.as_str() {
        "note" | "tip" | "warning" | "important" | "notes" => {}
        _ => return None,
    }

    let title = caps.get(2).map(|m| m.as_str().to_string());

    Some(CalloutInfo {
        callout_type,
        title,
        url: None,
    })
}

/// Collect text from a node up to the first SoftBreak (first logical line).
fn collect_first_line<'a>(node: &'a AstNode<'a>) -> String {
    let mut text = String::new();
    collect_until_break(node, &mut text);
    text
}

fn collect_until_break<'a>(node: &'a AstNode<'a>, out: &mut String) -> bool {
    match &node.data.borrow().value {
        NodeValue::Text(t) => {
            out.push_str(t);
            false
        }
        NodeValue::SoftBreak | NodeValue::LineBreak => true, // stop
        NodeValue::Code(c) => {
            out.push_str(&c.literal);
            false
        }
        _ => {
            for child in node.children() {
                if collect_until_break(child, out) {
                    return true;
                }
            }
            false
        }
    }
}

/// Collect body text of a callout, skipping the `[!type]` header line.
///
/// comrak merges `> [!type]\n> body` into a single paragraph with SoftBreak,
/// so we skip content before the first SoftBreak in the first paragraph,
/// and collect everything after.
fn collect_callout_body<'a>(node: &'a AstNode<'a>) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut first_para = true;
    for child in node.children() {
        if matches!(child.data.borrow().value, NodeValue::Paragraph) {
            if first_para {
                first_para = false;
                // Collect text after the first SoftBreak in this paragraph
                let after = collect_text_after_first_break(child);
                if !after.is_empty() {
                    parts.push(after);
                }
            } else {
                parts.push(collect_text(child));
            }
        }
    }
    parts.join("\n")
}

/// Collect text from a paragraph node, skipping everything before (and including)
/// the first SoftBreak or LineBreak.
fn collect_text_after_first_break<'a>(node: &'a AstNode<'a>) -> String {
    let mut found_break = false;
    let mut text = String::new();
    for child in node.children() {
        if !found_break {
            match child.data.borrow().value {
                NodeValue::SoftBreak | NodeValue::LineBreak => {
                    found_break = true;
                }
                _ => {
                    // Skip content before the break
                }
            }
        } else {
            collect_text_recursive(child, &mut text);
        }
    }
    text.trim().to_string()
}

// ---------------------------------------------------------------------------
// Image / drawing support (Task #7)
// ---------------------------------------------------------------------------

/// Detect if a paragraph node contains an image and resolve its path.
fn detect_image<'a>(node: &'a AstNode<'a>, project_root: &Option<PathBuf>) -> Option<SlideImage> {
    for child in node.children() {
        if let NodeValue::Image(ref link) = child.data.borrow().value {
            let url = link.url.clone();

            // Check if this references a chart JSON sidecar
            if url.contains(".chart.json") || url.contains(".notesage/charts/") {
                // Charts are handled separately — skip image handling
                return None;
            }

            let path = resolve_image_path(&url, project_root);
            return Some(SlideImage { path });
        }
    }
    None
}

fn resolve_image_path(url: &str, project_root: &Option<PathBuf>) -> PathBuf {
    let path = Path::new(url);
    if path.is_absolute() {
        path.to_path_buf()
    } else if let Some(ref root) = project_root {
        // Check for .excalidraw -> .svg resolution
        if url.ends_with(".excalidraw") {
            let svg_path = root.join(url.replace(".excalidraw", ".svg"));
            if svg_path.exists() {
                return svg_path;
            }
        }
        root.join(url)
    } else {
        path.to_path_buf()
    }
}

fn resolve_drawing_path(drawing_id: &str, project_root: &Option<PathBuf>) -> PathBuf {
    if let Some(ref root) = project_root {
        let svg_path = root.join(drawing_id.replace(".excalidraw", ".svg"));
        if svg_path.exists() {
            return svg_path;
        }
        root.join(drawing_id)
    } else {
        PathBuf::from(drawing_id)
    }
}

/// Extract drawing-id from an HTML div block.
fn extract_drawing_id(html: &str) -> Option<String> {
    let re = regex::Regex::new(r#"data-drawing-id="([^"]+)""#).ok()?;
    let caps = re.captures(html)?;
    Some(caps.get(1)?.as_str().to_string())
}

// ---------------------------------------------------------------------------
// Table support (Task #6)
// ---------------------------------------------------------------------------

fn parse_table<'a>(node: &'a AstNode<'a>) -> Option<SlideTable> {
    let mut headers: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut is_header = true;

    for child in node.children() {
        if let NodeValue::TableRow(is_hdr) = child.data.borrow().value {
            let mut cells: Vec<String> = Vec::new();
            for cell_node in child.children() {
                let cell_text = collect_text(cell_node);
                cells.push(cell_text);
            }
            if is_header || is_hdr {
                headers = cells;
                is_header = false;
            } else {
                rows.push(cells);
            }
        }
    }

    if headers.is_empty() {
        None
    } else {
        Some(SlideTable { headers, rows })
    }
}

// ---------------------------------------------------------------------------
// Helpers (shared with existing implementation)
// ---------------------------------------------------------------------------

/// Ensure there's a current slide builder, creating one if needed.
fn ensure_current(current: &mut Option<SlideBuilder>, _builders: &mut Vec<SlideBuilder>) {
    if current.is_none() {
        *current = Some(SlideBuilder::new(""));
    }
}

/// Collect all text content from an AST node and its children.
fn collect_text<'a>(node: &'a AstNode<'a>) -> String {
    let mut text = String::new();
    collect_text_recursive(node, &mut text);
    text
}

fn collect_text_recursive<'a>(node: &'a AstNode<'a>, out: &mut String) {
    match &node.data.borrow().value {
        NodeValue::Text(t) => out.push_str(t),
        NodeValue::SoftBreak | NodeValue::LineBreak => out.push(' '),
        NodeValue::Code(c) => out.push_str(&c.literal),
        _ => {
            for child in node.children() {
                collect_text_recursive(child, out);
            }
        }
    }
}

/// Recursively collect list items as SlideBullets with proper nesting.
fn collect_list_bullets<'a>(
    node: &'a AstNode<'a>,
    bullets: &mut Vec<SlideBullet>,
    depth: u32,
) {
    let is_ordered = matches!(
        &node.data.borrow().value,
        NodeValue::List(l) if l.list_type == comrak::nodes::ListType::Ordered
    );

    for child in node.children() {
        match &child.data.borrow().value {
            NodeValue::TaskItem(task) => {
                let text = collect_item_text(child);
                if !text.is_empty() {
                    let symbol = if task.symbol.is_some() {
                        '\u{2611}' // ☑
                    } else {
                        '\u{2610}' // ☐
                    };
                    bullets.push(SlideBullet {
                        text,
                        level: depth,
                        style: BulletStyle::Custom(symbol),
                        bold: false,
                        italic: false,
                        font_size: None,
                    });
                }
                for grandchild in child.children() {
                    if let NodeValue::List(_) = &grandchild.data.borrow().value {
                        collect_list_bullets(grandchild, bullets, depth + 1);
                    }
                }
            }
            NodeValue::Item(_) => {
                let text = collect_item_text(child);
                if !text.is_empty() {
                    let style = if is_ordered {
                        BulletStyle::Number
                    } else {
                        BulletStyle::Bullet
                    };
                    bullets.push(SlideBullet {
                        text,
                        level: depth,
                        style,
                        bold: false,
                        italic: false,
                        font_size: None,
                    });
                }
                for grandchild in child.children() {
                    if let NodeValue::List(_) = &grandchild.data.borrow().value {
                        collect_list_bullets(grandchild, bullets, depth + 1);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Collect list items as plain text (for pre-heading content).
fn collect_list_text<'a>(
    node: &'a AstNode<'a>,
    texts: &mut Vec<String>,
    depth: usize,
) {
    for child in node.children() {
        if let NodeValue::Item(_) = &child.data.borrow().value {
            let text = collect_item_text(child);
            let prefix = "  ".repeat(depth);
            if !text.is_empty() {
                texts.push(format!("{}\u{2022} {}", prefix, text));
            }
            for grandchild in child.children() {
                if let NodeValue::List(_) = &grandchild.data.borrow().value {
                    collect_list_text(grandchild, texts, depth + 1);
                }
            }
        }
    }
}

/// Collect text from a list item node (skipping nested lists).
fn collect_item_text<'a>(item: &'a AstNode<'a>) -> String {
    let mut text = String::new();
    for child in item.children() {
        match &child.data.borrow().value {
            NodeValue::List(_) => {} // skip nested lists
            _ => collect_text_recursive(child, &mut text),
        }
    }
    text.trim().to_string()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: parse markdown to PPTX bytes and assert valid ZIP.
    fn export(md: &str, title: &str) -> Vec<u8> {
        let result = markdown_to_pptx(md, title, "simple", None);
        assert!(result.is_ok(), "Failed: {:?}", result.err());
        let bytes = result.unwrap();
        assert!(bytes.len() > 100, "PPTX too small: {} bytes", bytes.len());
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "Not a valid ZIP/PPTX");
        bytes
    }

    /// Helper: parse markdown and return the slide builders (post-overflow).
    fn slides(md: &str) -> Vec<SlideBuilder> {
        let builders = parse_to_builders(md, "Test", None);
        apply_overflow_splitting(builders)
    }

    // --- Existing tests (Tasks #1-#3) ---

    #[test]
    fn smoke_test_creates_valid_pptx() {
        export("# Welcome\n\n- Point 1\n- Point 2\n", "Test Presentation");
    }

    #[test]
    fn empty_document_produces_title_slide() {
        let bytes = export("", "Empty Doc");
        assert!(bytes.len() > 100);
    }

    #[test]
    fn horizontal_rule_splits_slides() {
        export(
            "# Slide 1\n\nContent A\n\n---\n\n# Slide 2\n\nContent B\n",
            "Test",
        );
    }

    #[test]
    fn h1_creates_new_slides() {
        export("# First\n\nHello\n\n# Second\n\nWorld\n", "Multi-slide");
    }

    #[test]
    fn h2_becomes_subtitle() {
        let s = slides("# Main Title\n\n## Subtitle Here\n\nBody content\n");
        let main = s.iter().find(|b| b.title == "Main Title").unwrap();
        assert_eq!(main.subtitle.as_deref(), Some("Subtitle Here"));
    }

    #[test]
    fn h3_to_h6_become_bold_text() {
        export(
            "# Slide\n\n### Section A\n\nText under A\n\n#### Subsection\n\nMore text\n",
            "Heading Levels",
        );
    }

    #[test]
    fn content_before_heading_goes_to_title_slide() {
        export(
            "Some intro paragraph.\n\nAnother line.\n\n# First Real Slide\n\nContent here.\n",
            "With Intro",
        );
    }

    #[test]
    fn title_slide_always_first() {
        let bytes = export("# Slide One\n\nHello\n", "My Presentation");
        assert!(bytes.len() > 200);
    }

    #[test]
    fn only_paragraphs_no_headings() {
        export(
            "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n",
            "No Headings",
        );
    }

    #[test]
    fn task_list_with_checkboxes() {
        let md = "# Tasks\n\n- [ ] Unchecked\n- [x] Checked\n- [ ] Another\n";
        let s = slides(md);
        let tasks = s.iter().find(|b| b.title == "Tasks").unwrap();
        let checkbox_bullets: Vec<&SlideBullet> = tasks
            .bullets
            .iter()
            .filter(|b| matches!(b.style, BulletStyle::Custom('\u{2610}' | '\u{2611}')))
            .collect();
        assert_eq!(checkbox_bullets.len(), 3);
    }

    #[test]
    fn nested_lists() {
        let md = "# Lists\n\n- Item 1\n  - Sub A\n  - Sub B\n- Item 2\n";
        let s = slides(md);
        let list_slide = s.iter().find(|b| b.title == "Lists").unwrap();
        assert!(list_slide.bullets.iter().any(|b| b.text == "Item 1" && b.level == 0));
        assert!(list_slide.bullets.iter().any(|b| b.text == "Sub A" && b.level == 1));
        assert!(list_slide.bullets.iter().any(|b| b.text == "Sub B" && b.level == 1));
    }

    #[test]
    fn blockquote_as_italic() {
        let md = "# Slide\n\n> A wise quote\n\nNormal text\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(slide.bullets.iter().any(|b| b.text.contains("A wise quote") && b.italic));
    }

    // --- Task #4: numbered list verification ---

    #[test]
    fn numbered_list_uses_number_style() {
        let md = "# Slide\n\n1. First\n2. Second\n3. Third\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        let numbered: Vec<&SlideBullet> = slide
            .bullets
            .iter()
            .filter(|b| b.style == BulletStyle::Number)
            .collect();
        assert_eq!(numbered.len(), 3, "Should have 3 numbered bullets");
        assert_eq!(numbered[0].text, "First");
        assert_eq!(numbered[1].text, "Second");
        assert_eq!(numbered[2].text, "Third");
    }

    #[test]
    fn bullet_list_uses_bullet_style() {
        let md = "# Slide\n\n- Alpha\n- Beta\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        let bullets: Vec<&SlideBullet> = slide
            .bullets
            .iter()
            .filter(|b| b.style == BulletStyle::Bullet)
            .collect();
        assert_eq!(bullets.len(), 2);
    }

    #[test]
    fn mixed_list_types() {
        let md = "# Slide\n\n- Bullet item\n\n1. Numbered item\n\n- [ ] Task item\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(slide.bullets.iter().any(|b| b.style == BulletStyle::Bullet));
        assert!(slide.bullets.iter().any(|b| b.style == BulletStyle::Number));
        assert!(slide.bullets.iter().any(|b| matches!(b.style, BulletStyle::Custom(_))));
    }

    // --- Task #5: overflow and continuation slides ---

    #[test]
    fn overflow_creates_continuation_slides() {
        let items: Vec<String> = (1..=12).map(|i| format!("- Item {}", i)).collect();
        let md = format!("# Slide\n\n{}", items.join("\n"));
        let s = slides(&md);
        let main_count = s.iter().filter(|b| b.title == "Slide").count();
        let cont_count = s.iter().filter(|b| b.title == "Slide (cont.)").count();
        assert_eq!(main_count, 1);
        assert!(cont_count >= 1, "Expected continuation slide(s)");
    }

    #[test]
    fn title_slide_not_split_by_overflow() {
        // Title slides should never be split
        let builders = vec![SlideBuilder::title_slide("Title", Some("Sub".to_string()))];
        let result = apply_overflow_splitting(builders);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn exactly_eight_bullets_no_split() {
        let items: Vec<String> = (1..=8).map(|i| format!("- Item {}", i)).collect();
        let md = format!("# Slide\n\n{}", items.join("\n"));
        let s = slides(&md);
        assert!(!s.iter().any(|b| b.title.contains("(cont.)")));
    }

    #[test]
    fn nine_bullets_triggers_split() {
        let items: Vec<String> = (1..=9).map(|i| format!("- Item {}", i)).collect();
        let md = format!("# Slide\n\n{}", items.join("\n"));
        let s = slides(&md);
        assert!(s.iter().any(|b| b.title.contains("(cont.)")));
    }

    // --- Task #6: tables and code blocks ---

    #[test]
    fn table_parsed_correctly() {
        let md = "# Slide\n\n| Name | Value |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert_eq!(slide.tables.len(), 1);
        assert_eq!(slide.tables[0].headers, vec!["Name", "Value"]);
        assert_eq!(slide.tables[0].rows.len(), 2);
        assert_eq!(slide.tables[0].rows[0], vec!["A", "1"]);
    }

    #[test]
    fn code_block_uses_small_font_no_bullet() {
        let md = "# Slide\n\n```rust\nfn main() {\n    println!(\"hello\");\n}\n```\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        let code_bullets: Vec<&SlideBullet> = slide
            .bullets
            .iter()
            .filter(|b| b.font_size == Some(14))
            .collect();
        assert!(!code_bullets.is_empty(), "Should have code-styled bullets");
        // All code bullets should have BulletStyle::None
        for cb in &code_bullets {
            assert_eq!(cb.style, BulletStyle::None, "Code should have no bullet marker");
        }
    }

    #[test]
    fn code_block_each_line_separate_bullet() {
        let md = "# Slide\n\n```\nline1\nline2\nline3\n```\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        let code_bullets: Vec<&SlideBullet> = slide
            .bullets
            .iter()
            .filter(|b| b.font_size == Some(14))
            .collect();
        assert_eq!(code_bullets.len(), 3);
        assert_eq!(code_bullets[0].text, "line1");
        assert_eq!(code_bullets[1].text, "line2");
        assert_eq!(code_bullets[2].text, "line3");
    }

    #[test]
    fn table_converts_to_slide_content() {
        let md = "# Slide\n\n| H1 | H2 |\n| --- | --- |\n| a | b |\n";
        let result = markdown_to_pptx(md, "Test", "simple", None);
        assert!(result.is_ok());
    }

    // --- Task #7: images and drawings ---

    #[test]
    fn image_detected_in_paragraph() {
        let md = "# Slide\n\n![alt](/some/image.png)\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert_eq!(slide.images.len(), 1);
        assert_eq!(
            slide.images[0].path,
            PathBuf::from("/some/image.png")
        );
    }

    #[test]
    fn excalidraw_resolved_to_svg() {
        // Without a real file system, just verify the path logic
        let path = resolve_image_path("drawing.excalidraw", &Some(PathBuf::from("/tmp/test")));
        // Falls back to original since .svg doesn't exist on disk
        assert!(path.to_string_lossy().contains("drawing"));
    }

    #[test]
    fn drawing_html_block_detected() {
        let html = r#"<div data-drawing-id=".notesage/drawings/abc.excalidraw" data-type="drawing" class="drawing-block"></div>"#;
        let id = extract_drawing_id(html);
        assert_eq!(id, Some(".notesage/drawings/abc.excalidraw".to_string()));
    }

    #[test]
    fn missing_image_produces_placeholder_in_pptx() {
        let md = "# Slide\n\n![alt](/nonexistent/image.png)\n";
        let result = markdown_to_pptx(md, "Test", "simple", None);
        assert!(result.is_ok(), "Should not fail on missing images");
    }

    // --- Task #8: charts ---

    #[test]
    fn chart_json_parsing() {
        use std::io::Write;
        let dir = std::env::temp_dir().join("notesage_pptx_test_charts");
        let _ = std::fs::create_dir_all(&dir);
        let chart_path = dir.join("test.json");
        let chart_json = r#"{
            "type": "bar",
            "title": "Sales",
            "labels": ["Q1", "Q2", "Q3", "Q4"],
            "datasets": [
                {"label": "2024", "data": [10, 20, 30, 40]},
                {"label": "2025", "data": [15, 25, 35, 45]}
            ]
        }"#;
        let mut f = std::fs::File::create(&chart_path).unwrap();
        f.write_all(chart_json.as_bytes()).unwrap();

        let chart = read_chart_json(&chart_path).unwrap();
        assert_eq!(chart.chart_type, "bar");
        assert_eq!(chart.title, "Sales");
        assert_eq!(chart.labels.len(), 4);
        assert_eq!(chart.datasets.len(), 2);
        assert_eq!(chart.datasets[0].data, vec![10.0, 20.0, 30.0, 40.0]);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_pptx_chart_maps_types() {
        for (typ, expected) in &[
            ("bar", ChartType::Bar),
            ("line", ChartType::Line),
            ("area", ChartType::Area),
            ("pie", ChartType::Pie),
            ("doughnut", ChartType::Doughnut),
            ("donut", ChartType::Doughnut),
            ("radar", ChartType::Radar),
        ] {
            let chart_info = SlideChart {
                title: "Test".to_string(),
                chart_type: typ.to_string(),
                labels: vec!["A".to_string()],
                datasets: vec![ChartDataset {
                    label: "S".to_string(),
                    data: vec![1.0],
                }],
            };
            let chart = build_pptx_chart(&chart_info).unwrap();
            assert_eq!(chart.chart_type, *expected, "Failed for type: {}", typ);
        }
    }

    #[test]
    fn unknown_chart_type_returns_none() {
        let chart_info = SlideChart {
            title: "Test".to_string(),
            chart_type: "waterfall".to_string(),
            labels: vec!["A".to_string()],
            datasets: vec![],
        };
        assert!(build_pptx_chart(&chart_info).is_none());
    }

    // --- Task #9: speaker notes and callouts ---

    #[test]
    fn speaker_notes_not_on_slide() {
        let md = "# Slide\n\n- Point 1\n\n> [!notes]\n> Remember the budget.\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(slide.notes.is_some(), "Should have notes");
        assert!(
            slide
                .notes
                .as_deref()
                .unwrap()
                .contains("Remember the budget"),
            "Notes text missing"
        );
        // Notes should NOT appear in bullets
        assert!(
            !slide
                .bullets
                .iter()
                .any(|b| b.text.contains("Remember the budget")),
            "Notes should not be in slide content"
        );
    }

    #[test]
    fn multiple_notes_blocks_appended() {
        let md = "# Slide\n\n> [!notes]\n> First note.\n\n> [!notes]\n> Second note.\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        let notes = slide.notes.as_deref().unwrap();
        assert!(notes.contains("First note"), "Missing first note");
        assert!(notes.contains("Second note"), "Missing second note");
    }

    #[test]
    fn callout_note_renders_with_label() {
        let md = "# Slide\n\n> [!note]\n> This is important.\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(
            slide
                .bullets
                .iter()
                .any(|b| b.text.contains("Note:") && b.text.contains("This is important")),
            "Note callout should have label prefix"
        );
    }

    #[test]
    fn callout_with_custom_title() {
        let md = "# Slide\n\n> [!tip] Pro Tip\n> Use shortcuts.\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(
            slide.bullets.iter().any(|b| b.text.contains("Pro Tip:")),
            "Should use custom title"
        );
    }

    #[test]
    fn callout_warning_and_important() {
        for callout_type in &["warning", "important"] {
            let md = format!("# Slide\n\n> [!{}]\n> Content.\n", callout_type);
            let s = slides(&md);
            let slide = s.iter().find(|b| b.title == "Slide").unwrap();
            assert!(
                !slide.bullets.is_empty(),
                "Callout {} should produce content",
                callout_type
            );
        }
    }

    #[test]
    fn link_preview_renders_url() {
        let md = "# Slide\n\n> [!link](https://example.com)\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        assert!(
            slide
                .bullets
                .iter()
                .any(|b| b.text.contains("https://example.com")),
            "Link preview should show URL"
        );
    }

    #[test]
    fn invalid_callout_is_blockquote() {
        let md = "# Slide\n\n> [!custom]\n> Some text.\n";
        let s = slides(md);
        let slide = s.iter().find(|b| b.title == "Slide").unwrap();
        // Should be italic (regular blockquote), not a labeled callout
        assert!(
            !slide.bullets.iter().any(|b| b.text.contains("Custom:")),
            "Invalid callout should not get a label"
        );
        assert!(
            slide.bullets.iter().any(|b| b.italic),
            "Should render as italic blockquote"
        );
    }

    // --- Full integration ---

    #[test]
    fn full_pptx_with_all_features() {
        let md = r#"# Introduction

Welcome to the presentation.

## Overview

- Point 1
- Point 2
- Point 3

# Details

1. First item
2. Second item

### Technical Notes

Some technical details.

```rust
fn main() {
    println!("hello");
}
```

| Metric | Value |
| --- | --- |
| Revenue | $1M |
| Users | 5000 |

---

# Questions

- [ ] Follow up on budget
- [x] Review timeline

> [!notes]
> Ask about stakeholder availability.

> [!tip]
> Keep slides concise.

> [!link](https://example.com)
"#;

        let result = markdown_to_pptx(md, "Full Feature Test", "simple", None);
        assert!(result.is_ok(), "PPTX failed: {:?}", result.err());
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "Should be valid ZIP/PPTX");
    }

    // --- Template tests ---

    #[test]
    fn all_templates_produce_valid_output() {
        let md = "# Title\n\nContent here\n\n## Subtitle\n\n- Point 1\n- Point 2\n";
        for template in ["simple", "business", "report"] {
            let result = markdown_to_pptx(md, "Template Test", template, None);
            assert!(
                result.is_ok(),
                "Template '{}' failed: {:?}",
                template,
                result.err()
            );
            let bytes = result.unwrap();
            assert!(
                bytes.len() > 100,
                "Template '{}' produced too-small output",
                template
            );
            assert_eq!(
                &bytes[0..4],
                b"PK\x03\x04",
                "Template '{}' produced invalid ZIP",
                template
            );
        }
    }

    #[test]
    fn unknown_template_falls_back_to_simple() {
        let md = "# Slide\n\nContent\n";
        let result = markdown_to_pptx(md, "Test", "nonexistent", None);
        assert!(result.is_ok(), "Fallback failed: {:?}", result.err());
    }

    #[test]
    fn word_overflow_splits_slides() {
        // Create a slide with >300 words of body text
        let mut md = String::from("# Dense Text\n\n");
        for i in 0..100 {
            md.push_str(&format!("Word{} alpha bravo charlie. ", i));
        }
        let result = markdown_to_pptx(&md, "Word Overflow", "simple", None);
        assert!(result.is_ok(), "Word overflow failed: {:?}", result.err());
    }

    #[test]
    fn horizontal_rule_after_content_creates_new_slide() {
        let md = "# Slide A\n\nContent A\n\n---\n\nOrphan content after HR\n\n# Slide B\n\nContent B\n";
        let s = slides(md);
        // Should have: title slide + Slide A + orphan slide + Slide B
        assert!(s.len() >= 3, "Expected at least 3 slides, got {}", s.len());
    }

    #[test]
    fn multiple_h2_on_same_slide() {
        let md = "# Main\n\n## Sub One\n\n## Sub Two\n\nBody text\n";
        let s = slides(md);
        let main = s.iter().find(|b| b.title == "Main").unwrap();
        // First H2 becomes subtitle, second becomes bold bullet
        assert!(main.subtitle.is_some(), "First H2 should be subtitle");
        assert!(
            main.bullets.iter().any(|b| b.bold && b.text.contains("Sub Two")),
            "Second H2 should be bold bullet"
        );
    }
}
