//! Markdown to DOCX converter.
//!
//! Parses markdown via comrak into a `docx-rs` document model for OOXML generation.
//!
//! Task #3: basic content — headings, paragraphs, inline formatting, links, HR, frontmatter.
//! Task #4: lists, blockquotes, callouts, code blocks.
//! Task #5: tables, images, drawings, link previews.
//! Task #6: template styling, TOC, page numbers, page size, headers/footers.

use comrak::nodes::{
    ListType, NodeCode, NodeHeading, NodeLink, NodeList, NodeValue, TableAlignment,
};
use comrak::{parse_document, Arena, Options};
use docx_rs::*;

use super::table_utils::*;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Options for DOCX export.
pub struct DocxOptions {
    pub include_toc: bool,
    pub include_page_numbers: bool,
    pub page_size: String,
    pub project_root: Option<String>,
}

/// Convert a markdown string to DOCX bytes.
pub fn markdown_to_docx(
    markdown: &str,
    title: &str,
    template: &str,
    options: &DocxOptions,
    typography: Option<&super::typography::TypographyPresets>,
    page_settings: Option<&super::page_settings::DocumentPageSettings>,
    embedded_svgs: Option<&[String]>,
) -> Result<Vec<u8>, String> {
    let mut opts = Options::default();
    opts.extension.table = true;
    opts.extension.tasklist = true;
    opts.extension.strikethrough = true;
    opts.extension.autolink = true;
    opts.extension.front_matter_delimiter = Some("---".to_string());

    let arena = Arena::new();
    let root = parse_document(&arena, markdown, &opts);

    let template_config = match typography {
        Some(presets) => TemplateConfig::from_typography(presets),
        None => TemplateConfig::from_name(template),
    };
    let mut converter = DocxConverter::new(title, &template_config, options, page_settings, embedded_svgs);
    converter.walk(root);
    converter.finish()
}

// ---------------------------------------------------------------------------
// Template configuration
// ---------------------------------------------------------------------------

struct TemplateConfig {
    body_font: String,
    heading_font: String,
    code_font: String,
    body_size: usize,      // half-points (Word size units)
    h1_size: usize,
    h2_size: usize,
    h3_size: usize,
    h4_size: usize,
    h5_size: usize,
    h6_size: usize,
    line_spacing: i32,     // 240 = single, 276 = 1.15, 360 = 1.5
    has_title_page: bool,
    has_header_footer: bool,
}

impl TemplateConfig {
    fn from_name(name: &str) -> Self {
        match name {
            "academic" => Self {
                body_font: "Source Serif 4".to_string(),
                heading_font: "Source Serif 4".to_string(),
                code_font: "JetBrains Mono".to_string(),
                body_size: 24,   // 12pt
                h1_size: 44,     // 22pt
                h2_size: 36,     // 18pt
                h3_size: 30,     // 15pt
                h4_size: 26,     // 13pt
                h5_size: 24,     // 12pt
                h6_size: 22,     // 11pt
                line_spacing: 360, // 1.5
                has_title_page: false,
                has_header_footer: true,
            },
            "report" => Self {
                body_font: "Inter".to_string(),
                heading_font: "Inter".to_string(),
                code_font: "JetBrains Mono".to_string(),
                body_size: 22,   // 11pt
                h1_size: 48,     // 24pt
                h2_size: 40,     // 20pt
                h3_size: 32,     // 16pt
                h4_size: 26,     // 13pt
                h5_size: 24,     // 12pt
                h6_size: 22,     // 11pt
                line_spacing: 276, // 1.15
                has_title_page: true,
                has_header_footer: true,
            },
            _ => Self {
                // "clean" (default)
                body_font: "Inter".to_string(),
                heading_font: "Inter".to_string(),
                code_font: "JetBrains Mono".to_string(),
                body_size: 22,   // 11pt
                h1_size: 48,     // 24pt
                h2_size: 40,     // 20pt
                h3_size: 32,     // 16pt
                h4_size: 26,     // 13pt
                h5_size: 24,     // 12pt
                h6_size: 22,     // 11pt
                line_spacing: 276, // 1.15
                has_title_page: false,
                has_header_footer: false,
            },
        }
    }

    fn heading_size(&self, level: u8) -> usize {
        match level {
            1 => self.h1_size,
            2 => self.h2_size,
            3 => self.h3_size,
            4 => self.h4_size,
            5 => self.h5_size,
            6 => self.h6_size,
            _ => self.body_size,
        }
    }

    /// Build a TemplateConfig from typography presets.
    /// Font sizes are converted from CSS px to Word half-points (1pt = 2 half-points).
    fn from_typography(presets: &super::typography::TypographyPresets) -> Self {
        use super::typography::{resolve_font_family, ExportFormat};

        let body_font = resolve_font_family(&presets.paragraph.font_family, ExportFormat::Docx).to_string();
        let heading_font = resolve_font_family(&presets.heading1.font_family, ExportFormat::Docx).to_string();
        let code_font = resolve_font_family(&presets.code_font_family, ExportFormat::Docx).to_string();

        // Convert px to half-points: 1px ~= 0.75pt, half-points = pt * 2
        // So half-points = px * 1.5 (roughly)
        let px_to_half_points = |px: f64| -> usize { (px * 1.5).round() as usize };

        // Convert line-height ratio to Word spacing units (240 = single spacing)
        let line_spacing = (presets.paragraph.line_height * 240.0).round() as i32;

        Self {
            body_font,
            heading_font,
            code_font,
            body_size: px_to_half_points(presets.paragraph.font_size),
            h1_size: px_to_half_points(presets.heading1.font_size),
            h2_size: px_to_half_points(presets.heading2.font_size),
            h3_size: px_to_half_points(presets.heading3.font_size),
            h4_size: px_to_half_points(presets.heading4.font_size),
            h5_size: px_to_half_points(presets.heading5.font_size),
            h6_size: px_to_half_points(presets.heading6.font_size),
            line_spacing,
            has_title_page: false,
            has_header_footer: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Converter state
// ---------------------------------------------------------------------------

/// Numbering IDs for bullet and ordered lists.
const BULLET_NUM_ID: usize = 1;
const ORDERED_NUM_ID: usize = 2;

struct DocxConverter<'a> {
    title: String,
    template: &'a TemplateConfig,
    options: &'a DocxOptions,
    page_settings: Option<&'a super::page_settings::DocumentPageSettings>,
    paragraphs: Vec<DocxElement>,
    /// Active inline runs being accumulated for the current paragraph.
    runs: Vec<Run>,
    /// Inline formatting state stack.
    bold: bool,
    italic: bool,
    strikethrough: bool,
    code_inline: bool,
    /// Current link URL (None when not inside a link).
    #[allow(dead_code)]
    link_url: Option<String>,
    /// List nesting depth.
    list_depth: usize,
    /// Current list type stack.
    list_types: Vec<ListKind>,
    /// Table state.
    table_alignments: Vec<TableAlignment>,
    table_rows: Vec<TableRow>,
    table_is_header_row: bool,
    table_cells: Vec<TableCell>,
    table_header_meta: Vec<ColumnMeta>,
    table_data_values: Vec<Vec<String>>,
    /// Code block accumulator.
    code_block_text: Option<String>,
    /// Cell paragraph accumulator (for tables).
    cell_paragraphs: Option<Vec<Paragraph>>,
    cell_runs: Option<Vec<Run>>,
    /// Pre-rendered SVGs for inline chart/excalidraw blocks.
    embedded_svgs: Option<&'a [String]>,
    /// Index into embedded_svgs, incremented for each chart/excalidraw code block.
    embedded_svg_index: usize,
}

enum DocxElement {
    Para(Paragraph),
    Tbl(Table),
}

#[derive(Clone, Copy)]
enum ListKind {
    Bullet,
    Ordered,
    Task,
}

impl<'a> DocxConverter<'a> {
    fn new(
        title: &str,
        template: &'a TemplateConfig,
        options: &'a DocxOptions,
        page_settings: Option<&'a super::page_settings::DocumentPageSettings>,
        embedded_svgs: Option<&'a [String]>,
    ) -> Self {
        Self {
            title: title.to_string(),
            template,
            options,
            page_settings,
            paragraphs: Vec::new(),
            runs: Vec::new(),
            bold: false,
            italic: false,
            strikethrough: false,
            code_inline: false,
            link_url: None,
            list_depth: 0,
            list_types: Vec::new(),
            table_alignments: Vec::new(),
            table_rows: Vec::new(),
            table_is_header_row: false,
            table_cells: Vec::new(),
            table_header_meta: Vec::new(),
            table_data_values: Vec::new(),
            code_block_text: None,
            cell_paragraphs: None,
            cell_runs: None,
            embedded_svgs,
            embedded_svg_index: 0,
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    fn body_fonts(&self) -> RunFonts {
        RunFonts::new()
            .ascii(self.template.body_font.clone())
            .hi_ansi(self.template.body_font.clone())
            .east_asia(self.template.body_font.clone())
            .cs(self.template.body_font.clone())
    }

    fn heading_fonts(&self) -> RunFonts {
        RunFonts::new()
            .ascii(self.template.heading_font.clone())
            .hi_ansi(self.template.heading_font.clone())
            .east_asia(self.template.heading_font.clone())
            .cs(self.template.heading_font.clone())
    }

    fn code_fonts(&self) -> RunFonts {
        RunFonts::new()
            .ascii(self.template.code_font.clone())
            .hi_ansi(self.template.code_font.clone())
            .east_asia(self.template.code_font.clone())
            .cs(self.template.code_font.clone())
    }

    fn body_line_spacing(&self) -> LineSpacing {
        LineSpacing::new()
            .line(self.template.line_spacing)
            .line_rule(LineSpacingType::Auto)
    }

    /// Apply current formatting to a run.
    fn style_run(&self, mut run: Run) -> Run {
        run = run.fonts(self.body_fonts()).size(self.template.body_size);
        if self.bold {
            run = run.bold();
        }
        if self.italic {
            run = run.italic();
        }
        if self.strikethrough {
            run = run.strike();
        }
        if self.code_inline {
            run = run
                .fonts(self.code_fonts())
                .size(self.template.body_size - 2)
                .shading(Shading::new().fill("E8E8E8").shd_type(ShdType::Clear));
        }
        run
    }

    /// Push a run, routing to either table cell accumulator or main runs.
    fn push_run(&mut self, run: Run) {
        if let Some(ref mut cell_runs) = self.cell_runs {
            cell_runs.push(run);
        } else {
            self.runs.push(run);
        }
    }

    /// Add text with current formatting.
    fn add_text(&mut self, text: &str) {
        if let Some(ref mut code_text) = self.code_block_text {
            code_text.push_str(text);
            return;
        }
        let run = self.style_run(Run::new().add_text(text));
        self.push_run(run);
    }

    /// Flush accumulated runs into a paragraph and push it.
    fn flush_paragraph(&mut self) {
        if self.runs.is_empty() {
            return;
        }
        let mut para = Paragraph::new();
        for run in self.runs.drain(..) {
            para = para.add_run(run);
        }
        para = para.line_spacing(self.body_line_spacing());
        self.paragraphs.push(DocxElement::Para(para));
    }

    /// Flush cell runs into a cell paragraph.
    fn flush_cell_paragraph(&mut self) {
        if let Some(ref mut cell_runs) = self.cell_runs {
            if cell_runs.is_empty() {
                return;
            }
            let mut para = Paragraph::new();
            for run in cell_runs.drain(..) {
                para = para.add_run(run);
            }
            if let Some(ref mut cell_paragraphs) = self.cell_paragraphs {
                cell_paragraphs.push(para);
            }
        }
    }

    // ------------------------------------------------------------------
    // AST walking
    // ------------------------------------------------------------------

    fn walk<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>) {
        let val = node.data.borrow().value.clone();

        match val {
            NodeValue::Document => {
                self.walk_children(node);
            }
            NodeValue::FrontMatter(_) => {
                // Skip YAML frontmatter
            }
            NodeValue::Heading(ref heading) => {
                self.convert_heading(node, heading);
            }
            NodeValue::Paragraph => {
                self.convert_paragraph(node);
            }
            NodeValue::Text(ref text) => {
                self.add_text(text);
            }
            NodeValue::SoftBreak => {
                self.add_text(" ");
            }
            NodeValue::LineBreak => {
                let run = self.style_run(Run::new().add_break(BreakType::TextWrapping));
                self.push_run(run);
            }
            NodeValue::Code(NodeCode { ref literal, .. }) => {
                self.code_inline = true;
                self.add_text(literal);
                self.code_inline = false;
            }
            NodeValue::Strong => {
                self.bold = true;
                self.walk_children(node);
                self.bold = false;
            }
            NodeValue::Emph => {
                self.italic = true;
                self.walk_children(node);
                self.italic = false;
            }
            NodeValue::Strikethrough => {
                self.strikethrough = true;
                self.walk_children(node);
                self.strikethrough = false;
            }
            NodeValue::Link(ref link) => {
                self.convert_link(node, link);
            }
            NodeValue::Image(ref link) => {
                self.convert_image(link);
            }
            NodeValue::ThematicBreak => {
                // Horizontal rule as paragraph with bottom border
                let para = Paragraph::new()
                    .add_run(Run::new().add_text(""))
                    .line_spacing(LineSpacing::new().before(120).after(120));
                // Use a paragraph border as HR
                self.paragraphs.push(DocxElement::Para(para));
            }
            NodeValue::List(ref list_data) => {
                self.convert_list(node, list_data);
            }
            NodeValue::Item(ref list_data) => {
                self.convert_list_item(node, list_data);
            }
            NodeValue::TaskItem(ref task) => {
                self.convert_task_item(node, task);
            }
            NodeValue::BlockQuote => {
                self.convert_blockquote(node);
            }
            NodeValue::CodeBlock(ref code_block) => {
                let lang = code_block.info.split_whitespace().next().unwrap_or("");
                if lang == "chart" || lang == "excalidraw" {
                    let idx = self.embedded_svg_index;
                    self.embedded_svg_index += 1;

                    if let Some(svgs) = self.embedded_svgs {
                        if let Some(svg) = svgs.get(idx) {
                            if !svg.is_empty() {
                                // DOCX doesn't support SVG — convert to PNG via resvg
                                if let Some((png_data, orig_w, orig_h)) = crate::commands::export::svg_to_png(svg) {
                                    // Scale to fit page content width (page width minus margins)
                                    // Page widths in EMU: A4=7560310, Letter=7772400, A5=5346700
                                    // Default margins: ~1 inch each side = 914400 × 2 = 1828800
                                    let page_w_emu: u32 = match self.options.page_size.as_str() {
                                        "letter" => 7_772_400,
                                        "a5" => 5_346_700,
                                        _ => 7_560_310, // a4
                                    };
                                    let max_width_emu = page_w_emu - 1_828_800; // subtract margins
                                    let aspect = orig_h as f64 / orig_w as f64;
                                    let w_emu = max_width_emu;
                                    let h_emu = (w_emu as f64 * aspect) as u32;
                                    let pic = Pic::new(&png_data).size(w_emu, h_emu);
                                    let run = Run::new().add_image(pic);
                                    let para = Paragraph::new()
                                        .add_run(run)
                                        .line_spacing(self.body_line_spacing());
                                    self.paragraphs.push(DocxElement::Para(para));
                                    return;
                                }
                            }
                        }
                    }
                    // Fallback placeholder
                    let title = serde_json::from_str::<serde_json::Value>(&code_block.literal)
                        .ok()
                        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()))
                        .unwrap_or_else(|| if lang == "chart" { "Chart".to_string() } else { "Drawing".to_string() });
                    let run = Run::new().add_text(&format!("[{}]", title)).italic().color("888888");
                    let para = Paragraph::new().add_run(run).line_spacing(self.body_line_spacing());
                    self.paragraphs.push(DocxElement::Para(para));
                    return;
                }
                self.convert_code_block(&code_block.literal);
            }
            NodeValue::Table(ref table) => {
                self.convert_table(node, &table.alignments);
            }
            NodeValue::TableRow(is_header) => {
                self.table_is_header_row = is_header;
                self.table_cells.clear();
                // Initialize cell accumulator
                self.cell_paragraphs = Some(Vec::new());
                self.cell_runs = Some(Vec::new());
                self.walk_children(node);
                self.cell_paragraphs = None;
                self.cell_runs = None;
            }
            NodeValue::TableCell => {
                // Start fresh cell
                self.cell_paragraphs = Some(Vec::new());
                self.cell_runs = Some(Vec::new());
                self.walk_children(node);
                // Flush remaining runs in the cell
                self.flush_cell_paragraph();
                // Build the cell from accumulated paragraphs
                let paragraphs = self.cell_paragraphs.take().unwrap_or_default();
                let mut cell = TableCell::new();
                if paragraphs.is_empty() {
                    cell = cell.add_paragraph(Paragraph::new());
                } else {
                    for p in paragraphs {
                        cell = cell.add_paragraph(p);
                    }
                }
                self.table_cells.push(cell);
                // Restore cell context for potential sibling cells
                self.cell_paragraphs = Some(Vec::new());
                self.cell_runs = Some(Vec::new());
            }
            NodeValue::HtmlInline(ref html) => {
                // Pass HTML comments through for table metadata
                if html.trim().starts_with("<!--") {
                    self.add_text(html);
                }
            }
            NodeValue::HtmlBlock(ref hb) => {
                // Handle page break comments
                if hb.literal.trim() == "<!-- pagebreak -->" {
                    self.flush_paragraph();
                    let para = Paragraph::new()
                        .add_run(Run::new().add_break(BreakType::Page));
                    self.paragraphs.push(DocxElement::Para(para));
                }
                // Otherwise skip raw HTML blocks
            }
            _ => {
                self.walk_children(node);
            }
        }
    }

    fn walk_children<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>) {
        for child in node.children() {
            self.walk(child);
        }
    }

    // ------------------------------------------------------------------
    // Node converters
    // ------------------------------------------------------------------

    fn convert_heading<'b>(
        &mut self,
        node: &'b comrak::nodes::AstNode<'b>,
        heading: &NodeHeading,
    ) {
        let level = heading.level;
        let size = self.template.heading_size(level);

        // Collect heading text
        let saved_runs = std::mem::take(&mut self.runs);
        self.walk_children(node);
        let heading_runs = std::mem::replace(&mut self.runs, saved_runs);

        let mut para = Paragraph::new();
        for mut run in heading_runs {
            run = run
                .bold()
                .size(size)
                .fonts(self.heading_fonts());
            para = para.add_run(run);
        }

        // Add spacing before headings
        let before = match level {
            1 => 360,
            2 => 280,
            _ => 200,
        };
        para = para.line_spacing(
            LineSpacing::new()
                .before(before)
                .after(120)
                .line(self.template.line_spacing)
                .line_rule(LineSpacingType::Auto),
        );

        self.paragraphs.push(DocxElement::Para(para));
    }

    fn convert_paragraph<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>) {
        // If inside a table cell, flush to cell paragraphs
        if self.cell_runs.is_some() {
            self.flush_cell_paragraph();
            self.walk_children(node);
            self.flush_cell_paragraph();
            return;
        }

        self.walk_children(node);
        // Flush into a paragraph
        if !self.runs.is_empty() {
            let mut para = Paragraph::new();
            for run in self.runs.drain(..) {
                para = para.add_run(run);
            }
            para = para.line_spacing(self.body_line_spacing());
            self.paragraphs.push(DocxElement::Para(para));
        }
    }

    fn convert_link<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>, link: &NodeLink) {
        let url = link.url.clone();
        let saved_runs = std::mem::take(&mut self.runs);
        self.walk_children(node);
        let link_runs = std::mem::replace(&mut self.runs, saved_runs);

        let mut hyperlink = Hyperlink::new(&url, HyperlinkType::External);
        for mut run in link_runs {
            // Style links with underline and grey color
            run = run.underline("single").color("555555");
            hyperlink = hyperlink.add_run(run);
        }

        // Push hyperlink as paragraph child
        if self.cell_runs.is_some() {
            // Inside a table cell — we can't easily add hyperlinks to cell runs,
            // so just add the text with link styling
            let text = collect_text(node);
            let run = self.style_run(
                Run::new()
                    .add_text(&text)
                    .underline("single")
                    .color("555555"),
            );
            self.push_run(run);
        } else {
            // Build a paragraph with the hyperlink if we have pending runs
            if !self.runs.is_empty() {
                // There are runs before the link — flush them into a paragraph
                // along with the hyperlink
                let mut para = Paragraph::new();
                for run in self.runs.drain(..) {
                    para = para.add_run(run);
                }
                para = para.add_hyperlink(hyperlink);
                para = para.line_spacing(self.body_line_spacing());
                self.paragraphs.push(DocxElement::Para(para));
            } else {
                // Hyperlink is the only content — create a paragraph for it
                let para = Paragraph::new()
                    .add_hyperlink(hyperlink)
                    .line_spacing(self.body_line_spacing());
                self.paragraphs.push(DocxElement::Para(para));
            }
        }
    }

    fn convert_image(&mut self, link: &NodeLink) {
        let url = &link.url;

        // Resolve image path
        let resolved_path = if url.ends_with(".excalidraw") {
            // Drawing: resolve to .svg sidecar
            let svg_path = format!("{}.svg", url.trim_end_matches(".excalidraw"));
            self.resolve_path(&svg_path)
        } else {
            self.resolve_path(url)
        };

        if let Some(path) = resolved_path {
            if let Ok(data) = std::fs::read(&path) {
                let pic = Pic::new(&data);
                let run = Run::new().add_image(pic);
                let para = Paragraph::new()
                    .add_run(run)
                    .line_spacing(self.body_line_spacing());
                self.paragraphs.push(DocxElement::Para(para));
                return;
            }
        }

        // Fallback: show image reference as text
        let alt = &link.title;
        let text = if alt.is_empty() {
            format!("[Image: {}]", url)
        } else {
            format!("[Image: {}]", alt)
        };
        let run = self.style_run(Run::new().add_text(&text).italic().color("888888"));
        let para = Paragraph::new()
            .add_run(run)
            .line_spacing(self.body_line_spacing());
        self.paragraphs.push(DocxElement::Para(para));
    }

    fn resolve_path(&self, url: &str) -> Option<String> {
        if let Some(ref root) = self.options.project_root {
            let path = if url.starts_with('/') {
                format!("{}{}", root, url)
            } else {
                format!("{}/{}", root, url)
            };
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
        // Try as absolute path
        if std::path::Path::new(url).exists() {
            return Some(url.to_string());
        }
        None
    }

    // ------------------------------------------------------------------
    // Lists
    // ------------------------------------------------------------------

    fn convert_list<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>, list_data: &NodeList) {
        self.list_depth += 1;
        let kind = if list_data.is_task_list {
            ListKind::Task
        } else {
            match list_data.list_type {
                ListType::Bullet => ListKind::Bullet,
                ListType::Ordered => ListKind::Ordered,
            }
        };
        self.list_types.push(kind);
        self.walk_children(node);
        self.list_types.pop();
        self.list_depth -= 1;
    }

    fn convert_list_item<'b>(
        &mut self,
        node: &'b comrak::nodes::AstNode<'b>,
        _list_data: &NodeList,
    ) {
        let kind = self.list_types.last().copied().unwrap_or(ListKind::Bullet);
        let indent_level = IndentLevel::new(self.list_depth - 1);

        let saved_runs = std::mem::take(&mut self.runs);
        self.walk_children(node);
        let item_runs = std::mem::replace(&mut self.runs, saved_runs);

        let mut para = Paragraph::new();
        for run in item_runs {
            para = para.add_run(run);
        }

        match kind {
            ListKind::Bullet => {
                para = para.numbering(NumberingId::new(BULLET_NUM_ID), indent_level);
            }
            ListKind::Ordered => {
                para = para.numbering(NumberingId::new(ORDERED_NUM_ID), indent_level);
            }
            ListKind::Task => {
                // Task items are handled by convert_task_item
                para = para.numbering(NumberingId::new(BULLET_NUM_ID), indent_level);
            }
        }

        para = para.line_spacing(self.body_line_spacing());
        self.paragraphs.push(DocxElement::Para(para));
    }

    fn convert_task_item<'b>(
        &mut self,
        node: &'b comrak::nodes::AstNode<'b>,
        task: &comrak::nodes::NodeTaskItem,
    ) {
        let checked = task.symbol.is_some();
        let checkbox = if checked { "\u{2611} " } else { "\u{2610} " };
        let indent_level = IndentLevel::new(self.list_depth - 1);

        let saved_runs = std::mem::take(&mut self.runs);

        // Add checkbox prefix
        let cb_run = self.style_run(Run::new().add_text(checkbox));
        self.runs.push(cb_run);

        // Walk children (usually a Paragraph wrapping the text)
        for child in node.children() {
            let child_val = child.data.borrow().value.clone();
            match child_val {
                NodeValue::Paragraph => {
                    self.walk_children(child);
                }
                _ => {
                    self.walk(child);
                }
            }
        }

        let item_runs = std::mem::replace(&mut self.runs, saved_runs);

        let mut para = Paragraph::new();
        for run in item_runs {
            para = para.add_run(run);
        }
        para = para
            .numbering(NumberingId::new(BULLET_NUM_ID), indent_level)
            .line_spacing(self.body_line_spacing());

        self.paragraphs.push(DocxElement::Para(para));
    }

    // ------------------------------------------------------------------
    // Blockquotes & Callouts
    // ------------------------------------------------------------------

    fn convert_blockquote<'b>(&mut self, node: &'b comrak::nodes::AstNode<'b>) {
        // Check for link preview
        if let Some(link_info) = detect_link_preview(node) {
            self.render_link_preview(&link_info);
            return;
        }

        // Check for callout
        if let Some(callout) = detect_callout(node) {
            self.render_callout(node, &callout);
            return;
        }

        // Regular blockquote: indented with left border effect
        let saved_runs = std::mem::take(&mut self.runs);
        self.walk_children(node);
        let quote_runs = std::mem::replace(&mut self.runs, saved_runs);

        if !quote_runs.is_empty() {
            let mut para = Paragraph::new();
            for mut run in quote_runs {
                run = run.color("666666");
                para = para.add_run(run);
            }
            // Indent blockquote
            para = para
                .indent(Some(720), None, None, None) // 0.5 inch left indent
                .line_spacing(self.body_line_spacing());
            self.paragraphs.push(DocxElement::Para(para));
        }
    }

    fn render_callout<'b>(
        &mut self,
        node: &'b comrak::nodes::AstNode<'b>,
        callout: &CalloutInfo,
    ) {
        let (label, bg_color) = match callout.callout_type.as_str() {
            "note" => ("Note", "E8F0FE"),
            "tip" => ("Tip", "E6F4EA"),
            "warning" => ("Warning", "FFF3E0"),
            "important" => ("Important", "FCE8E6"),
            _ => ("Note", "E8F0FE"),
        };

        let title_text = callout
            .title
            .as_deref()
            .unwrap_or(label);

        // Callout as a single-cell table with colored background
        let title_run = Run::new()
            .add_text(title_text)
            .bold()
            .fonts(self.body_fonts())
            .size(self.template.body_size);

        // Collect body text (skip first paragraph which contains [!type])
        let mut body_text = String::new();
        let mut first_para = true;
        for child in node.children() {
            if first_para {
                first_para = false;
                // Extract remaining text from first paragraph (after [!type] line)
                let full_text = collect_text(child);
                // Skip the [!type] prefix line
                if let Some(pos) = full_text.find('\n') {
                    body_text.push_str(full_text[pos + 1..].trim());
                }
                continue;
            }
            body_text.push_str(&collect_text(child));
            body_text.push('\n');
        }

        let mut cell = TableCell::new()
            .shading(Shading::new().fill(bg_color).shd_type(ShdType::Clear));

        // Title paragraph
        let title_para = Paragraph::new().add_run(title_run);
        cell = cell.add_paragraph(title_para);

        // Body paragraph if any
        let trimmed_body = body_text.trim();
        if !trimmed_body.is_empty() {
            let body_run = Run::new()
                .add_text(trimmed_body)
                .fonts(self.body_fonts())
                .size(self.template.body_size);
            let body_para = Paragraph::new().add_run(body_run);
            cell = cell.add_paragraph(body_para);
        }

        let row = TableRow::new(vec![cell]);
        let table = Table::new(vec![row]);
        self.paragraphs.push(DocxElement::Tbl(table));
    }

    fn render_link_preview(&mut self, info: &LinkPreviewInfo) {
        // Bold title
        let mut paras = Vec::new();

        if let Some(ref title) = info.title {
            let run = Run::new()
                .add_text(title)
                .bold()
                .fonts(self.body_fonts())
                .size(self.template.body_size);
            paras.push(Paragraph::new().add_run(run));
        }

        if let Some(ref desc) = info.description {
            let run = Run::new()
                .add_text(desc)
                .fonts(self.body_fonts())
                .size(self.template.body_size);
            paras.push(Paragraph::new().add_run(run));
        }

        // URL in grey
        let url_run = Run::new()
            .add_text(&info.url)
            .color("888888")
            .fonts(self.body_fonts())
            .size(self.template.body_size - 2);
        paras.push(Paragraph::new().add_run(url_run));

        for para in paras {
            self.paragraphs.push(DocxElement::Para(para));
        }
    }

    // ------------------------------------------------------------------
    // Code blocks
    // ------------------------------------------------------------------

    fn convert_code_block(&mut self, literal: &str) {
        // Code block as paragraph(s) with monospace font and grey background
        let lines = literal.trim_end();
        let run = Run::new()
            .add_text(lines)
            .fonts(self.code_fonts())
            .size(self.template.body_size - 2)
            .shading(Shading::new().fill("F0F0F0").shd_type(ShdType::Clear));

        let para = Paragraph::new()
            .add_run(run)
            .line_spacing(
                LineSpacing::new()
                    .before(80)
                    .after(80)
                    .line(240) // single spacing for code
                    .line_rule(LineSpacingType::Auto),
            );
        self.paragraphs.push(DocxElement::Para(para));
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    fn convert_table<'b>(
        &mut self,
        node: &'b comrak::nodes::AstNode<'b>,
        alignments: &[TableAlignment],
    ) {
        self.table_alignments = alignments.to_vec();
        self.table_rows.clear();
        self.table_header_meta.clear();
        self.table_data_values.clear();

        // Walk rows
        for child in node.children() {
            let child_val = child.data.borrow().value.clone();
            if let NodeValue::TableRow(is_header) = child_val {
                self.table_is_header_row = is_header;
                self.table_cells = Vec::new();
                self.cell_paragraphs = Some(Vec::new());
                self.cell_runs = Some(Vec::new());

                // Collect cell text for metadata/aggregation
                let mut row_texts: Vec<String> = Vec::new();
                for cell_node in child.children() {
                    self.cell_paragraphs = Some(Vec::new());
                    self.cell_runs = Some(Vec::new());
                    self.walk_children(cell_node);
                    self.flush_cell_paragraph();

                    let cell_text = collect_text(cell_node);
                    row_texts.push(cell_text.clone());

                    let paragraphs = self.cell_paragraphs.take().unwrap_or_default();
                    let mut cell = TableCell::new();
                    if paragraphs.is_empty() {
                        cell = cell.add_paragraph(Paragraph::new());
                    } else {
                        for p in paragraphs {
                            cell = cell.add_paragraph(p);
                        }
                    }

                    if is_header {
                        // Style header cells with bold and shading
                        cell = cell.shading(
                            Shading::new().fill("F0F0F0").shd_type(ShdType::Clear),
                        );
                    }

                    self.table_cells.push(cell);
                }

                if is_header {
                    // Parse column metadata from header cells
                    self.table_header_meta = row_texts
                        .iter()
                        .map(|text| {
                            let (_, meta) = parse_column_metadata(text);
                            meta
                        })
                        .collect();
                } else {
                    // Process data row: format values, strip sparklines
                    let formatted_texts: Vec<String> = row_texts
                        .iter()
                        .enumerate()
                        .map(|(i, text)| {
                            let meta = self.table_header_meta.get(i);
                            let stripped = strip_sparkline_syntax(text);
                            if let Some(meta) = meta {
                                if let Some(col_type) = meta.col_type() {
                                    if let Some(val) = parse_numeric_value(&stripped) {
                                        return format_value(val, col_type, meta.currency());
                                    }
                                }
                            }
                            stripped
                        })
                        .collect();
                    self.table_data_values.push(formatted_texts);
                }

                self.cell_paragraphs = None;
                self.cell_runs = None;

                let row = TableRow::new(std::mem::take(&mut self.table_cells));
                self.table_rows.push(row);
            }
        }

        // Compute aggregation footer if any column has a summary
        let has_summary = self
            .table_header_meta
            .iter()
            .any(|m| m.summary().is_some());

        if has_summary && !self.table_data_values.is_empty() {
            let num_cols = self.table_header_meta.len();
            let mut footer_cells = Vec::new();

            for col_idx in 0..num_cols {
                let meta = &self.table_header_meta[col_idx];
                let cell_text = if let Some(agg_type) = meta.summary() {
                    // Collect numeric values for this column
                    let values: Vec<f64> = self
                        .table_data_values
                        .iter()
                        .filter_map(|row| {
                            row.get(col_idx)
                                .and_then(|t| parse_numeric_value(t))
                        })
                        .collect();
                    if let Some(result) = compute_aggregation(&values, agg_type) {
                        let formatted = format_value(
                            result,
                            meta.col_type().unwrap_or("number"),
                            meta.currency(),
                        );
                        format!("{}: {}", agg_type.to_uppercase(), formatted)
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };

                let run = Run::new()
                    .add_text(&cell_text)
                    .bold()
                    .fonts(self.body_fonts())
                    .size(self.template.body_size);
                let para = Paragraph::new().add_run(run);
                let cell = TableCell::new()
                    .add_paragraph(para)
                    .shading(Shading::new().fill("F5F5F5").shd_type(ShdType::Clear));
                footer_cells.push(cell);
            }

            let footer_row = TableRow::new(footer_cells);
            self.table_rows.push(footer_row);
        }

        // Build the table
        if !self.table_rows.is_empty() {
            let table = Table::new(std::mem::take(&mut self.table_rows));
            self.paragraphs.push(DocxElement::Tbl(table));
        }
    }

    // ------------------------------------------------------------------
    // Finalize
    // ------------------------------------------------------------------

    fn finish(self) -> Result<Vec<u8>, String> {
        let mut docx = Docx::new();

        // Page size
        let (w, h) = match self.options.page_size.as_str() {
            "letter" => (12240, 15840), // 8.5 x 11 inches in twips
            "a5" => (8391, 11906),      // 148 x 210 mm in twips
            _ => (11906, 16838),        // A4: 210 x 297 mm in twips
        };
        docx = docx.page_size(w as u32, h as u32);

        // Page margins (1 inch = 1440 twips)
        docx = docx.page_margin(
            PageMargin::new()
                .top(1440)
                .bottom(1440)
                .left(1440)
                .right(1440)
                .header(720)
                .footer(720),
        );

        // Default font
        docx = docx.default_fonts(
            RunFonts::new()
                .ascii(self.template.body_font.clone())
                .hi_ansi(self.template.body_font.clone())
                .east_asia(self.template.body_font.clone())
                .cs(self.template.body_font.clone()),
        );
        docx = docx.default_size(self.template.body_size);
        docx = docx.default_line_spacing(
            LineSpacing::new()
                .line(self.template.line_spacing)
                .line_rule(LineSpacingType::Auto),
        );

        // Define numbering for bullet lists
        docx = docx.add_abstract_numbering(
            AbstractNumbering::new(BULLET_NUM_ID)
                .add_level(
                    Level::new(
                        0,
                        Start::new(1),
                        NumberFormat::new("bullet"),
                        LevelText::new("\u{2022}"),
                        LevelJc::new("left"),
                    )
                    .indent(Some(720), Some(SpecialIndentType::Hanging(360)), None, None),
                )
                .add_level(
                    Level::new(
                        1,
                        Start::new(1),
                        NumberFormat::new("bullet"),
                        LevelText::new("\u{25E6}"),
                        LevelJc::new("left"),
                    )
                    .indent(Some(1440), Some(SpecialIndentType::Hanging(360)), None, None),
                )
                .add_level(
                    Level::new(
                        2,
                        Start::new(1),
                        NumberFormat::new("bullet"),
                        LevelText::new("\u{2013}"),
                        LevelJc::new("left"),
                    )
                    .indent(Some(2160), Some(SpecialIndentType::Hanging(360)), None, None),
                ),
        );
        docx = docx.add_numbering(Numbering::new(BULLET_NUM_ID, BULLET_NUM_ID));

        // Define numbering for ordered lists
        docx = docx.add_abstract_numbering(
            AbstractNumbering::new(ORDERED_NUM_ID)
                .add_level(
                    Level::new(
                        0,
                        Start::new(1),
                        NumberFormat::new("decimal"),
                        LevelText::new("%1."),
                        LevelJc::new("left"),
                    )
                    .indent(Some(720), Some(SpecialIndentType::Hanging(360)), None, None),
                )
                .add_level(
                    Level::new(
                        1,
                        Start::new(1),
                        NumberFormat::new("lowerLetter"),
                        LevelText::new("%2."),
                        LevelJc::new("left"),
                    )
                    .indent(Some(1440), Some(SpecialIndentType::Hanging(360)), None, None),
                )
                .add_level(
                    Level::new(
                        2,
                        Start::new(1),
                        NumberFormat::new("lowerRoman"),
                        LevelText::new("%3."),
                        LevelJc::new("left"),
                    )
                    .indent(Some(2160), Some(SpecialIndentType::Hanging(360)), None, None),
                ),
        );
        docx = docx.add_numbering(Numbering::new(ORDERED_NUM_ID, ORDERED_NUM_ID));

        // Title page for Report template
        if self.template.has_title_page {
            // Title
            let title_run = Run::new()
                .add_text(&self.title)
                .size(60) // 30pt
                .bold()
                .fonts(
                    RunFonts::new()
                        .ascii(self.template.heading_font.clone())
                        .hi_ansi(self.template.heading_font.clone()),
                );
            let title_para = Paragraph::new()
                .add_run(title_run)
                .align(AlignmentType::Center)
                .line_spacing(LineSpacing::new().before(4000));

            docx = docx.add_paragraph(title_para);

            // Date
            let date = chrono::Local::now().format("%B %d, %Y").to_string();
            let date_run = Run::new()
                .add_text(&date)
                .size(self.template.body_size)
                .color("888888")
                .fonts(
                    RunFonts::new()
                        .ascii(self.template.body_font.clone())
                        .hi_ansi(self.template.body_font.clone()),
                );
            let date_para = Paragraph::new()
                .add_run(date_run)
                .align(AlignmentType::Center)
                .line_spacing(LineSpacing::new().after(200));
            docx = docx.add_paragraph(date_para);

            // Page break after title page
            let break_para = Paragraph::new()
                .add_run(Run::new().add_break(BreakType::Page));
            docx = docx.add_paragraph(break_para);
        }

        // Table of contents
        if self.options.include_toc {
            let toc = TableOfContents::new()
                .heading_styles_range(1, 3)
                .hyperlink();
            docx = docx.add_table_of_contents(toc);

            // Page break after TOC
            let break_para = Paragraph::new()
                .add_run(Run::new().add_break(BreakType::Page));
            docx = docx.add_paragraph(break_para);
        }

        // Header/footer — use page_settings if provided, else fall back to template defaults
        if let Some(ps) = self.page_settings {
            use super::page_settings::{has_content, resolve_variables, VariableContext, PageHeaderFooter};

            let today = chrono::Local::now().format("%B %d, %Y").to_string();
            let hf_size = self.template.body_size.saturating_sub(4).max(14);
            let hf_fonts = RunFonts::new()
                .ascii(self.template.body_font.clone())
                .hi_ansi(self.template.body_font.clone());

            // Helper to build a three-column paragraph from left/center/right text.
            // Uses tab stops: center at page midpoint, right at page right edge.
            // Page width minus margins: w - 2*1440 twips.
            let page_text_width = (w as i32 - 2 * 1440).max(0) as usize;
            let center_tab = page_text_width / 2;
            let right_tab = page_text_width;

            let build_hf_paragraph = |hf: &PageHeaderFooter, title: &str, date: &str| -> Paragraph {
                let ctx = VariableContext {
                    page: "",    // Will use field codes instead
                    pages: "",   // Will use field codes instead
                    title,
                    date,
                };

                let mut para = Paragraph::new();

                // Left content
                let left_text = resolve_variables(&hf.left, &ctx);
                let mut run = Run::new()
                    .size(hf_size)
                    .color("888888")
                    .fonts(hf_fonts.clone());

                // Process the left column - handle {page} and {pages} as field codes
                if hf.left.contains("{page}") || hf.left.contains("{pages}") {
                    run = add_runs_with_fields(run, &hf.left, title, date, hf_size, &hf_fonts);
                } else if !left_text.is_empty() {
                    run = run.add_text(&left_text);
                }
                para = para.add_run(run);

                // Center tab + content
                if !hf.center.is_empty() {
                    let center_text = resolve_variables(&hf.center, &ctx);
                    let tab_run = Run::new().add_tab();
                    para = para.add_run(tab_run);

                    let mut crun = Run::new()
                        .size(hf_size)
                        .color("888888")
                        .fonts(hf_fonts.clone());
                    if hf.center.contains("{page}") || hf.center.contains("{pages}") {
                        crun = add_runs_with_fields(crun, &hf.center, title, date, hf_size, &hf_fonts);
                    } else {
                        crun = crun.add_text(&center_text);
                    }
                    para = para.add_run(crun);
                }

                // Right tab + content
                if !hf.right.is_empty() {
                    let right_text = resolve_variables(&hf.right, &ctx);
                    let tab_run = Run::new().add_tab();
                    para = para.add_run(tab_run);

                    let mut rrun = Run::new()
                        .size(hf_size)
                        .color("888888")
                        .fonts(hf_fonts.clone());
                    if hf.right.contains("{page}") || hf.right.contains("{pages}") {
                        rrun = add_runs_with_fields(rrun, &hf.right, title, date, hf_size, &hf_fonts);
                    } else {
                        rrun = rrun.add_text(&right_text);
                    }
                    para = para.add_run(rrun);
                }

                // Add tab stop definitions
                para = para
                    .add_tab(Tab::new().val(TabValueType::Center).pos(center_tab))
                    .add_tab(Tab::new().val(TabValueType::Right).pos(right_tab));

                para
            };

            if has_content(&ps.header) {
                let header_para = build_hf_paragraph(&ps.header, &self.title, &today);
                let header = Header::new().add_paragraph(header_para);

                if ps.header.different_first_page {
                    // Create first page header
                    let first_header = if let Some(ref fp_hf) = ps.header.first_page {
                        let fp = super::page_settings::PageHeaderFooter {
                            left: fp_hf.left.clone(),
                            center: fp_hf.center.clone(),
                            right: fp_hf.right.clone(),
                            different_first_page: false,
                            first_page: None,
                            different_odd_even: false,
                            odd_page: None,
                            even_page: None,
                        };
                        let fp_para = build_hf_paragraph(&fp, &self.title, &today);
                        Header::new().add_paragraph(fp_para)
                    } else {
                        // Empty first page header
                        Header::new().add_paragraph(Paragraph::new())
                    };
                    // first_header() automatically sets titlePg in section properties
                    docx = docx.header(header).first_header(first_header);
                } else {
                    docx = docx.header(header);
                }
            }

            if has_content(&ps.footer) {
                let footer_para = build_hf_paragraph(&ps.footer, &self.title, &today);
                let footer = Footer::new().add_paragraph(footer_para);

                if ps.footer.different_first_page {
                    let first_footer = if let Some(ref fp_hf) = ps.footer.first_page {
                        let fp = super::page_settings::PageHeaderFooter {
                            left: fp_hf.left.clone(),
                            center: fp_hf.center.clone(),
                            right: fp_hf.right.clone(),
                            different_first_page: false,
                            first_page: None,
                            different_odd_even: false,
                            odd_page: None,
                            even_page: None,
                        };
                        let fp_para = build_hf_paragraph(&fp, &self.title, &today);
                        Footer::new().add_paragraph(fp_para)
                    } else {
                        Footer::new().add_paragraph(Paragraph::new())
                    };
                    docx = docx.footer(footer).first_footer(first_footer);
                } else {
                    docx = docx.footer(footer);
                }
            }
        } else {
            // Legacy template-based header/footer
            if self.template.has_header_footer {
                // Header with title
                let header_run = Run::new()
                    .add_text(&self.title)
                    .size(self.template.body_size - 4)
                    .color("888888")
                    .fonts(
                        RunFonts::new()
                            .ascii(self.template.body_font.clone())
                            .hi_ansi(self.template.body_font.clone()),
                    );
                let header = Header::new().add_paragraph(
                    Paragraph::new().add_run(header_run),
                );
                docx = docx.header(header);
            }

            if self.options.include_page_numbers || self.template.has_header_footer {
                // Footer with page number
                let page_num_run = Run::new()
                    .add_field_char(FieldCharType::Begin, false)
                    .add_instr_text(InstrText::PAGE(InstrPAGE::new()))
                    .add_field_char(FieldCharType::End, false)
                    .size(self.template.body_size - 4)
                    .color("888888")
                    .fonts(
                        RunFonts::new()
                            .ascii(self.template.body_font.clone())
                            .hi_ansi(self.template.body_font.clone()),
                    );
                let footer = Footer::new().add_paragraph(
                    Paragraph::new()
                        .add_run(page_num_run)
                        .align(AlignmentType::Right),
                );
                docx = docx.footer(footer);
            }
        }

        // Add all content paragraphs
        for element in self.paragraphs {
            match element {
                DocxElement::Para(p) => {
                    docx = docx.add_paragraph(p);
                }
                DocxElement::Tbl(t) => {
                    docx = docx.add_table(t);
                }
            }
        }

        // Build and serialize
        let mut buf = Vec::new();
        let cursor = std::io::Cursor::new(&mut buf);
        docx.build()
            .pack(cursor)
            .map_err(|e| format!("Failed to generate DOCX: {}", e))?;

        Ok(buf)
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/// Build a Run that resolves `{page}` and `{pages}` as Word field codes,
/// and `{title}`/`{date}` as literal text. Returns the run with all parts added.
fn add_runs_with_fields(
    mut run: Run,
    template: &str,
    title: &str,
    date: &str,
    _size: usize,
    _fonts: &RunFonts,
) -> Run {
    let mut remaining = template;

    while !remaining.is_empty() {
        // Find the next variable
        let next_page = remaining.find("{page}");
        let next_pages = remaining.find("{pages}");
        let next_title = remaining.find("{title}");
        let next_date = remaining.find("{date}");

        // Find the earliest occurrence
        let earliest = [next_page, next_pages, next_title, next_date]
            .iter()
            .filter_map(|&pos| pos)
            .min();

        match earliest {
            None => {
                // No more variables, add remaining text
                if !remaining.is_empty() {
                    run = run.add_text(remaining);
                }
                break;
            }
            Some(pos) => {
                // Add text before the variable
                if pos > 0 {
                    run = run.add_text(&remaining[..pos]);
                }

                // Check which variable is at this position
                if next_pages == Some(pos) {
                    // {pages} → NUMPAGES field (check before {page} since it's longer)
                    run = run
                        .add_field_char(FieldCharType::Begin, false)
                        .add_instr_text(InstrText::NUMPAGES(InstrNUMPAGES::new()))
                        .add_field_char(FieldCharType::End, false);
                    remaining = &remaining[pos + 7..]; // "{pages}".len() == 7
                } else if next_page == Some(pos) {
                    // {page} → PAGE field
                    run = run
                        .add_field_char(FieldCharType::Begin, false)
                        .add_instr_text(InstrText::PAGE(InstrPAGE::new()))
                        .add_field_char(FieldCharType::End, false);
                    remaining = &remaining[pos + 6..]; // "{page}".len() == 6
                } else if next_title == Some(pos) {
                    run = run.add_text(title);
                    remaining = &remaining[pos + 7..]; // "{title}".len() == 7
                } else if next_date == Some(pos) {
                    run = run.add_text(date);
                    remaining = &remaining[pos + 6..]; // "{date}".len() == 6
                }
            }
        }
    }

    run
}

/// Recursively collect plain text from an AST node.
fn collect_text<'a>(node: &'a comrak::nodes::AstNode<'a>) -> String {
    let mut text = String::new();
    let val = node.data.borrow().value.clone();
    if let NodeValue::Text(ref t) = val {
        text.push_str(t);
    }
    if let NodeValue::Code(NodeCode { ref literal, .. }) = val {
        text.push_str(literal);
    }
    for child in node.children() {
        text.push_str(&collect_text(child));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_paragraph() {
        let result = markdown_to_docx(
            "Hello world",
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
        // DOCX files start with PK zip header
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
    }

    #[test]
    fn test_headings() {
        let md = "# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nBody text.";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
        assert!(!result.unwrap().is_empty());
    }

    #[test]
    fn test_inline_formatting() {
        let md = "**bold** *italic* ~~strike~~ `code`";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_lists() {
        let md = "- item 1\n- item 2\n  - nested\n\n1. first\n2. second\n\n- [x] done\n- [ ] todo";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_code_block() {
        let md = "```rust\nfn main() {\n    println!(\"hello\");\n}\n```";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_table() {
        let md = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_table_with_metadata() {
        let md = "| Item | Price <!-- type:currency,currency:USD,summary:sum --> |\n|---|---|\n| A | $10.00 |\n| B | $20.00 |";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_blockquote() {
        let md = "> This is a quote";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_frontmatter_stripped() {
        let md = "---\ntitle: Test\n---\n\nBody text.";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_templates() {
        for template in &["clean", "academic", "report"] {
            let result = markdown_to_docx(
                "# Hello\n\nWorld",
                "Test",
                template,
                &DocxOptions {
                    include_toc: false,
                    include_page_numbers: false,
                    page_size: "a4".to_string(),
                    project_root: None,
                },
                None,
                None,
                None,
            );
            assert!(result.is_ok(), "Template {} failed", template);
        }
    }

    #[test]
    fn test_page_sizes() {
        for size in &["a4", "letter", "a5"] {
            let result = markdown_to_docx(
                "Hello",
                "Test",
                "clean",
                &DocxOptions {
                    include_toc: false,
                    include_page_numbers: false,
                    page_size: size.to_string(),
                    project_root: None,
                },
                None,
                None,
                None,
            );
            assert!(result.is_ok(), "Page size {} failed", size);
        }
    }

    #[test]
    fn test_toc_and_page_numbers() {
        let result = markdown_to_docx(
            "# Chapter 1\n\nText\n\n## Section 1.1\n\nMore text",
            "Test",
            "academic",
            &DocxOptions {
                include_toc: true,
                include_page_numbers: true,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_horizontal_rule() {
        let md = "Before\n\n---\n\nAfter";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_link() {
        let md = "Visit [example](https://example.com) for more.";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_callout() {
        let md = "> [!warning] Watch out\n> This is dangerous.";
        let result = markdown_to_docx(
            md,
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_template_config_from_typography_default_presets() {
        let presets = super::super::typography::TypographyPresets::default();
        let config = TemplateConfig::from_typography(&presets);

        // Default paragraph is 16px → 16 * 1.5 = 24 half-points
        assert_eq!(config.body_size, 24);
        // Default h1 is 32px → 32 * 1.5 = 48 half-points
        assert_eq!(config.h1_size, 48);
        // Default h2 is 24px → 24 * 1.5 = 36 half-points
        assert_eq!(config.h2_size, 36);
        // Default h3 is 20px → 20 * 1.5 = 30 half-points
        assert_eq!(config.h3_size, 30);
        // Default h4 is 18px → 18 * 1.5 = 27 half-points
        assert_eq!(config.h4_size, 27);
        // Default h5 is 16px → 16 * 1.5 = 24 half-points
        assert_eq!(config.h5_size, 24);
        // Default h6 is 14px → 14 * 1.5 = 21 half-points
        assert_eq!(config.h6_size, 21);

        // Fonts resolved through resolve_font_family
        assert_eq!(config.body_font, "Inter");
        assert_eq!(config.heading_font, "Inter");
        assert_eq!(config.code_font, "JetBrains Mono");

        // Line spacing: 1.7 * 240 = 408
        assert_eq!(config.line_spacing, 408);

        // Typography presets don't set title page or header/footer
        assert!(!config.has_title_page);
        assert!(!config.has_header_footer);
    }

    #[test]
    fn test_template_config_from_typography_custom_presets() {
        use super::super::typography::{TextStyle, TypographyPresets};

        let presets = TypographyPresets {
            paragraph: TextStyle {
                font_family: "Source Serif 4".to_string(),
                font_size: 18.0,
                font_weight: 400,
                line_height: 1.5,
                paragraph_spacing: 1.0,
            },
            heading1: TextStyle {
                font_family: "Source Serif 4".to_string(),
                font_size: 36.0,
                font_weight: 700,
                line_height: 1.2,
                paragraph_spacing: 0.5,
            },
            ..TypographyPresets::default()
        };
        let config = TemplateConfig::from_typography(&presets);

        // 18px * 1.5 = 27 half-points
        assert_eq!(config.body_size, 27);
        // 36px * 1.5 = 54 half-points
        assert_eq!(config.h1_size, 54);

        // Font resolved: "Source Serif 4" stays as "Source Serif 4"
        assert_eq!(config.body_font, "Source Serif 4");
        assert_eq!(config.heading_font, "Source Serif 4");

        // Line spacing: 1.5 * 240 = 360
        assert_eq!(config.line_spacing, 360);
    }

    #[test]
    fn test_template_config_from_typography_heading_size_accessor() {
        let presets = super::super::typography::TypographyPresets::default();
        let config = TemplateConfig::from_typography(&presets);

        assert_eq!(config.heading_size(1), config.h1_size);
        assert_eq!(config.heading_size(2), config.h2_size);
        assert_eq!(config.heading_size(3), config.h3_size);
        assert_eq!(config.heading_size(4), config.h4_size);
        assert_eq!(config.heading_size(5), config.h5_size);
        assert_eq!(config.heading_size(6), config.h6_size);
        assert_eq!(config.heading_size(7), config.body_size);
    }

    #[test]
    fn test_docx_with_typography_presets() {
        let presets = super::super::typography::TypographyPresets::default();
        let result = markdown_to_docx(
            "# Hello\n\nWorld",
            "Test",
            "clean",
            &DocxOptions {
                include_toc: false,
                include_page_numbers: false,
                page_size: "a4".to_string(),
                project_root: None,
            },
            Some(&presets),
            None,
            None,
        );
        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(!bytes.is_empty());
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
    }
}
