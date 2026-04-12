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
