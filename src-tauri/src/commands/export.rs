use crate::export::html_styles::{html_css, wrap_html_document};
use crate::export::markdown_to_docx::{markdown_to_docx, DocxOptions};
use crate::export::markdown_to_html::markdown_to_html;
use crate::export::markdown_to_pptx::markdown_to_pptx;
use crate::export::page_settings::DocumentPageSettings;
use crate::export::typography::TypographyPresets;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A pre-rendered PNG image captured from the frontend (chart, drawing, or mermaid).
/// Passed positionally — index N corresponds to the Nth chart/excalidraw/mermaid
/// fenced code block encountered during the comrak AST walk.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmbeddedImage {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Convert markdown to PPTX bytes.
#[tauri::command]
pub async fn export_pptx(
    markdown: String,
    title: String,
    template: String,
    project_root: Option<String>,
    embedded_images: Option<Vec<EmbeddedImage>>,
) -> Result<Vec<u8>, String> {
    markdown_to_pptx(
        &markdown,
        &title,
        &template,
        project_root.as_deref(),
        embedded_images.as_deref(),
    )
}

/// Convert markdown to DOCX bytes.
#[tauri::command]
pub async fn export_docx(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
    typography: Option<TypographyPresets>,
    page_settings: Option<DocumentPageSettings>,
    _embedded_svgs: Option<Vec<String>>,
    embedded_images: Option<Vec<EmbeddedImage>>,
) -> Result<Vec<u8>, String> {
    let options = DocxOptions {
        include_toc,
        include_page_numbers,
        page_size,
        project_root,
    };
    markdown_to_docx(&markdown, &title, &template, &options, typography.as_ref(), page_settings.as_ref(), embedded_images.as_deref())
}

/// Render markdown to a complete HTML document or body fragment.
#[tauri::command]
pub async fn render_html(
    markdown: String,
    title: String,
    theme: String,
    include_styles: bool,
    project_root: Option<String>,
    typography: Option<TypographyPresets>,
    page_settings: Option<DocumentPageSettings>,
    embedded_svgs: Option<Vec<String>>,
) -> Result<String, String> {
    let body = markdown_to_html(&markdown, &theme, project_root.as_deref(), embedded_svgs.as_deref());

    if include_styles {
        let base_css = html_css(&theme);
        // Generate typography override CSS if presets are provided
        let presets = typography.unwrap_or_default();
        let typography_css = generate_html_typography_css(&presets);
        // Generate header/footer CSS if page settings are provided
        let hf_css = page_settings.as_ref()
            .map(|ps| generate_html_header_footer_css(ps, &title))
            .unwrap_or_default();
        let css = format!("{}\n{}\n{}", base_css, typography_css, hf_css);

        // Generate visible header/footer HTML elements for screen viewing
        let hf_html = page_settings.as_ref()
            .map(|ps| generate_html_header_footer_elements(ps, &title))
            .unwrap_or_default();

        Ok(wrap_html_document(&body, &title, &theme, &css, &hf_html))
    } else {
        // Clipboard mode: return body fragment only
        Ok(body)
    }
}

/// Generate CSS for `@page` rules and visible header/footer from page settings.
fn generate_html_header_footer_css(
    settings: &DocumentPageSettings,
    title: &str,
) -> String {
    use crate::export::page_settings::{has_content, resolve_variables, VariableContext};

    let today = chrono::Local::now().format("%B %d, %Y").to_string();
    let ctx = VariableContext {
        page: "counter(page)",
        pages: "counter(pages)",
        title,
        date: &today,
    };

    let mut css = String::new();

    // @page rules for print (CSS Paged Media)
    css.push_str("\n/* Page header/footer for print */\n");

    if has_content(&settings.header) || has_content(&settings.footer) {
        css.push_str("@page {\n");
        // Header columns
        if !settings.header.left.is_empty() {
            let val = resolve_variables(&settings.header.left, &ctx);
            css.push_str(&format!("  @top-left {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        if !settings.header.center.is_empty() {
            let val = resolve_variables(&settings.header.center, &ctx);
            css.push_str(&format!("  @top-center {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        if !settings.header.right.is_empty() {
            let val = resolve_variables(&settings.header.right, &ctx);
            css.push_str(&format!("  @top-right {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        // Footer columns
        if !settings.footer.left.is_empty() {
            let val = resolve_variables(&settings.footer.left, &ctx);
            css.push_str(&format!("  @bottom-left {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        if !settings.footer.center.is_empty() {
            let val = resolve_variables(&settings.footer.center, &ctx);
            css.push_str(&format!("  @bottom-center {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        if !settings.footer.right.is_empty() {
            let val = resolve_variables(&settings.footer.right, &ctx);
            css.push_str(&format!("  @bottom-right {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&val)));
        }
        css.push_str("}\n");
    }

    // @page :first rules for different first page
    if settings.header.different_first_page || settings.footer.different_first_page {
        css.push_str("@page :first {\n");
        if settings.header.different_first_page {
            if let Some(ref fp) = settings.header.first_page {
                let fp_ctx = VariableContext {
                    page: "counter(page)",
                    pages: "counter(pages)",
                    title,
                    date: &today,
                };
                if fp.left.is_empty() && fp.center.is_empty() && fp.right.is_empty() {
                    // Empty first page header
                    css.push_str("  @top-left { content: none; }\n");
                    css.push_str("  @top-center { content: none; }\n");
                    css.push_str("  @top-right { content: none; }\n");
                } else {
                    if !fp.left.is_empty() {
                        css.push_str(&format!("  @top-left {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.left, &fp_ctx))));
                    } else {
                        css.push_str("  @top-left { content: none; }\n");
                    }
                    if !fp.center.is_empty() {
                        css.push_str(&format!("  @top-center {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.center, &fp_ctx))));
                    } else {
                        css.push_str("  @top-center { content: none; }\n");
                    }
                    if !fp.right.is_empty() {
                        css.push_str(&format!("  @top-right {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.right, &fp_ctx))));
                    } else {
                        css.push_str("  @top-right { content: none; }\n");
                    }
                }
            } else {
                // No first page config means suppress header on first page
                css.push_str("  @top-left { content: none; }\n");
                css.push_str("  @top-center { content: none; }\n");
                css.push_str("  @top-right { content: none; }\n");
            }
        }
        if settings.footer.different_first_page {
            if let Some(ref fp) = settings.footer.first_page {
                let fp_ctx = VariableContext {
                    page: "counter(page)",
                    pages: "counter(pages)",
                    title,
                    date: &today,
                };
                if fp.left.is_empty() && fp.center.is_empty() && fp.right.is_empty() {
                    css.push_str("  @bottom-left { content: none; }\n");
                    css.push_str("  @bottom-center { content: none; }\n");
                    css.push_str("  @bottom-right { content: none; }\n");
                } else {
                    if !fp.left.is_empty() {
                        css.push_str(&format!("  @bottom-left {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.left, &fp_ctx))));
                    } else {
                        css.push_str("  @bottom-left { content: none; }\n");
                    }
                    if !fp.center.is_empty() {
                        css.push_str(&format!("  @bottom-center {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.center, &fp_ctx))));
                    } else {
                        css.push_str("  @bottom-center { content: none; }\n");
                    }
                    if !fp.right.is_empty() {
                        css.push_str(&format!("  @bottom-right {{ content: \"{}\"; font-size: 9pt; color: #888; }}\n", css_escape(&resolve_variables(&fp.right, &fp_ctx))));
                    } else {
                        css.push_str("  @bottom-right { content: none; }\n");
                    }
                }
            } else {
                css.push_str("  @bottom-left { content: none; }\n");
                css.push_str("  @bottom-center { content: none; }\n");
                css.push_str("  @bottom-right { content: none; }\n");
            }
        }
        css.push_str("}\n");
    }

    // Visible header/footer styles for screen viewing
    css.push_str(r#"
/* Visible header/footer for screen */
.notesage-page-header, .notesage-page-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 24px;
  font-size: 0.75em;
  color: var(--muted-fg, #888);
}
.notesage-page-header {
  border-bottom: 1px solid var(--border, #e5e5e5);
  margin-bottom: 0;
}
.notesage-page-footer {
  border-top: 1px solid var(--border, #e5e5e5);
  margin-top: 0;
}
.notesage-page-header span, .notesage-page-footer span {
  flex: 1;
}
.notesage-page-header span:nth-child(2), .notesage-page-footer span:nth-child(2) {
  text-align: center;
}
.notesage-page-header span:nth-child(3), .notesage-page-footer span:nth-child(3) {
  text-align: right;
}
@media print {
  .notesage-page-header, .notesage-page-footer { display: none; }
}
"#);

    css
}

/// Generate visible HTML header/footer elements for screen viewing.
fn generate_html_header_footer_elements(
    settings: &DocumentPageSettings,
    title: &str,
) -> String {
    use crate::export::page_settings::{has_content, resolve_variables, VariableContext};

    let today = chrono::Local::now().format("%B %d, %Y").to_string();
    let ctx = VariableContext {
        page: "",
        pages: "",
        title,
        date: &today,
    };

    let mut html = String::new();

    if has_content(&settings.header) {
        let left = html_escape_content(&resolve_variables(&settings.header.left, &ctx));
        let center = html_escape_content(&resolve_variables(&settings.header.center, &ctx));
        let right = html_escape_content(&resolve_variables(&settings.header.right, &ctx));
        html.push_str(&format!(
            "<div class=\"notesage-page-header\"><span>{}</span><span>{}</span><span>{}</span></div>\n",
            left, center, right
        ));
    }

    // The body content goes between header and footer (handled by wrap_html_document)
    // Footer marker — will be placed after body
    if has_content(&settings.footer) {
        let left = html_escape_content(&resolve_variables(&settings.footer.left, &ctx));
        let center = html_escape_content(&resolve_variables(&settings.footer.center, &ctx));
        let right = html_escape_content(&resolve_variables(&settings.footer.right, &ctx));
        html.push_str(&format!(
            "<div class=\"notesage-page-footer\"><span>{}</span><span>{}</span><span>{}</span></div>\n",
            left, center, right
        ));
    }

    html
}

/// Escape special characters for CSS string values.
fn css_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\A ")
}

/// Escape HTML special characters in content text.
fn html_escape_content(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Generate CSS overrides from typography presets for HTML export.
fn generate_html_typography_css(presets: &TypographyPresets) -> String {
    use crate::export::typography::{resolve_font_family, ExportFormat};

    let p = &presets.paragraph;
    let body_font = resolve_font_family(&p.font_family, ExportFormat::Html);
    let code_font = resolve_font_family(&presets.code_font_family, ExportFormat::Html);

    let mut css = String::new();
    css.push_str(&format!(
        "body {{ font-family: \"{}\", system-ui, sans-serif; font-size: {}px; line-height: {}; }}\n",
        body_font, p.font_size, p.line_height
    ));
    css.push_str(&format!(
        "p {{ margin-bottom: {}em; }}\n",
        p.paragraph_spacing
    ));

    for level in 1..=6u8 {
        let h = presets.heading(level);
        let font = resolve_font_family(&h.font_family, ExportFormat::Html);
        css.push_str(&format!(
            "h{} {{ font-family: \"{}\", system-ui, sans-serif; font-size: {}px; font-weight: {}; line-height: {}; }}\n",
            level, font, h.font_size, h.font_weight, h.line_height
        ));
    }

    css.push_str(&format!(
        "pre, code {{ font-family: \"{}\", monospace; }}\n",
        code_font
    ));

    css
}

/// Write binary data to a file on disk.
#[tauri::command]
pub async fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write file: {}", e))
}

// --- PPTX Template Management ---

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PptxTemplateInfo {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub path: String,
    pub date_added: String,
}

/// Built-in PPTX template definitions.
const BUILTIN_PPTX_TEMPLATES: &[(&str, &str)] = &[
    ("simple", "Simple"),
    ("business", "Business"),
    ("report", "Report"),
];

/// Sanitize a filename: keep only alphanumeric, hyphens, and underscores.
fn sanitize_filename(name: &str) -> String {
    let stem = std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let sanitized: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "template".to_string()
    } else {
        sanitized
    }
}

/// Resolve the templates directory for a given scope.
fn templates_dir(scope: &str, project_root: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        "global" => {
            let home = dirs::home_dir().ok_or("Could not determine home directory")?;
            Ok(home.join(".notesage").join("pptx-templates"))
        }
        "project" => {
            let root = project_root.ok_or("project_root is required for project scope")?;
            Ok(PathBuf::from(root)
                .join(".notesage")
                .join("pptx-templates"))
        }
        _ => Err(format!("Invalid scope: {}", scope)),
    }
}

/// Read the templates.json index from a directory. Returns empty vec if file doesn't exist.
fn read_templates_index(dir: &PathBuf) -> Vec<PptxTemplateInfo> {
    let index_path = dir.join("templates.json");
    if !index_path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(&index_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Write the templates.json index to a directory.
fn write_templates_index(dir: &PathBuf, templates: &[PptxTemplateInfo]) -> Result<(), String> {
    let index_path = dir.join("templates.json");
    let json = serde_json::to_string_pretty(templates)
        .map_err(|e| format!("Failed to serialize templates index: {}", e))?;
    std::fs::write(&index_path, json)
        .map_err(|e| format!("Failed to write templates index: {}", e))
}

/// Import a user PPTX template file into the global or project templates directory.
#[tauri::command]
pub async fn import_pptx_template(
    source_path: String,
    scope: String,
    project_root: Option<String>,
) -> Result<PptxTemplateInfo, String> {
    // Validate source file exists
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    // Validate it's a valid ZIP (PPTX magic bytes PK\x03\x04)
    let header = std::fs::read(&source)
        .map_err(|e| format!("Failed to read source file: {}", e))?;
    if header.len() < 4 || &header[..4] != b"PK\x03\x04" {
        return Err("Invalid PPTX file: not a valid ZIP archive".to_string());
    }

    // Determine target directory
    let dir = templates_dir(&scope, project_root.as_deref())?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create templates directory: {}", e))?;

    // Sanitize filename and build target path
    let original_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("template.pptx")
        .to_string();
    let id = sanitize_filename(&original_name);
    let target_filename = format!("{}.pptx", id);
    let target_path = dir.join(&target_filename);

    // Copy the file
    std::fs::copy(&source, &target_path)
        .map_err(|e| format!("Failed to copy template file: {}", e))?;

    // Build template info
    let now = chrono::Local::now()
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    let info = PptxTemplateInfo {
        id: id.clone(),
        name: original_name,
        scope: scope.clone(),
        path: target_path.to_string_lossy().to_string(),
        date_added: now,
    };

    // Update templates.json index
    let mut templates = read_templates_index(&dir);
    // Remove existing entry with same id (overwrite)
    templates.retain(|t| t.id != id);
    templates.push(info.clone());
    write_templates_index(&dir, &templates)?;

    Ok(info)
}

/// List all available PPTX templates (built-in + global user + project user).
/// Project templates with the same id override global ones.
#[tauri::command]
pub async fn list_pptx_templates(
    project_root: Option<String>,
) -> Result<Vec<PptxTemplateInfo>, String> {
    let mut result: Vec<PptxTemplateInfo> = Vec::new();

    // 1. Built-in templates
    for (id, name) in BUILTIN_PPTX_TEMPLATES {
        result.push(PptxTemplateInfo {
            id: id.to_string(),
            name: name.to_string(),
            scope: "builtin".to_string(),
            path: String::new(),
            date_added: String::new(),
        });
    }

    // 2. Global user templates
    if let Ok(global_dir) = templates_dir("global", None) {
        let global_templates = read_templates_index(&global_dir);
        for t in global_templates {
            // Override built-in with same id
            result.retain(|existing| existing.id != t.id);
            result.push(t);
        }
    }

    // 3. Project user templates
    if let Some(ref root) = project_root {
        if let Ok(project_dir) = templates_dir("project", Some(root)) {
            let project_templates = read_templates_index(&project_dir);
            for t in project_templates {
                // Override global/builtin with same id
                result.retain(|existing| existing.id != t.id);
                result.push(t);
            }
        }
    }

    Ok(result)
}

/// Delete a user-uploaded PPTX template.
#[tauri::command]
pub async fn delete_pptx_template(
    template_id: String,
    scope: String,
    project_root: Option<String>,
) -> Result<(), String> {
    if scope == "builtin" {
        return Err("Cannot delete built-in templates".to_string());
    }

    let dir = templates_dir(&scope, project_root.as_deref())?;

    // Remove the .pptx file
    let file_path = dir.join(format!("{}.pptx", template_id));
    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete template file: {}", e))?;
    }

    // Remove from templates.json index
    let mut templates = read_templates_index(&dir);
    templates.retain(|t| t.id != template_id);
    write_templates_index(&dir, &templates)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename_basic() {
        assert_eq!(sanitize_filename("my-template.pptx"), "my-template");
        assert_eq!(sanitize_filename("My Template.pptx"), "My_Template");
        assert_eq!(sanitize_filename("hello_world"), "hello_world");
    }

    #[test]
    fn test_sanitize_filename_special_chars() {
        assert_eq!(sanitize_filename("a@b#c$d.pptx"), "a_b_c_d");
        // Accented chars are alphanumeric in Unicode, so they're preserved
        assert_eq!(sanitize_filename("café résumé.pptx"), "café_résumé");
    }

    #[test]
    fn test_sanitize_filename_empty() {
        // "..." → file_stem is ".." → dots become underscores → "__"
        assert_eq!(sanitize_filename("..."), "__");
        // ".pptx" → file_stem is None/empty, falls back to full name → "_pptx"
        assert_eq!(sanitize_filename(".pptx"), "_pptx");
        // Truly empty string
        assert_eq!(sanitize_filename(""), "template");
    }

    #[test]
    fn test_sanitize_filename_preserves_valid() {
        assert_eq!(sanitize_filename("ABC-123_test.pptx"), "ABC-123_test");
    }

    #[test]
    fn test_templates_index_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let dir_path = dir.path().to_path_buf();

        let templates = vec![
            PptxTemplateInfo {
                id: "test-1".to_string(),
                name: "Test One.pptx".to_string(),
                scope: "global".to_string(),
                path: "/tmp/test-1.pptx".to_string(),
                date_added: "2026-03-30T12:00:00".to_string(),
            },
            PptxTemplateInfo {
                id: "test-2".to_string(),
                name: "Test Two.pptx".to_string(),
                scope: "global".to_string(),
                path: "/tmp/test-2.pptx".to_string(),
                date_added: "2026-03-30T13:00:00".to_string(),
            },
        ];

        write_templates_index(&dir_path, &templates).unwrap();
        let loaded = read_templates_index(&dir_path);

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "test-1");
        assert_eq!(loaded[0].name, "Test One.pptx");
        assert_eq!(loaded[1].id, "test-2");
    }

    #[test]
    fn test_read_templates_index_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let dir_path = dir.path().to_path_buf();
        let loaded = read_templates_index(&dir_path);
        assert!(loaded.is_empty());
    }

    #[test]
    fn test_read_templates_index_invalid_json() {
        let dir = tempfile::tempdir().unwrap();
        let dir_path = dir.path().to_path_buf();
        std::fs::write(dir_path.join("templates.json"), "not json").unwrap();
        let loaded = read_templates_index(&dir_path);
        assert!(loaded.is_empty());
    }

    #[tokio::test]
    async fn test_list_builtin_templates() {
        let result = list_pptx_templates(None).await.unwrap();
        assert!(result.len() >= 3);

        let ids: Vec<&str> = result.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"simple"));
        assert!(ids.contains(&"business"));
        assert!(ids.contains(&"report"));

        let simple = result.iter().find(|t| t.id == "simple").unwrap();
        assert_eq!(simple.scope, "builtin");
        assert!(simple.path.is_empty());
        assert!(simple.date_added.is_empty());
    }

    #[tokio::test]
    async fn test_import_invalid_file() {
        let dir = tempfile::tempdir().unwrap();
        let bad_file = dir.path().join("not-a-pptx.pptx");
        std::fs::write(&bad_file, b"this is not a zip").unwrap();

        let result = import_pptx_template(
            bad_file.to_string_lossy().to_string(),
            "global".to_string(),
            None,
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a valid ZIP"));
    }

    #[tokio::test]
    async fn test_import_and_delete_template() {
        let dir = tempfile::tempdir().unwrap();

        // Create a fake PPTX file (valid ZIP magic bytes)
        let source_file = dir.path().join("My Template.pptx");
        let mut data = vec![0x50, 0x4B, 0x03, 0x04]; // PK\x03\x04
        data.extend_from_slice(&[0u8; 100]);
        std::fs::write(&source_file, &data).unwrap();

        // Create a target directory to use as "home"
        let templates_root = dir.path().join("project-root");
        std::fs::create_dir_all(&templates_root).unwrap();

        let result = import_pptx_template(
            source_file.to_string_lossy().to_string(),
            "project".to_string(),
            Some(templates_root.to_string_lossy().to_string()),
        )
        .await
        .unwrap();

        assert_eq!(result.id, "My_Template");
        assert_eq!(result.name, "My Template.pptx");
        assert_eq!(result.scope, "project");
        assert!(!result.date_added.is_empty());

        // Verify the file was copied
        let expected_path = templates_root
            .join(".notesage")
            .join("pptx-templates")
            .join("My_Template.pptx");
        assert!(expected_path.exists());

        // Verify templates.json was created
        let index = read_templates_index(
            &templates_root
                .join(".notesage")
                .join("pptx-templates"),
        );
        assert_eq!(index.len(), 1);
        assert_eq!(index[0].id, "My_Template");

        // Delete the template
        delete_pptx_template(
            "My_Template".to_string(),
            "project".to_string(),
            Some(templates_root.to_string_lossy().to_string()),
        )
        .await
        .unwrap();

        assert!(!expected_path.exists());
        let index = read_templates_index(
            &templates_root
                .join(".notesage")
                .join("pptx-templates"),
        );
        assert!(index.is_empty());
    }

    #[tokio::test]
    async fn test_list_with_project_override() {
        let dir = tempfile::tempdir().unwrap();
        let project_root = dir.path().join("project");
        let project_templates_dir = project_root
            .join(".notesage")
            .join("pptx-templates");
        std::fs::create_dir_all(&project_templates_dir).unwrap();

        // Add a project template that overrides the built-in "simple"
        let templates = vec![PptxTemplateInfo {
            id: "simple".to_string(),
            name: "Custom Simple.pptx".to_string(),
            scope: "project".to_string(),
            path: project_templates_dir
                .join("simple.pptx")
                .to_string_lossy()
                .to_string(),
            date_added: "2026-03-30T12:00:00".to_string(),
        }];
        write_templates_index(&project_templates_dir, &templates).unwrap();

        let result = list_pptx_templates(Some(
            project_root.to_string_lossy().to_string(),
        ))
        .await
        .unwrap();

        // "simple" should be the project version, not builtin
        let simple = result.iter().find(|t| t.id == "simple").unwrap();
        assert_eq!(simple.scope, "project");
        assert_eq!(simple.name, "Custom Simple.pptx");

        // Other builtins should still be present
        assert!(result.iter().any(|t| t.id == "business" && t.scope == "builtin"));
        assert!(result.iter().any(|t| t.id == "report" && t.scope == "builtin"));
    }

    #[tokio::test]
    async fn test_delete_builtin_rejected() {
        let result = delete_pptx_template(
            "simple".to_string(),
            "builtin".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot delete built-in"));
    }

    #[test]
    fn test_generate_html_typography_css_default_presets() {
        let presets = TypographyPresets::default();
        let css = generate_html_typography_css(&presets);

        // Body style
        assert!(css.contains("font-family:"), "should set body font-family");
        assert!(css.contains("Inter"), "should reference Inter font");
        assert!(css.contains("font-size: 16px"), "should set 16px body size");
        assert!(css.contains("line-height: 1.7"), "should set 1.7 line-height");

        // Paragraph spacing
        assert!(css.contains("margin-bottom: 0.75em"), "should set paragraph spacing");

        // All 6 heading levels
        for level in 1..=6 {
            assert!(
                css.contains(&format!("h{} {{", level)),
                "should contain h{} rule",
                level
            );
        }

        // Code font
        assert!(css.contains("JetBrains Mono"), "should reference code font");
        assert!(css.contains("pre, code"), "should style pre and code elements");
    }

    #[test]
    fn test_generate_html_typography_css_custom_presets() {
        use crate::export::typography::TextStyle;

        let presets = TypographyPresets {
            paragraph: TextStyle {
                font_family: "Source Serif 4".to_string(),
                font_size: 18.0,
                font_weight: 400,
                line_height: 1.8,
                paragraph_spacing: 1.2,
            },
            heading1: TextStyle {
                font_family: "Source Serif 4".to_string(),
                font_size: 36.0,
                font_weight: 700,
                line_height: 1.2,
                paragraph_spacing: 0.5,
            },
            code_font_family: "Fira Code".to_string(),
            ..TypographyPresets::default()
        };
        let css = generate_html_typography_css(&presets);

        assert!(css.contains("Source Serif 4"), "should use custom body font");
        assert!(css.contains("font-size: 18px"), "should use custom body size");
        assert!(css.contains("line-height: 1.8"), "should use custom line-height");
        assert!(css.contains("margin-bottom: 1.2em"), "should use custom paragraph spacing");
        assert!(css.contains("font-size: 36px"), "should use custom h1 size");
        assert!(css.contains("Fira Code"), "should use custom code font");
    }

    #[test]
    fn test_generate_html_typography_css_heading_properties() {
        let presets = TypographyPresets::default();
        let css = generate_html_typography_css(&presets);

        // h1 should have weight 700 (bold)
        assert!(css.contains("font-weight: 700"), "h1 should be bold");
        // h2 should have weight 600
        assert!(css.contains("font-weight: 600"), "h2+ should be semibold");
        // h1 font-size should be 32px
        assert!(css.contains("font-size: 32px"), "h1 should be 32px");
        // h6 font-size should be 14px
        assert!(css.contains("font-size: 14px"), "h6 should be 14px");
    }
}

// --- WKWebView PDF Export (macOS) ---

/// Convert an HTML string to PDF bytes using macOS WKWebView.createPDF.
/// This renders the HTML exactly as the browser engine would, producing
/// WYSIWYG-fidelity PDF output.
///
/// Parameters:
/// - `html`: A complete HTML document string (with embedded CSS).
/// - `page_width`: Page width in points (A4 = 595.28).
/// - `page_height`: Page height in points (A4 = 841.89).
///
/// This command is macOS-only. On other platforms it returns an error.
#[tauri::command]
pub async fn export_pdf_webkit(
    html: String,
    page_width: f64,
    page_height: f64,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        webkit_pdf::render_pdf_with_wkwebview(&html, page_width, page_height).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (html, page_width, page_height);
        Err("WKWebView PDF export is only available on macOS".to_string())
    }
}

#[cfg(target_os = "macos")]
mod webkit_pdf {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSData, NSError, NSString};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration};
    use std::sync::{Arc, Mutex};

    // Raw FFI bindings for Grand Central Dispatch.
    // These are stable C API symbols provided by libSystem on macOS.
    //
    // Note: `dispatch_get_main_queue()` is a C macro that resolves to
    // `&_dispatch_main_q`. We use the underlying symbol directly.
    #[link(name = "System", kind = "dylib")]
    extern "C" {
        #[link_name = "_dispatch_main_q"]
        static DISPATCH_MAIN_Q: std::ffi::c_void;

        fn dispatch_async_f(
            queue: *const std::ffi::c_void,
            context: *mut std::ffi::c_void,
            work: extern "C" fn(*mut std::ffi::c_void),
        );
        fn dispatch_after_f(
            when: u64,
            queue: *const std::ffi::c_void,
            context: *mut std::ffi::c_void,
            work: extern "C" fn(*mut std::ffi::c_void),
        );
        fn dispatch_time(when: u64, delta: i64) -> u64;
    }

    /// Returns a pointer to the main dispatch queue.
    fn main_queue() -> *const std::ffi::c_void {
        unsafe { &DISPATCH_MAIN_Q as *const std::ffi::c_void }
    }

    const DISPATCH_TIME_NOW: u64 = 0;

    /// Wrapper to safely send a main-thread-only Retained<WKWebView> across
    /// the Send boundary. This is safe because:
    /// 1. The webview is created on the main thread
    /// 2. All closures capturing it are dispatched exclusively to the main thread
    /// 3. The webview is only ever accessed on the main thread
    struct SendWebView(Retained<WKWebView>);

    // SAFETY: SendWebView is only ever moved between closures that execute on
    // the main thread (via dispatch_async/dispatch_after to the main queue).
    // The WKWebView is never actually accessed from a non-main thread.
    unsafe impl Send for SendWebView {}

    /// Helper to dispatch a boxed closure to the main queue.
    fn dispatch_main(f: Box<dyn FnOnce() + Send>) {
        extern "C" fn trampoline(ctx: *mut std::ffi::c_void) {
            let closure: Box<Box<dyn FnOnce() + Send>> = unsafe { Box::from_raw(ctx as *mut _) };
            closure();
        }
        let boxed: Box<Box<dyn FnOnce() + Send>> = Box::new(f);
        let raw = Box::into_raw(boxed) as *mut std::ffi::c_void;
        unsafe { dispatch_async_f(main_queue(), raw, trampoline) };
    }

    /// Helper to dispatch a boxed closure to the main queue after a delay.
    fn dispatch_main_after(delay_ns: i64, f: Box<dyn FnOnce() + Send>) {
        extern "C" fn trampoline(ctx: *mut std::ffi::c_void) {
            let closure: Box<Box<dyn FnOnce() + Send>> = unsafe { Box::from_raw(ctx as *mut _) };
            closure();
        }
        let boxed: Box<Box<dyn FnOnce() + Send>> = Box::new(f);
        let raw = Box::into_raw(boxed) as *mut std::ffi::c_void;
        unsafe {
            let when = dispatch_time(DISPATCH_TIME_NOW, delay_ns);
            dispatch_after_f(when, main_queue(), raw, trampoline);
        }
    }

    /// Renders HTML to PDF bytes via WKWebView on the main thread.
    ///
    /// Strategy:
    /// 1. Dispatch WKWebView creation + HTML load to the main thread
    /// 2. Poll `isLoading` on the main thread every 50ms
    /// 3. Once loaded, call `createPDF` and send result via oneshot channel
    pub async fn render_pdf_with_wkwebview(
        html: &str,
        page_width: f64,
        page_height: f64,
    ) -> Result<Vec<u8>, String> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
        let html = html.to_owned();
        let tx = Arc::new(Mutex::new(Some(tx)));

        let tx_clone = tx.clone();
        dispatch_main(Box::new(move || {
            // SAFETY: We are on the main thread (dispatched to main queue).
            let mtm = unsafe { MainThreadMarker::new_unchecked() };

            let config = unsafe { WKWebViewConfiguration::new(mtm) };
            let frame = CGRect::new(
                CGPoint::new(0.0, 0.0),
                CGSize::new(page_width, page_height),
            );
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
            };

            // Load the HTML string
            let ns_html = NSString::from_str(&html);
            unsafe {
                webview.loadHTMLString_baseURL(&ns_html, None);
            }

            // Start polling for load completion
            let send_wv = SendWebView(webview);
            poll_until_loaded(send_wv, page_width, page_height, tx_clone, 0);
        }));

        rx.await
            .map_err(|_| "PDF generation channel was dropped".to_string())?
    }

    /// Poll WKWebView.isLoading on the main thread. When loading is done,
    /// call createPDF. Times out after 30 seconds.
    fn poll_until_loaded(
        webview: SendWebView,
        page_width: f64,
        page_height: f64,
        tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>>>,
        attempt: u32,
    ) {
        const MAX_ATTEMPTS: u32 = 600; // 30s at 50ms intervals
        const POLL_INTERVAL_NS: i64 = 50_000_000; // 50ms

        if attempt >= MAX_ATTEMPTS {
            if let Some(sender) = tx.lock().unwrap().take() {
                let _ = sender.send(Err(
                    "WKWebView load timed out after 30 seconds".to_string(),
                ));
            }
            return;
        }

        let still_loading = unsafe { webview.0.isLoading() };
        if still_loading {
            // Schedule another check after 50ms
            dispatch_main_after(
                POLL_INTERVAL_NS,
                Box::new(move || {
                    poll_until_loaded(webview, page_width, page_height, tx, attempt + 1);
                }),
            );
        } else {
            // Loading complete — create PDF
            create_pdf(webview, page_width, page_height, tx);
        }
    }

    /// Call WKWebView.createPDF and send the result through the channel.
    fn create_pdf(
        webview: SendWebView,
        _page_width: f64,
        _page_height: f64,
        tx: Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<Vec<u8>, String>>>>>,
    ) {
        // SAFETY: We are on the main thread
        let mtm = unsafe { MainThreadMarker::new_unchecked() };

        let pdf_config = unsafe { WKPDFConfiguration::new(mtm) };

        // Leave the rect as the default null rect so WKWebView captures the
        // full page. The page_width/page_height were already used for the
        // WKWebView frame, which determines the layout viewport width.

        let tx_for_block = tx.clone();

        let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if !error.is_null() {
                let err = unsafe { &*error };
                let desc = err.localizedDescription();
                Err(format!("createPDF failed: {}", desc))
            } else if data.is_null() {
                Err("createPDF returned null data".to_string())
            } else {
                let ns_data = unsafe { &*data };
                Ok(ns_data.to_vec())
            };

            if let Some(sender) = tx_for_block.lock().unwrap().take() {
                let _ = sender.send(result);
            }
        });

        unsafe {
            webview
                .0
                .createPDFWithConfiguration_completionHandler(Some(&pdf_config), &completion);
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod webkit_pdf_tests {
    use super::*;

    // WKWebView requires GCD main queue blocks to be processed by the real
    // main thread. `cargo test` runs tests on worker threads, not the main
    // thread. This helper dispatches the test closure TO the main thread,
    // then pumps the run loop on the test thread to wait for completion.
    //
    // The approach: dispatch_sync to the main queue doesn't work from a test
    // thread because the main thread is blocked in the test harness. Instead,
    // we use dispatch_async and pump CFRunLoop from the test thread to process
    // main-queue blocks. But CFRunLoop only drains the main queue when called
    // from the actual main thread.
    //
    // Solution: use a global dispatch semaphore. The async work dispatches to
    // the main queue via our existing dispatch_main, and when it produces a
    // result we signal the semaphore. The test thread waits on the semaphore.
    //
    // But we still need the main thread to be running its run loop.
    // In `cargo test`, the main thread IS running the test harness, which
    // processes the main dispatch queue when idle. So dispatch_async to main
    // queue DOES work during cargo test -- the blocks just get processed
    // between test runs or during thread sleep.
    //
    // Actually, let's try the simplest approach: just use dispatch_async to
    // the GLOBAL concurrent queue for the WKWebView work (instead of main
    // queue), and do the main-thread operations via performSelectorOnMainThread.
    //
    // Wait -- the real solution is: in the test binary, the main thread IS
    // available for GCD. The test runner uses the main thread. However,
    // `cargo test` by default runs tests in parallel threads. The main thread
    // is actually running `main()` which calls the test framework.
    //
    // The GCD main queue IS processed -- it just needs someone to drain it.
    // Since macOS 10.12+, the main run loop automatically drains the main
    // GCD queue. The problem is nobody is running the main run loop in the
    // test binary.
    //
    // Final approach: we accept that these tests require a running app
    // environment and mark them as ignored by default. They can be run
    // manually with `cargo test -- --ignored` in a proper macOS environment.

    /// Test that export_pdf_webkit returns non-empty PDF bytes for simple HTML.
    ///
    /// This test is ignored by default because WKWebView requires a running
    /// main thread event loop (AppKit run loop) which is not available in
    /// `cargo test`. Run with `cargo test -- --ignored` in a proper macOS
    /// app environment, or test via the Tauri dev server.
    #[test]
    #[ignore = "requires macOS main thread run loop (WKWebView)"]
    fn test_export_pdf_webkit_simple_html() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(export_pdf_webkit(
            r#"<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><h1>Hello World</h1><p>This is a test document.</p></body>
</html>"#
                .to_string(),
            595.28,
            841.89,
        ));

        let pdf_bytes = result.expect("export_pdf_webkit should succeed");
        assert!(!pdf_bytes.is_empty(), "PDF bytes should not be empty");
        assert!(
            pdf_bytes.len() >= 5 && &pdf_bytes[..5] == b"%PDF-",
            "Output should be a valid PDF (starts with %PDF-), got {:?}",
            &pdf_bytes[..std::cmp::min(5, pdf_bytes.len())]
        );
    }

    /// Test with Letter page size.
    #[test]
    #[ignore = "requires macOS main thread run loop (WKWebView)"]
    fn test_export_pdf_webkit_letter_size() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(export_pdf_webkit(
            "<html><body><p>Letter size test</p></body></html>".to_string(),
            612.0,
            792.0,
        ));

        let pdf_bytes = result.expect("export_pdf_webkit should succeed");
        assert!(!pdf_bytes.is_empty(), "PDF bytes should not be empty");
        assert!(
            pdf_bytes.len() >= 5 && &pdf_bytes[..5] == b"%PDF-",
            "Output should be a valid PDF"
        );
    }

    /// Verify the command returns an error gracefully rather than panicking
    /// when called with empty HTML.
    #[test]
    #[ignore = "requires macOS main thread run loop (WKWebView)"]
    fn test_export_pdf_webkit_empty_html() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(export_pdf_webkit("".to_string(), 595.28, 841.89));
        // Empty HTML should still produce a PDF (blank page), not an error
        match result {
            Ok(pdf_bytes) => {
                assert!(
                    pdf_bytes.len() >= 5 && &pdf_bytes[..5] == b"%PDF-",
                    "Even empty HTML should produce a valid PDF"
                );
            }
            Err(_) => {
                // Acceptable — some WKWebView versions may error on empty content
            }
        }
    }
}

