/// Template preset names (legacy — kept for backwards compatibility and tests).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Template {
    Clean,
    Academic,
    Report,
}

impl Template {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "clean" => Ok(Template::Clean),
            "academic" => Ok(Template::Academic),
            "report" => Ok(Template::Report),
            _ => Err(format!("Unknown template: {}", s)),
        }
    }

    /// Return the template Typst source.
    fn source(&self) -> &'static str {
        match self {
            Template::Clean => include_str!("../../templates/clean.typ"),
            Template::Academic => include_str!("../../templates/academic.typ"),
            Template::Report => include_str!("../../templates/report.typ"),
        }
    }
}

/// Page size options.
#[derive(Debug, Clone, Copy)]
pub enum PageSize {
    A4,
    Letter,
    A5,
}

impl PageSize {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "a4" => Ok(PageSize::A4),
            "letter" => Ok(PageSize::Letter),
            "a5" => Ok(PageSize::A5),
            _ => Err(format!("Unknown page size: {}", s)),
        }
    }

    fn typst_value(&self) -> &'static str {
        match self {
            PageSize::A4 => "\"a4\"",
            PageSize::Letter => "\"us-letter\"",
            PageSize::A5 => "\"a5\"",
        }
    }
}

/// Options for applying a template to Typst content (legacy).
#[allow(dead_code)]
pub struct TemplateOptions {
    pub template: Template,
    pub title: String,
    pub include_toc: bool,
    pub include_page_numbers: bool,
    pub page_size: PageSize,
}

/// Wrap converted Typst content with a template.
///
/// Returns the complete Typst source that imports the template and
/// passes the content as the body argument.
#[allow(dead_code)]
pub fn apply_template(typst_content: &str, options: &TemplateOptions) -> String {
    let template_source = options.template.source();
    let title_escaped = options.title.replace('"', "\\\"");

    format!(
        r#"{template_source}

#set page(paper: {page_size})

#show: template.with(
  title: "{title}",
  include-toc: {include_toc},
  include-page-numbers: {include_page_numbers},
)

{content}
"#,
        template_source = template_source,
        page_size = options.page_size.typst_value(),
        title = title_escaped,
        include_toc = options.include_toc,
        include_page_numbers = options.include_page_numbers,
        content = typst_content,
    )
}

/// Generate Typst style rules from typography presets.
///
/// Produces a complete Typst source string with `#set` rules derived from
/// the preset values, combined with the template options (page size, TOC, etc.).
pub fn generate_typst_styles(
    typst_content: &str,
    presets: &super::typography::TypographyPresets,
    options: &TemplateOptions,
) -> String {
    use super::typography::{resolve_font_family, ExportFormat};

    let body = &presets.paragraph;
    let body_font = resolve_font_family(&body.font_family, ExportFormat::Typst);
    let code_font = resolve_font_family(&presets.code_font_family, ExportFormat::Typst);
    let title_escaped = options.title.replace('"', "\\\"");

    let mut source = String::new();

    // Page setup
    source.push_str(&format!(
        "#set page(paper: {})\n",
        options.page_size.typst_value()
    ));

    // Body text style
    source.push_str(&format!(
        "#set text(font: \"{}\", size: {}pt)\n",
        body_font, body.font_size
    ));

    // Paragraph spacing
    source.push_str(&format!(
        "#set par(leading: {}em, spacing: {}em)\n",
        body.line_height * 0.5, body.paragraph_spacing
    ));

    // Heading styles
    for level in 1..=6u8 {
        let h = presets.heading(level);
        let font = resolve_font_family(&h.font_family, ExportFormat::Typst);
        source.push_str(&format!(
            "#show heading.where(level: {}): set text(font: \"{}\", size: {}pt, weight: {})\n",
            level, font, h.font_size, h.font_weight
        ));
    }

    // Code blocks
    source.push_str(&format!(
        "#show raw: set text(font: \"{}\")\n",
        code_font
    ));

    // Page numbers
    if options.include_page_numbers {
        source.push_str("#set page(numbering: \"1\")\n");
    }

    // Title
    if !options.title.is_empty() {
        source.push_str(&format!(
            "\n#align(center)[#text(size: {}pt, weight: {})[{}]]\n\n",
            presets.heading1.font_size * 1.2,
            presets.heading1.font_weight,
            title_escaped,
        ));
    }

    // TOC
    if options.include_toc {
        source.push_str("#outline()\n#pagebreak()\n\n");
    }

    // Content
    source.push_str(typst_content);

    source
}

/// PPTX template preset names.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PptxTemplate {
    Simple,
    Business,
    Report,
}

impl PptxTemplate {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "simple" => Ok(PptxTemplate::Simple),
            "business" => Ok(PptxTemplate::Business),
            "report" => Ok(PptxTemplate::Report),
            _ => Err(format!("Unknown PPTX template: {}", s)),
        }
    }

    pub fn config(&self) -> PptxTemplateConfig {
        match self {
            PptxTemplate::Simple => PptxTemplateConfig {
                title_font: "Calibri",
                body_font: "Calibri",
                code_font: "Consolas",
                title_size: 44,
                subtitle_size: 28,
                body_size: 18,
                code_size: 14,
                title_color: "333333",
                body_color: "555555",
                show_slide_numbers: false,
                show_header_line: false,
                dark_title_slide: false,
            },
            PptxTemplate::Business => PptxTemplateConfig {
                title_font: "Calibri",
                body_font: "Calibri",
                code_font: "Consolas",
                title_size: 40,
                subtitle_size: 24,
                body_size: 18,
                code_size: 14,
                title_color: "222222",
                body_color: "444444",
                show_slide_numbers: true,
                show_header_line: true,
                dark_title_slide: false,
            },
            PptxTemplate::Report => PptxTemplateConfig {
                title_font: "Calibri",
                body_font: "Calibri",
                code_font: "Consolas",
                title_size: 44,
                subtitle_size: 28,
                body_size: 18,
                code_size: 14,
                title_color: "FFFFFF",
                body_color: "333333",
                show_slide_numbers: true,
                show_header_line: false,
                dark_title_slide: true,
            },
        }
    }
}

/// Configuration for PPTX template styling.
#[allow(dead_code)]
pub struct PptxTemplateConfig {
    pub title_font: &'static str,
    pub body_font: &'static str,
    pub code_font: &'static str,
    pub title_size: u32,
    pub subtitle_size: u32,
    pub body_size: u32,
    pub code_size: u32,
    pub title_color: &'static str,
    pub body_color: &'static str,
    pub show_slide_numbers: bool,
    pub show_header_line: bool,
    pub dark_title_slide: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::markdown_to_typst::markdown_to_typst;
    use crate::export::typst_world::NotesageWorld;

    const TEST_MARKDOWN: &str = r#"# Test Document

This is a paragraph with **bold** and *italic* text.

## Section One

- Item one
- Item two

### Subsection

Some more content here.

```rust
fn main() {}
```

| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |
"#;

    #[test]
    fn test_clean_template_compiles() {
        let typst_content = markdown_to_typst(TEST_MARKDOWN);
        let source = apply_template(
            &typst_content,
            &TemplateOptions {
                template: Template::Clean,
                title: "Test Document".to_string(),
                include_toc: false,
                include_page_numbers: false,
                page_size: PageSize::A4,
            },
        );
        let world = NotesageWorld::new(source);
        let result = world.export_pdf();
        assert!(result.is_ok(), "Clean template failed: {:?}", result.err());
    }

    #[test]
    fn test_academic_template_compiles() {
        let typst_content = markdown_to_typst(TEST_MARKDOWN);
        let source = apply_template(
            &typst_content,
            &TemplateOptions {
                template: Template::Academic,
                title: "Test Document".to_string(),
                include_toc: true,
                include_page_numbers: true,
                page_size: PageSize::A4,
            },
        );
        let world = NotesageWorld::new(source);
        let result = world.export_pdf();
        assert!(
            result.is_ok(),
            "Academic template failed: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_report_template_compiles() {
        let typst_content = markdown_to_typst(TEST_MARKDOWN);
        let source = apply_template(
            &typst_content,
            &TemplateOptions {
                template: Template::Report,
                title: "Test Document".to_string(),
                include_toc: true,
                include_page_numbers: true,
                page_size: PageSize::A4,
            },
        );
        let world = NotesageWorld::new(source);
        let result = world.export_pdf();
        assert!(
            result.is_ok(),
            "Report template failed: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_all_page_sizes() {
        let typst_content = markdown_to_typst("# Hello\n\nWorld.");
        for page_size in [PageSize::A4, PageSize::Letter, PageSize::A5] {
            let source = apply_template(
                &typst_content,
                &TemplateOptions {
                    template: Template::Clean,
                    title: "Size Test".to_string(),
                    include_toc: false,
                    include_page_numbers: true,
                    page_size,
                },
            );
            let world = NotesageWorld::new(source);
            let result = world.export_pdf();
            assert!(
                result.is_ok(),
                "Page size {:?} failed: {:?}",
                page_size,
                result.err()
            );
        }
    }

    #[test]
    fn test_toc_and_page_numbers_toggle() {
        let typst_content = markdown_to_typst(TEST_MARKDOWN);

        // All combinations
        for toc in [true, false] {
            for pn in [true, false] {
                let source = apply_template(
                    &typst_content,
                    &TemplateOptions {
                        template: Template::Clean,
                        title: "Toggle Test".to_string(),
                        include_toc: toc,
                        include_page_numbers: pn,
                        page_size: PageSize::A4,
                    },
                );
                let world = NotesageWorld::new(source);
                let result = world.export_pdf();
                assert!(
                    result.is_ok(),
                    "toc={}, pn={} failed: {:?}",
                    toc,
                    pn,
                    result.err()
                );
            }
        }
    }

    #[test]
    fn test_title_with_special_chars() {
        let typst_content = markdown_to_typst("# Test\n\nContent.");
        let source = apply_template(
            &typst_content,
            &TemplateOptions {
                template: Template::Clean,
                title: "My \"Fancy\" Document — Draft".to_string(),
                include_toc: false,
                include_page_numbers: false,
                page_size: PageSize::A4,
            },
        );
        let world = NotesageWorld::new(source);
        let result = world.export_pdf();
        assert!(
            result.is_ok(),
            "Title with special chars failed: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_template_from_str() {
        assert_eq!(Template::from_str("clean").unwrap(), Template::Clean);
        assert_eq!(Template::from_str("academic").unwrap(), Template::Academic);
        assert_eq!(Template::from_str("report").unwrap(), Template::Report);
        assert!(Template::from_str("invalid").is_err());
    }

    #[test]
    fn test_page_size_from_str() {
        assert!(PageSize::from_str("a4").is_ok());
        assert!(PageSize::from_str("letter").is_ok());
        assert!(PageSize::from_str("a5").is_ok());
        assert!(PageSize::from_str("invalid").is_err());
    }

    #[test]
    fn test_pptx_template_from_str() {
        assert_eq!(
            PptxTemplate::from_str("simple").unwrap(),
            PptxTemplate::Simple
        );
        assert_eq!(
            PptxTemplate::from_str("business").unwrap(),
            PptxTemplate::Business
        );
        assert_eq!(
            PptxTemplate::from_str("report").unwrap(),
            PptxTemplate::Report
        );
        assert!(PptxTemplate::from_str("invalid").is_err());
    }

    #[test]
    fn test_generate_typst_styles_contains_set_rules() {
        let presets = crate::export::typography::TypographyPresets::default();
        let options = TemplateOptions {
            template: Template::Clean,
            title: "Test Doc".to_string(),
            include_toc: false,
            include_page_numbers: false,
            page_size: PageSize::A4,
        };
        let styles = generate_typst_styles("= Hello\n\nWorld.", &presets, &options);
        // Body text rule
        assert!(styles.contains("#set text("), "should contain #set text rule");
        assert!(styles.contains("Inter"), "should reference Inter font");
        assert!(styles.contains("16pt"), "should set 16pt body size");
        // Paragraph spacing
        assert!(styles.contains("#set par("), "should contain #set par rule");
        // Heading rules for all 6 levels
        for level in 1..=6 {
            assert!(
                styles.contains(&format!("heading.where(level: {})", level)),
                "should contain heading level {} rule",
                level
            );
        }
        // Code font rule
        assert!(styles.contains("JetBrains Mono"), "should reference code font");
        assert!(styles.contains("#show raw:"), "should style raw blocks");
        // Content included
        assert!(styles.contains("= Hello"), "should include content");
    }

    #[test]
    fn test_generate_typst_styles_with_custom_presets() {
        use crate::export::typography::{TextStyle, TypographyPresets};

        let presets = TypographyPresets {
            paragraph: TextStyle {
                font_family: "Source Serif 4".to_string(),
                font_size: 18.0,
                font_weight: 400,
                line_height: 1.8,
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
        let options = TemplateOptions {
            template: Template::Academic,
            title: "Academic Paper".to_string(),
            include_toc: true,
            include_page_numbers: true,
            page_size: PageSize::Letter,
        };
        let styles = generate_typst_styles("Content here.", &presets, &options);
        assert!(styles.contains("Source Serif 4"), "should use custom font");
        assert!(styles.contains("18pt"), "should use custom body size");
        assert!(styles.contains("36pt"), "should use custom h1 size");
        assert!(styles.contains("#outline()"), "should include TOC");
        assert!(styles.contains("numbering: \"1\""), "should include page numbers");
        assert!(styles.contains("\"us-letter\""), "should use letter page size");
    }

    #[test]
    fn test_generate_typst_styles_title_escaped() {
        let presets = crate::export::typography::TypographyPresets::default();
        let options = TemplateOptions {
            template: Template::Clean,
            title: "My \"Fancy\" Title".to_string(),
            include_toc: false,
            include_page_numbers: false,
            page_size: PageSize::A4,
        };
        let styles = generate_typst_styles("Content.", &presets, &options);
        // Quotes should be escaped
        assert!(styles.contains("\\\"Fancy\\\""), "should escape quotes in title");
    }

    #[test]
    fn test_generate_typst_styles_no_title() {
        let presets = crate::export::typography::TypographyPresets::default();
        let options = TemplateOptions {
            template: Template::Clean,
            title: "".to_string(),
            include_toc: false,
            include_page_numbers: false,
            page_size: PageSize::A4,
        };
        let styles = generate_typst_styles("Content.", &presets, &options);
        // Should not contain a title alignment block
        assert!(!styles.contains("#align(center)"), "should not render title block for empty title");
    }

    #[test]
    fn test_pptx_template_configs_differ() {
        let simple = PptxTemplate::Simple.config();
        let business = PptxTemplate::Business.config();
        let report = PptxTemplate::Report.config();

        // Simple has no slide numbers, Business and Report do
        assert!(!simple.show_slide_numbers);
        assert!(business.show_slide_numbers);
        assert!(report.show_slide_numbers);

        // Only Business has header line
        assert!(!simple.show_header_line);
        assert!(business.show_header_line);
        assert!(!report.show_header_line);

        // Only Report has dark title slide
        assert!(!simple.dark_title_slide);
        assert!(!business.dark_title_slide);
        assert!(report.dark_title_slide);

        // Title sizes differ between Simple/Report (44) and Business (40)
        assert_eq!(simple.title_size, 44);
        assert_eq!(business.title_size, 40);
        assert_eq!(report.title_size, 44);

        // Report title color is white (for dark background)
        assert_eq!(report.title_color, "FFFFFF");
        assert_ne!(simple.title_color, "FFFFFF");
    }
}
