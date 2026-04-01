//! Document page settings for header/footer configuration.
//!
//! Shared types used by PDF (Typst), DOCX, and HTML exporters to generate
//! custom headers and footers with variable interpolation.

use serde::{Deserialize, Serialize};

/// Three-column content (left/center/right).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreeColumns {
    #[serde(default)]
    pub left: String,
    #[serde(default)]
    pub center: String,
    #[serde(default)]
    pub right: String,
}

/// Header or footer configuration with left/center/right columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageHeaderFooter {
    #[serde(default)]
    pub left: String,
    #[serde(default)]
    pub center: String,
    #[serde(default)]
    pub right: String,
    #[serde(default)]
    pub different_first_page: bool,
    #[serde(default)]
    pub first_page: Option<ThreeColumns>,
    #[serde(default)]
    pub different_odd_even: bool,
    #[serde(default)]
    pub odd_page: Option<ThreeColumns>,
    #[serde(default)]
    pub even_page: Option<ThreeColumns>,
}

/// Complete document page settings (header + footer).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPageSettings {
    #[serde(default = "default_header_footer")]
    pub header: PageHeaderFooter,
    #[serde(default = "default_header_footer")]
    pub footer: PageHeaderFooter,
    #[serde(default = "default_page_number_start")]
    pub page_number_start: u32,
}

fn default_page_number_start() -> u32 { 1 }

fn default_header_footer() -> PageHeaderFooter {
    PageHeaderFooter {
        left: String::new(),
        center: String::new(),
        right: String::new(),
        different_first_page: false,
        first_page: None,
        different_odd_even: false,
        odd_page: None,
        even_page: None,
    }
}

/// Get effective columns for a given display page number.
#[allow(dead_code)]
pub fn get_effective_columns<'a>(hf: &'a PageHeaderFooter, display_page: u32) -> (&'a str, &'a str, &'a str) {
    if display_page == 1 && hf.different_first_page {
        if let Some(ref fp) = hf.first_page {
            return (&fp.left, &fp.center, &fp.right);
        }
    }
    if hf.different_odd_even {
        if display_page % 2 == 1 {
            if let Some(ref op) = hf.odd_page {
                return (&op.left, &op.center, &op.right);
            }
        } else {
            if let Some(ref ep) = hf.even_page {
                return (&ep.left, &ep.center, &ep.right);
            }
        }
    }
    (&hf.left, &hf.center, &hf.right)
}

/// Context for resolving template variables like `{page}`, `{title}`, etc.
pub struct VariableContext<'a> {
    pub page: &'a str,
    pub pages: &'a str,
    pub title: &'a str,
    pub date: &'a str,
}

/// Replace template variables in a string with their resolved values.
pub fn resolve_variables(template: &str, ctx: &VariableContext) -> String {
    template
        .replace("{page}", ctx.page)
        .replace("{pages}", ctx.pages)
        .replace("{title}", ctx.title)
        .replace("{date}", ctx.date)
}

/// Check whether a header/footer has any non-empty content.
pub fn has_content(hf: &PageHeaderFooter) -> bool {
    !hf.left.is_empty() || !hf.center.is_empty() || !hf.right.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_variables_all() {
        let ctx = VariableContext {
            page: "3",
            pages: "10",
            title: "My Doc",
            date: "2026-03-31",
        };
        assert_eq!(
            resolve_variables("Page {page} of {pages}", &ctx),
            "Page 3 of 10"
        );
        assert_eq!(resolve_variables("{title}", &ctx), "My Doc");
        assert_eq!(resolve_variables("{date}", &ctx), "2026-03-31");
    }

    #[test]
    fn test_resolve_variables_no_vars() {
        let ctx = VariableContext {
            page: "1",
            pages: "5",
            title: "T",
            date: "D",
        };
        assert_eq!(resolve_variables("Plain text", &ctx), "Plain text");
        assert_eq!(resolve_variables("", &ctx), "");
    }

    #[test]
    fn test_has_content() {
        let empty = PageHeaderFooter {
            left: String::new(),
            center: String::new(),
            right: String::new(),
            different_first_page: false,
            first_page: None,
        };
        assert!(!has_content(&empty));

        let with_center = PageHeaderFooter {
            left: String::new(),
            center: "Title".to_string(),
            right: String::new(),
            different_first_page: false,
            first_page: None,
        };
        assert!(has_content(&with_center));
    }

    #[test]
    fn test_deserialize_full_settings() {
        let json = r#"{
            "header": {
                "left": "My Report",
                "center": "",
                "right": "Page {page}",
                "differentFirstPage": true,
                "firstPage": { "left": "", "center": "{title}", "right": "" }
            },
            "footer": {
                "left": "{date}",
                "center": "",
                "right": "{page} / {pages}"
            }
        }"#;

        let settings: DocumentPageSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.header.left, "My Report");
        assert_eq!(settings.header.right, "Page {page}");
        assert!(settings.header.different_first_page);
        let fp = settings.header.first_page.unwrap();
        assert_eq!(fp.center, "{title}");
        assert_eq!(settings.footer.left, "{date}");
        assert_eq!(settings.footer.right, "{page} / {pages}");
    }

    #[test]
    fn test_deserialize_minimal_empty() {
        let json = r#"{}"#;
        let settings: DocumentPageSettings = serde_json::from_str(json).unwrap();
        assert!(settings.header.left.is_empty());
        assert!(settings.footer.right.is_empty());
        assert!(!settings.header.different_first_page);
    }

    #[test]
    fn test_deserialize_partial_fields() {
        let json = r#"{ "header": { "right": "Page {page}" } }"#;
        let settings: DocumentPageSettings = serde_json::from_str(json).unwrap();
        assert!(settings.header.left.is_empty());
        assert_eq!(settings.header.right, "Page {page}");
        assert!(settings.footer.left.is_empty());
    }

    #[test]
    fn test_resolve_variables_unknown_pass_through() {
        let ctx = VariableContext {
            page: "1", pages: "5", title: "T", date: "D",
        };
        assert_eq!(resolve_variables("{unknown}", &ctx), "{unknown}");
        assert_eq!(resolve_variables("{page} {custom}", &ctx), "1 {custom}");
    }

    #[test]
    fn test_resolve_variables_multiple_occurrences() {
        let ctx = VariableContext {
            page: "2", pages: "8", title: "Report", date: "2026-04-01",
        };
        assert_eq!(resolve_variables("{page}/{page}", &ctx), "2/2");
    }

    #[test]
    fn test_serialize_round_trip() {
        let json = r#"{
            "header": { "left": "Title", "center": "", "right": "{page}", "differentFirstPage": false },
            "footer": { "left": "", "center": "Confidential", "right": "" }
        }"#;
        let settings: DocumentPageSettings = serde_json::from_str(json).unwrap();
        let reserialized = serde_json::to_string(&settings).unwrap();
        let reparsed: DocumentPageSettings = serde_json::from_str(&reserialized).unwrap();
        assert_eq!(reparsed.header.left, "Title");
        assert_eq!(reparsed.header.right, "{page}");
        assert_eq!(reparsed.footer.center, "Confidential");
    }
}
