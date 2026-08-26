use std::fs;
#[test]
fn probe() {
    let Ok(path) = std::env::var("PROBE_HTML") else { return };
    let url = std::env::var("PROBE_URL").unwrap_or_default();
    let html = fs::read_to_string(&path).unwrap();
    if let Some(a) = notesage_capture::extract_article(&html, &url) {
        let doc = notesage_capture::build_article_html_document(&a, None, &url);
        for chunk in doc.split("<img").skip(1) {
            let head = &chunk[..chunk.find('>').unwrap_or(0)];
            if let Some(i) = head.find("src=\"") {
                let rest = &head[i + 5..];
                let src = &rest[..rest.find('"').unwrap_or(rest.len())];
                println!("KEPT {}", &src[..src.len().min(110)]);
            }
        }
    }
}
