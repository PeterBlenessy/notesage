use crate::export::markdown_to_typst::markdown_to_typst;
use crate::export::templates::{apply_template, PageSize, Template, TemplateOptions};
use crate::export::typst_world::NotesageWorld;

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
) -> Result<Vec<u8>, String> {
    let template = Template::from_str(&template)?;
    let page_size = PageSize::from_str(&page_size)?;

    // Convert markdown to Typst markup
    let typst_content = markdown_to_typst(&markdown);

    // Apply template
    let source = apply_template(
        &typst_content,
        &TemplateOptions {
            template,
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
