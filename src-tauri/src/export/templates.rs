/// Template preset names.
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

/// Options for applying a template to Typst content.
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
}
