//! Typography presets for WYSIWYG export styling.
//!
//! Provides a `TypographyPresets` struct that mirrors the frontend's editor
//! typography settings. Export commands accept these presets to generate
//! consistent styling across PDF (Typst), DOCX, and HTML exports.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/// Typography presets received from the frontend editor styles.
/// Uses camelCase for JSON deserialization from the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypographyPresets {
    pub paragraph: TextStyle,
    pub heading1: TextStyle,
    pub heading2: TextStyle,
    pub heading3: TextStyle,
    pub heading4: TextStyle,
    pub heading5: TextStyle,
    pub heading6: TextStyle,
    #[serde(default = "default_code_font")]
    pub code_font_family: String,
}

/// Style definition for a single text element (paragraph or heading level).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u32,
    pub line_height: f64,
    #[serde(default)]
    pub paragraph_spacing: f64,
}

fn default_code_font() -> String {
    "JetBrains Mono".to_string()
}

impl Default for TypographyPresets {
    fn default() -> Self {
        Self {
            paragraph: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 400,
                line_height: 1.7,
                paragraph_spacing: 0.75,
            },
            heading1: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 32.0,
                font_weight: 700,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            heading2: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 24.0,
                font_weight: 600,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            heading3: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 20.0,
                font_weight: 600,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            heading4: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 18.0,
                font_weight: 600,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            heading5: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 16.0,
                font_weight: 600,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            heading6: TextStyle {
                font_family: "Inter".to_string(),
                font_size: 14.0,
                font_weight: 600,
                line_height: 1.3,
                paragraph_spacing: 0.5,
            },
            code_font_family: "JetBrains Mono".to_string(),
        }
    }
}

impl TypographyPresets {
    /// Get the text style for a heading level (1-6).
    pub fn heading(&self, level: u8) -> &TextStyle {
        match level {
            1 => &self.heading1,
            2 => &self.heading2,
            3 => &self.heading3,
            4 => &self.heading4,
            5 => &self.heading5,
            6 => &self.heading6,
            _ => &self.paragraph,
        }
    }
}

// ---------------------------------------------------------------------------
// Font resolution for export formats
// ---------------------------------------------------------------------------

/// Target export format for font resolution.
pub enum ExportFormat {
    Docx,
    Html,
}

/// Resolve a frontend font family name to the correct name for the target
/// export format. The bundled fonts have specific names that may differ
/// from what the frontend uses.
pub fn resolve_font_family(font_family: &str, _format: ExportFormat) -> &str {
    // Map common frontend font names to bundled font names
    match font_family {
        "Source Serif 4" | "Source Serif Pro" | "source-serif-4" => "Source Serif 4",
        "Inter" | "inter" => "Inter",
        "JetBrains Mono" | "jetbrains-mono" => "JetBrains Mono",
        // System fonts — pass through as-is
        _ => font_family,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_presets() {
        let presets = TypographyPresets::default();
        assert_eq!(presets.paragraph.font_family, "Inter");
        assert_eq!(presets.paragraph.font_size, 16.0);
        assert_eq!(presets.heading1.font_size, 32.0);
        assert_eq!(presets.heading1.font_weight, 700);
        assert_eq!(presets.code_font_family, "JetBrains Mono");
    }

    #[test]
    fn test_heading_accessor() {
        let presets = TypographyPresets::default();
        assert_eq!(presets.heading(1).font_size, 32.0);
        assert_eq!(presets.heading(2).font_size, 24.0);
        assert_eq!(presets.heading(6).font_size, 14.0);
        // Out of range falls back to paragraph
        assert_eq!(presets.heading(7).font_size, 16.0);
    }

    #[test]
    fn test_deserialize_from_json() {
        let json = r#"{
            "paragraph": { "fontFamily": "Source Serif 4", "fontSize": 18, "fontWeight": 400, "lineHeight": 1.8, "paragraphSpacing": 1.0 },
            "heading1": { "fontFamily": "Source Serif 4", "fontSize": 36, "fontWeight": 700, "lineHeight": 1.2, "paragraphSpacing": 0.5 },
            "heading2": { "fontFamily": "Source Serif 4", "fontSize": 28, "fontWeight": 600, "lineHeight": 1.3, "paragraphSpacing": 0.5 },
            "heading3": { "fontFamily": "Source Serif 4", "fontSize": 22, "fontWeight": 600, "lineHeight": 1.3, "paragraphSpacing": 0.5 },
            "heading4": { "fontFamily": "Source Serif 4", "fontSize": 18, "fontWeight": 600, "lineHeight": 1.3, "paragraphSpacing": 0.5 },
            "heading5": { "fontFamily": "Source Serif 4", "fontSize": 16, "fontWeight": 600, "lineHeight": 1.3, "paragraphSpacing": 0.5 },
            "heading6": { "fontFamily": "Source Serif 4", "fontSize": 14, "fontWeight": 600, "lineHeight": 1.3, "paragraphSpacing": 0.5 },
            "codeFontFamily": "Fira Code"
        }"#;
        let presets: TypographyPresets = serde_json::from_str(json).unwrap();
        assert_eq!(presets.paragraph.font_family, "Source Serif 4");
        assert_eq!(presets.paragraph.font_size, 18.0);
        assert_eq!(presets.code_font_family, "Fira Code");
    }

    #[test]
    fn test_resolve_font_family() {
        assert_eq!(resolve_font_family("Inter", ExportFormat::Html), "Inter");
        assert_eq!(resolve_font_family("Source Serif Pro", ExportFormat::Docx), "Source Serif 4");
        assert_eq!(resolve_font_family("Custom Font", ExportFormat::Html), "Custom Font");
    }
}
