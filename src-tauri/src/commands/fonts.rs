use std::sync::OnceLock;
use serde::Serialize;
use font_kit::source::SystemSource;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SystemFont {
    pub family: String,
    pub category: String,
}

/// Cached result of system font enumeration (computed once, reused on subsequent calls).
static SYSTEM_FONTS_CACHE: OnceLock<Vec<SystemFont>> = OnceLock::new();

/// Enumerate all installed system font families with category classification.
///
/// Categories: "mono", "serif", "sans", "other".
/// Filters out hidden fonts (names starting with `.` or `#`).
///
/// Results are cached after the first call — font-kit's `all_families()` queries
/// the macOS Core Text database which takes ~500-800ms.
#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    let fonts = SYSTEM_FONTS_CACHE.get_or_init(|| {
        enumerate_system_fonts().unwrap_or_default()
    });
    Ok(fonts.clone())
}

fn enumerate_system_fonts() -> Result<Vec<SystemFont>, String> {
    let source = SystemSource::new();
    let families = source.all_families().map_err(|e| format!("Failed to enumerate fonts: {e}"))?;

    let mut fonts: Vec<SystemFont> = families
        .into_iter()
        .filter(|name| !name.starts_with('.') && !name.starts_with('#'))
        .map(|family| {
            let category = classify_font(&family);
            SystemFont { family, category }
        })
        .collect();

    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
    fonts.dedup_by(|a, b| a.family == b.family);

    Ok(fonts)
}

/// Classify a font family as "mono", "serif", "sans", or "other" using name heuristics.
fn classify_font(family: &str) -> String {
    let lower = family.to_lowercase();

    // Monospace indicators (check first — some mono fonts contain "sans" in their name)
    if lower.contains("mono")
        || lower.contains("code")
        || lower.contains("console")
        || lower.contains("terminal")
        || is_known_mono(&lower)
    {
        return "mono".to_string();
    }

    // Serif indicators
    if lower.contains("serif") && !lower.contains("sans") {
        return "serif".to_string();
    }
    if is_known_serif(&lower) {
        return "serif".to_string();
    }

    // Sans indicators
    if lower.contains("sans") || lower.contains("gothic") || lower.contains("grotesk") {
        return "sans".to_string();
    }
    if is_known_sans(&lower) {
        return "sans".to_string();
    }

    "other".to_string()
}

/// Well-known monospace font families (lowercase comparison).
fn is_known_mono(lower: &str) -> bool {
    const MONO_NAMES: &[&str] = &[
        "courier", "menlo", "monaco", "consolas", "andale mono", "sf mono",
        "jetbrains", "fira code", "hack", "inconsolata", "source code",
        "dejavu sans mono", "liberation mono", "ubuntu mono", "cascadia",
        "iosevka", "victor mono", "roboto mono", "noto sans mono",
        "ibm plex mono", "space mono", "overpass mono", "anonymous pro",
        "b612 mono", "dm mono",
    ];
    MONO_NAMES.iter().any(|s| lower.contains(s))
}

/// Well-known serif font families (lowercase comparison).
fn is_known_serif(lower: &str) -> bool {
    const SERIF_NAMES: &[&str] = &[
        "times", "georgia", "garamond", "palatino", "baskerville", "bodoni",
        "caslon", "charter", "cochin", "didot", "hoefler", "iowan old style",
        "literata", "minion", "sabon", "cambria", "constantia", "bookman",
        "century", "cheltenham", "clarendon", "rockwell", "plantin",
        "superclarendon", "sitka", "merriweather", "playfair", "lora",
        "noto serif", "ibm plex serif", "source serif", "crimson",
        "eb garamond", "libre baskerville", "cormorant",
    ];
    SERIF_NAMES.iter().any(|s| lower.contains(s))
}

/// Well-known sans-serif font families (lowercase comparison).
fn is_known_sans(lower: &str) -> bool {
    const SANS_NAMES: &[&str] = &[
        "helvetica", "arial", "avenir", "futura", "gill", "inter", "lato",
        "lucida grande", "myriad", "open sans", "optima", "roboto", "segoe",
        "sf pro", "source sans", "tahoma", "trebuchet", "verdana", "calibri",
        "candara", "corbel", "fira sans", "montserrat", "nunito", "poppins",
        "raleway", "ubuntu", "noto sans", "ibm plex sans", "work sans",
        "dm sans", "public sans", "barlow", "lexend", "manrope", "outfit",
        "geist", "albert sans",
    ];
    SANS_NAMES.iter().any(|s| lower.contains(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_returns_non_empty() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        assert!(!fonts.is_empty(), "Should return at least one font");
    }

    #[test]
    fn contains_known_system_fonts() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        let families: Vec<&str> = fonts.iter().map(|f| f.family.as_str()).collect();

        // macOS always has these
        assert!(
            families.contains(&"Helvetica") || families.contains(&"Helvetica Neue"),
            "Should contain Helvetica or Helvetica Neue"
        );
        assert!(
            families.contains(&"Times New Roman"),
            "Should contain Times New Roman"
        );
        assert!(
            families.contains(&"Courier New") || families.contains(&"Courier"),
            "Should contain Courier New or Courier"
        );
    }

    #[test]
    fn excludes_hidden_fonts() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        for font in &fonts {
            assert!(!font.family.starts_with('.'), "Hidden font not filtered: {}", font.family);
            assert!(!font.family.starts_with('#'), "Hidden font not filtered: {}", font.family);
        }
    }

    #[test]
    fn valid_categories() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        let valid = ["sans", "serif", "mono", "other"];
        for font in &fonts {
            assert!(
                valid.contains(&font.category.as_str()),
                "Invalid category '{}' for font '{}'",
                font.category, font.family
            );
        }
    }

    #[test]
    fn results_are_sorted_alphabetically() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        for w in fonts.windows(2) {
            assert!(
                w[0].family.to_lowercase() <= w[1].family.to_lowercase(),
                "Not sorted: '{}' should come before '{}'",
                w[0].family, w[1].family
            );
        }
    }

    #[test]
    fn non_empty_family_names() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        for font in &fonts {
            assert!(!font.family.is_empty(), "Family name should not be empty");
        }
    }

    #[test]
    fn monospace_fonts_classified_correctly() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        let mono: Vec<&SystemFont> = fonts.iter().filter(|f| f.family == "Courier New" || f.family == "Menlo").collect();
        for font in mono {
            assert_eq!(font.category, "mono", "{} should be classified as mono", font.family);
        }
    }

    #[test]
    fn serif_fonts_classified_correctly() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        if let Some(times) = fonts.iter().find(|f| f.family == "Times New Roman") {
            assert_eq!(times.category, "serif", "Times New Roman should be serif");
        }
        if let Some(georgia) = fonts.iter().find(|f| f.family == "Georgia") {
            assert_eq!(georgia.category, "serif", "Georgia should be serif");
        }
    }

    #[test]
    fn sans_fonts_classified_correctly() {
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        if let Some(helvetica) = fonts.iter().find(|f| f.family == "Helvetica" || f.family == "Helvetica Neue") {
            assert_eq!(helvetica.category, "sans", "{} should be sans", helvetica.family);
        }
    }

    #[test]
    fn second_call_is_cached() {
        // First call populates the cache
        let _ = list_system_fonts().expect("Should enumerate fonts");
        // Second call should be near-instant (cached)
        let start = std::time::Instant::now();
        let fonts = list_system_fonts().expect("Should enumerate fonts");
        let elapsed = start.elapsed();
        assert!(fonts.len() > 10, "Should have many fonts");
        assert!(elapsed.as_millis() < 5, "Cached call took {}ms — should be <5ms", elapsed.as_millis());
    }
}
