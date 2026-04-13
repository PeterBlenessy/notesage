use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Datelike;
use typst::diag::FileError;
use typst::foundations::{Bytes, Datetime};
use typst::layout::PagedDocument;
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt};
use typst_syntax::{FileId, Source, VirtualPath};

/// Bundled font data (embedded at compile time).
static FONT_FILES: &[&[u8]] = &[
    include_bytes!("../../fonts/inter/Inter-Regular.ttf"),
    include_bytes!("../../fonts/inter/Inter-Bold.ttf"),
    include_bytes!("../../fonts/inter/Inter-Italic.ttf"),
    include_bytes!("../../fonts/inter/Inter-BoldItalic.ttf"),
    include_bytes!("../../fonts/source-serif/SourceSerif4-Regular.ttf"),
    include_bytes!("../../fonts/source-serif/SourceSerif4-Bold.ttf"),
    include_bytes!("../../fonts/source-serif/SourceSerif4-It.ttf"),
    include_bytes!("../../fonts/source-serif/SourceSerif4-BoldIt.ttf"),
    include_bytes!("../../fonts/jetbrains-mono/JetBrainsMono-Regular.ttf"),
];

/// A Typst World implementation for embedded PDF compilation.
///
/// Loads bundled fonts (no system fonts), resolves the main source and
/// any additional files (templates) from an in-memory map.
pub struct NotesageWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main_id: FileId,
    sources: Mutex<HashMap<FileId, Source>>,
    files: Mutex<HashMap<FileId, Bytes>>,
}

impl NotesageWorld {
    /// Create a new world with the given Typst source content.
    pub fn new(main_source: String) -> Self {
        // Load bundled fonts
        let mut fonts = Vec::new();
        for data in FONT_FILES {
            let bytes = Bytes::new(data.to_vec());
            for font in Font::iter(bytes) {
                fonts.push(font);
            }
        }

        let book = LazyHash::new(FontBook::from_fonts(fonts.iter()));

        let main_id = FileId::new(None, VirtualPath::new("/main.typ"));
        let main = Source::new(main_id, main_source);

        let mut sources = HashMap::new();
        sources.insert(main_id, main);

        Self {
            library: LazyHash::new(Library::default()),
            book,
            fonts,
            main_id,
            sources: Mutex::new(sources),
            files: Mutex::new(HashMap::new()),
        }
    }

    /// Add a virtual source file (e.g. a template).
    #[allow(dead_code)]
    pub fn add_source(&self, path: &str, content: String) {
        let id = FileId::new(None, VirtualPath::new(path));
        let source = Source::new(id, content);
        self.sources.lock().unwrap().insert(id, source);
    }

    /// Add a virtual binary file (e.g. an image).
    pub fn add_file(&self, path: &str, data: Vec<u8>) {
        let id = FileId::new(None, VirtualPath::new(path));
        self.files.lock().unwrap().insert(id, Bytes::new(data));
    }

    /// Compile the main source to a paged document.
    pub fn compile(&self) -> Result<PagedDocument, String> {
        let warned = typst::compile::<PagedDocument>(self);
        warned.output.map_err(|diagnostics| {
            diagnostics
                .iter()
                .map(|d| d.message.to_string())
                .collect::<Vec<_>>()
                .join("\n")
        })
    }

    /// Compile and export to PDF bytes.
    pub fn export_pdf(&self) -> Result<Vec<u8>, String> {
        let document = self.compile()?;
        typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default())
            .map_err(|diagnostics| {
                diagnostics
                    .iter()
                    .map(|d| d.message.to_string())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
    }
}

impl typst::World for NotesageWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> Result<Source, FileError> {
        self.sources
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| FileError::NotFound(id.vpath().as_rootless_path().to_path_buf()))
    }

    fn file(&self, id: FileId) -> Result<Bytes, FileError> {
        // Check binary files first
        if let Some(bytes) = self.files.lock().unwrap().get(&id) {
            return Ok(bytes.clone());
        }
        // Fall back to source files (return as bytes)
        if let Some(source) = self.sources.lock().unwrap().get(&id) {
            return Ok(Bytes::from_string(source.text().to_string()));
        }
        Err(FileError::NotFound(
            id.vpath().as_rootless_path().to_path_buf(),
        ))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = if let Some(hours) = offset {
            let offset = chrono::FixedOffset::east_opt((hours as i32) * 3600)?;
            chrono::Utc::now().with_timezone(&offset).naive_local()
        } else {
            chrono::Local::now().naive_local()
        };
        Datetime::from_ymd(
            now.year(),
            now.month().try_into().ok()?,
            now.day().try_into().ok()?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use typst::World;

    #[test]
    fn test_compile_simple_document() {
        let world = NotesageWorld::new("= Hello World\nThis is a test.".to_string());
        let result = world.export_pdf();
        assert!(result.is_ok(), "PDF export failed: {:?}", result.err());
        let pdf_bytes = result.unwrap();
        assert!(pdf_bytes.len() > 100, "PDF seems too small");
        // PDF files start with %PDF
        assert_eq!(&pdf_bytes[0..5], b"%PDF-");
    }

    #[test]
    fn test_fonts_loaded() {
        let world = NotesageWorld::new("test".to_string());
        assert!(
            !world.fonts.is_empty(),
            "No fonts loaded from bundled files"
        );
        // We expect at least 9 fonts (one per TTF file, possibly more from font collections)
        assert!(
            world.fonts.len() >= 9,
            "Expected at least 9 fonts, got {}",
            world.fonts.len()
        );
    }

    #[test]
    fn test_add_source_file() {
        let world = NotesageWorld::new("#import \"/template.typ\": *\n= Test".to_string());
        world.add_source(
            "/template.typ",
            "#let template(body) = { body }".to_string(),
        );
        let id = FileId::new(None, VirtualPath::new("/template.typ"));
        assert!(world.source(id).is_ok());
    }

    #[test]
    fn test_missing_file_error() {
        let world = NotesageWorld::new("test".to_string());
        let id = FileId::new(None, VirtualPath::new("/nonexistent.typ"));
        assert!(world.source(id).is_err());
        assert!(world.file(id).is_err());
    }

    #[test]
    fn test_bundled_fonts_render() {
        // Verify Inter renders (sans-serif)
        let world = NotesageWorld::new(
            "#set text(font: \"Inter\")\nHello with Inter font.".to_string(),
        );
        assert!(world.export_pdf().is_ok());

        // Verify Source Serif 4 renders (serif)
        let world = NotesageWorld::new(
            "#set text(font: \"Source Serif 4\")\nHello with Source Serif.".to_string(),
        );
        assert!(world.export_pdf().is_ok());

        // Verify JetBrains Mono renders (monospace)
        let world = NotesageWorld::new(
            "#set text(font: \"JetBrains Mono\")\nHello with JetBrains Mono.".to_string(),
        );
        assert!(world.export_pdf().is_ok());
    }
}
