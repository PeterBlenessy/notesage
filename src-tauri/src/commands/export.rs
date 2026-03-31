use crate::export::html_styles::{html_css, wrap_html_document};
use crate::export::markdown_to_docx::{markdown_to_docx, DocxOptions};
use crate::export::markdown_to_html::markdown_to_html;
use crate::export::markdown_to_pptx::markdown_to_pptx;
use crate::export::markdown_to_typst::markdown_to_typst;
use crate::export::templates::{generate_typst_styles, PageSize, Template, TemplateOptions};
use crate::export::typography::TypographyPresets;
use crate::export::typst_world::NotesageWorld;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Convert markdown to PDF bytes using the Typst engine.
#[tauri::command]
pub async fn export_pdf(
    markdown: String,
    title: String,
    template: String,
    include_toc: bool,
    include_page_numbers: bool,
    page_size: String,
    project_root: Option<String>,
    typography: Option<TypographyPresets>,
) -> Result<Vec<u8>, String> {
    let page_size = PageSize::from_str(&page_size)?;

    // Convert markdown to Typst markup
    let typst_content = markdown_to_typst(&markdown);

    // Generate source: use typography presets if provided, else fall back to template
    let presets = typography.unwrap_or_default();
    let source = generate_typst_styles(
        &typst_content,
        &presets,
        &TemplateOptions {
            template: Template::from_str(&template).unwrap_or(Template::Clean),
            title,
            include_toc,
            include_page_numbers,
            page_size,
        },
    );

    // Compile to PDF
    let world = NotesageWorld::new(source);

    // Resolve drawing SVG files from the project root
    if let Some(ref root) = project_root {
        resolve_drawing_svgs(&markdown, root, &world);
    }

    world.export_pdf()
}

/// Convert markdown to PPTX bytes.
#[tauri::command]
pub async fn export_pptx(
    markdown: String,
    title: String,
    template: String,
    project_root: Option<String>,
) -> Result<Vec<u8>, String> {
    markdown_to_pptx(
        &markdown,
        &title,
        &template,
        project_root.as_deref(),
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
) -> Result<Vec<u8>, String> {
    let options = DocxOptions {
        include_toc,
        include_page_numbers,
        page_size,
        project_root,
    };
    markdown_to_docx(&markdown, &title, &template, &options, typography.as_ref())
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
) -> Result<String, String> {
    let body = markdown_to_html(&markdown, &theme, project_root.as_deref());

    if include_styles {
        let base_css = html_css(&theme);
        // Generate typography override CSS if presets are provided
        let presets = typography.unwrap_or_default();
        let typography_css = generate_html_typography_css(&presets);
        let css = format!("{}\n{}", base_css, typography_css);
        Ok(wrap_html_document(&body, &title, &theme, &css))
    } else {
        // Clipboard mode: return body fragment only
        Ok(body)
    }
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

/// Scan markdown for `.excalidraw` image references and add corresponding SVG files
/// to the Typst world so they can be included in the PDF.
fn resolve_drawing_svgs(markdown: &str, project_root: &str, world: &NotesageWorld) {
    // Simple pattern: ![...](path.excalidraw)
    for line in markdown.lines() {
        if let Some(start) = line.find("](") {
            if let Some(end) = line[start..].find(')') {
                let url = &line[start + 2..start + end];
                if url.ends_with(".excalidraw") {
                    let svg_relative = format!("{}.svg", url.trim_end_matches(".excalidraw"));
                    // Resolve the SVG path on disk relative to project root
                    let svg_disk_path = if svg_relative.starts_with('/') {
                        // Path like /.notesage/drawings/abc.svg — relative to project root
                        format!("{}{}", project_root, svg_relative)
                    } else {
                        format!("{}/{}", project_root, svg_relative)
                    };
                    if let Ok(data) = std::fs::read(&svg_disk_path) {
                        // Add as virtual file with the same path used in the Typst source
                        world.add_file(&svg_relative, data);
                    }
                }
            }
        }
    }
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
