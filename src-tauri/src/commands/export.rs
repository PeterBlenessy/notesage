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
    world.export_pdf()
}

/// Write binary data to a file on disk.
#[tauri::command]
pub async fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write file: {}", e))
}
