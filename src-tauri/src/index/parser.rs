use comrak::nodes::{AstNode, NodeValue};
use comrak::{parse_document, Arena, Options};
use regex::Regex;
use std::sync::LazyLock;

/// Result of parsing a single markdown file.
#[derive(Debug, Default)]
pub struct ParsedFile {
    pub title: Option<String>,
    pub has_frontmatter: bool,
    pub frontmatter: Option<Frontmatter>,
    pub tags: Vec<ExtractedTag>,
    pub mentions: Vec<ExtractedMention>,
    pub headings: Vec<ExtractedHeading>,
    pub tasks: Vec<ExtractedTask>,
    pub body_text: String,
    pub is_research: bool,
    pub research: Option<ResearchMeta>,
    pub is_goal: bool,
    pub goal: Option<GoalMeta>,
}

#[derive(Debug, Clone)]
pub struct ExtractedTag {
    pub tag: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone)]
pub struct ExtractedMention {
    pub mention: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone)]
pub struct ExtractedHeading {
    pub level: u8,
    pub text: String,
    pub position: usize,
}

#[derive(Debug, Clone)]
pub struct ExtractedTask {
    pub text: String,
    pub done: bool,
    pub position: usize,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone, Default)]
pub struct Frontmatter {
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub source_url: Option<String>,
    pub date_saved: Option<String>,
    pub doc_type: Option<String>,
    pub template: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResearchMeta {
    pub source_url: String,
    pub date_saved: String,
    pub word_count: usize,
    pub tags: Vec<String>,
    pub snippet: String,
}

#[derive(Debug, Clone)]
pub struct GoalMeta {
    pub title: String,
    pub template: String,
    pub total_tasks: usize,
    pub completed_tasks: usize,
}

static TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap());

// Match @mentions that are NOT preceded by alphanumeric/dot/underscore (i.e., not emails).
// Since Rust regex doesn't support lookbehind, we capture the optional preceding char
// and use it to filter out email-like patterns.
static MENTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|([^a-zA-Z0-9._]))@([a-zA-Z][a-zA-Z0-9_-]*)").unwrap());

/// Parse a markdown file and extract all structured data.
pub fn parse_file(content: &str, file_name: &str, is_in_research_dir: bool) -> ParsedFile {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.strikethrough = true;
    options.extension.autolink = true;
    options.extension.front_matter_delimiter = Some("---".to_string());
    let root = parse_document(&arena, content, &options);

    let mut result = ParsedFile::default();
    let mut heading_count: usize = 0;
    let mut task_count: usize = 0;
    let mut first_h1: Option<String> = None;

    for node in root.descendants() {
        let node_data = node.data.borrow();
        match &node_data.value {
            NodeValue::FrontMatter(fm) => {
                result.has_frontmatter = true;
                // comrak includes the delimiter lines in the frontmatter string.
                // Strip leading/trailing --- lines to get pure YAML.
                let fm_text: String = fm
                    .lines()
                    .filter(|line| line.trim() != "---")
                    .collect::<Vec<_>>()
                    .join("\n");
                if let Some(fm_parsed) = parse_frontmatter(fm_text.trim()) {
                    result.frontmatter = Some(fm_parsed);
                }
            }
            NodeValue::Heading(h) => {
                let text = collect_text_content(node);
                if h.level == 1 && first_h1.is_none() {
                    first_h1 = Some(text.clone());
                }
                result.headings.push(ExtractedHeading {
                    level: h.level,
                    text,
                    position: heading_count,
                });
                heading_count += 1;
            }
            NodeValue::TaskItem(ti) => {
                if !is_inside_code(node) {
                    let text = collect_text_content(node);
                    let (ctx_before, ctx_after) = collect_task_context(node);
                    let done = ti.symbol.is_some();
                    result.tasks.push(ExtractedTask {
                        text: text.clone(),
                        done,
                        position: task_count,
                        context_before: ctx_before,
                        context_after: ctx_after,
                    });
                    task_count += 1;
                }
            }
            NodeValue::Text(ref text) => {
                // Extract tags/mentions from text nodes not inside code.
                // Headings are fine — comrak has already parsed the `#` markers out,
                // so any `#tag` or `@mention` in heading text is genuine.
                if !is_inside_code(node) {
                    extract_tags(text, &mut result.tags);
                    extract_mentions(text, &mut result.mentions);
                }
                // Accumulate body text from all non-code text nodes
                if !is_inside_code(node) {
                    result.body_text.push_str(text);
                    result.body_text.push(' ');
                }
            }
            NodeValue::SoftBreak | NodeValue::LineBreak => {
                if !is_inside_code(node) {
                    result.body_text.push(' ');
                }
            }
            NodeValue::Code(ref c) => {
                // Include code spans in body text for FTS but don't extract tags
                result.body_text.push_str(&c.literal);
                result.body_text.push(' ');
            }
            _ => {}
        }
    }

    // Determine title: frontmatter title > first H1 > filename
    result.title = result
        .frontmatter
        .as_ref()
        .and_then(|fm| fm.title.clone())
        .or(first_h1)
        .or_else(|| {
            let name = file_name
                .strip_suffix(".md")
                .unwrap_or(file_name);
            Some(name.to_string())
        });

    // Check if this is a research file
    let is_research = is_in_research_dir
        || result
            .frontmatter
            .as_ref()
            .is_some_and(|fm| fm.source_url.is_some());
    result.is_research = is_research;

    if is_research {
        let fm = result.frontmatter.as_ref();
        let word_count = result.body_text.split_whitespace().count();
        let snippet = truncate_str(&result.body_text, 200);
        result.research = Some(ResearchMeta {
            source_url: fm.and_then(|f| f.source_url.clone()).unwrap_or_default(),
            date_saved: fm.and_then(|f| f.date_saved.clone()).unwrap_or_default(),
            word_count,
            tags: fm.map(|f| f.tags.clone()).unwrap_or_default(),
            snippet,
        });
    }

    // Check if this is a goal file
    let is_goal = result
        .frontmatter
        .as_ref()
        .is_some_and(|fm| fm.doc_type.as_deref() == Some("goal"));
    result.is_goal = is_goal;

    if is_goal {
        let total = result.tasks.len();
        let completed = result.tasks.iter().filter(|t| t.done).count();
        let title = result.title.clone().unwrap_or_default();
        let template = result
            .frontmatter
            .as_ref()
            .and_then(|fm| fm.template.clone())
            .unwrap_or_default();
        result.goal = Some(GoalMeta {
            title,
            template,
            total_tasks: total,
            completed_tasks: completed,
        });
    }

    result
}

fn parse_frontmatter(text: &str) -> Option<Frontmatter> {
    let value: serde_norway::Value = serde_norway::from_str(text).ok()?;
    let mapping = value.as_mapping()?;

    let title = mapping
        .get(&serde_norway::Value::String("title".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let source_url = mapping
        .get(&serde_norway::Value::String("source_url".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let date_saved = mapping
        .get(&serde_norway::Value::String("date_saved".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let doc_type = mapping
        .get(&serde_norway::Value::String("type".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let template = mapping
        .get(&serde_norway::Value::String("template".into()))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let tags = mapping
        .get(&serde_norway::Value::String("tags".into()))
        .and_then(|v| match v {
            serde_norway::Value::Sequence(seq) => Some(
                seq.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect(),
            ),
            serde_norway::Value::String(s) => {
                // Handle comma-separated tags
                Some(s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
            }
            _ => None,
        })
        .unwrap_or_default();

    Some(Frontmatter {
        title,
        tags,
        source_url,
        date_saved,
        doc_type,
        template,
    })
}

/// Check if a node is inside a code block or inline code.
fn is_inside_code<'a>(node: &'a AstNode<'a>) -> bool {
    let mut current = node.parent();
    while let Some(parent) = current {
        let parent_data = parent.data.borrow();
        match &parent_data.value {
            NodeValue::CodeBlock(_) | NodeValue::Code(_) => return true,
            _ => {}
        }
        current = parent.parent();
    }
    false
}

/// Collect all text content from a node and its descendants.
fn collect_text_content<'a>(node: &'a AstNode<'a>) -> String {
    let mut text = String::new();
    for child in node.descendants() {
        let child_data = child.data.borrow();
        if let NodeValue::Text(ref t) = child_data.value {
            text.push_str(t);
        } else if matches!(child_data.value, NodeValue::SoftBreak | NodeValue::LineBreak) {
            text.push(' ');
        } else if let NodeValue::Code(ref c) = child_data.value {
            text.push_str(&c.literal);
        }
    }
    text.trim().to_string()
}

/// Get context before and after a task item for disambiguation.
fn collect_task_context<'a>(node: &'a AstNode<'a>) -> (String, String) {
    let mut before = String::new();
    let mut after = String::new();

    // Look at previous sibling
    if let Some(prev) = node.previous_sibling() {
        let text = collect_text_content(prev);
        before = truncate_str_end(&text, 50);
    }

    // Look at next sibling
    if let Some(next) = node.next_sibling() {
        let text = collect_text_content(next);
        after = truncate_str(&text, 50);
    }

    (before, after)
}

/// Extract #tags from a text string with surrounding context.
fn extract_tags(text: &str, tags: &mut Vec<ExtractedTag>) {
    for cap in TAG_RE.captures_iter(text) {
        let tag_name = cap.get(1).unwrap().as_str();
        let match_start = cap.get(0).unwrap().start();
        let match_end = cap.get(0).unwrap().end();

        let ctx_before = truncate_str_end(&text[..match_start], 50);
        let ctx_after = truncate_str(&text[match_end..], 50);

        tags.push(ExtractedTag {
            tag: tag_name.to_string(),
            context_before: ctx_before,
            context_after: ctx_after,
        });
    }
}

/// Extract @mentions from a text string, filtering out email-like patterns.
fn extract_mentions(text: &str, mentions: &mut Vec<ExtractedMention>) {
    for cap in MENTION_RE.captures_iter(text) {
        // Group 1 is the optional preceding char (if captured, it's a non-email separator)
        // Group 2 is the mention name
        let mention_name = cap.get(2).unwrap().as_str();
        let full_match = cap.get(0).unwrap();
        let match_end = full_match.end();

        // Find the @ position in the match
        let match_start = full_match.start();
        let at_pos = text[match_start..].find('@').map(|p| match_start + p).unwrap_or(match_start);

        let ctx_before = truncate_str_end(&text[..at_pos], 50);
        let ctx_after = truncate_str(&text[match_end..], 50);

        mentions.push(ExtractedMention {
            mention: mention_name.to_string(),
            context_before: ctx_before,
            context_after: ctx_after,
        });
    }
}

/// Truncate a string to at most `max_len` characters from the start.
fn truncate_str(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_len {
        trimmed.to_string()
    } else {
        trimmed[..max_len].to_string()
    }
}

/// Truncate a string to at most `max_len` characters from the end.
fn truncate_str_end(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_len {
        trimmed.to_string()
    } else {
        trimmed[trimmed.len() - max_len..].to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tags_extracted_from_body() {
        let content = "Hello #world this is a #test document.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tags.len(), 2);
        assert_eq!(result.tags[0].tag, "world");
        assert_eq!(result.tags[1].tag, "test");
    }

    #[test]
    fn test_tags_not_extracted_from_code_block() {
        let content = "```\n#not-a-tag\n```\n\nReal #tag here.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tags.len(), 1);
        assert_eq!(result.tags[0].tag, "tag");
    }

    #[test]
    fn test_tags_not_extracted_from_inline_code() {
        let content = "See `#not-a-tag` but #real-tag is here.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tags.len(), 1);
        assert_eq!(result.tags[0].tag, "real-tag");
    }

    #[test]
    fn test_tags_extracted_from_headings() {
        // Tags in headings ARE indexed — comrak parses the `#` heading markers out,
        // so any `#tag` in heading text is genuine, not a heading marker.
        let content = "## Project Notes #important\n\nBody text with #actual-tag.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tags.len(), 2);
        assert_eq!(result.tags[0].tag, "important");
        assert_eq!(result.tags[1].tag, "actual-tag");
    }

    #[test]
    fn test_tags_not_extracted_from_frontmatter() {
        let content = "---\ntitle: My Doc\ntags: [foo, bar]\n---\n\n#real-tag in body.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tags.len(), 1);
        assert_eq!(result.tags[0].tag, "real-tag");
    }

    #[test]
    fn test_mentions_extracted() {
        let content = "Hello @alice and @bob, please review.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.mentions.len(), 2);
        assert_eq!(result.mentions[0].mention, "alice");
        assert_eq!(result.mentions[1].mention, "bob");
    }

    #[test]
    fn test_email_not_extracted_as_mention() {
        let content = "Contact user@example.com or @real-mention.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.mentions.len(), 1);
        assert_eq!(result.mentions[0].mention, "real-mention");
    }

    #[test]
    fn test_tasks_extracted() {
        let content = "- [ ] Buy groceries\n- [x] Done task\n- Regular item";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.tasks.len(), 2);
        assert!(!result.tasks[0].done);
        assert_eq!(result.tasks[0].text, "Buy groceries");
        assert!(result.tasks[1].done);
        assert_eq!(result.tasks[1].text, "Done task");
    }

    #[test]
    fn test_headings_extracted() {
        let content = "# Title\n\n## Section\n\n### Subsection";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.headings.len(), 3);
        assert_eq!(result.headings[0].level, 1);
        assert_eq!(result.headings[0].text, "Title");
        assert_eq!(result.headings[1].level, 2);
    }

    #[test]
    fn test_frontmatter_parsed() {
        let content = "---\ntitle: My Document\ntags:\n  - foo\n  - bar\n---\n\nBody text.";
        let result = parse_file(content, "test.md", false);
        assert!(result.has_frontmatter);
        assert_eq!(result.title, Some("My Document".to_string()));
        let fm = result.frontmatter.unwrap();
        assert_eq!(fm.tags, vec!["foo", "bar"]);
    }

    #[test]
    fn test_title_fallback_to_h1() {
        let content = "# My Title\n\nBody text.";
        let result = parse_file(content, "test.md", false);
        assert_eq!(result.title, Some("My Title".to_string()));
    }

    #[test]
    fn test_title_fallback_to_filename() {
        let content = "Just body text, no heading.";
        let result = parse_file(content, "my-note.md", false);
        assert_eq!(result.title, Some("my-note".to_string()));
    }

    #[test]
    fn test_goal_detection() {
        let content = "---\ntitle: Q1 Goals\ntype: goal\ntemplate: okr\n---\n\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3";
        let result = parse_file(content, "goals.md", false);
        assert!(result.is_goal);
        let goal = result.goal.unwrap();
        assert_eq!(goal.title, "Q1 Goals");
        assert_eq!(goal.template, "okr");
        assert_eq!(goal.total_tasks, 3);
        assert_eq!(goal.completed_tasks, 1);
    }

    #[test]
    fn test_research_detection_by_frontmatter() {
        let content = "---\ntitle: Climate Report\nsource_url: https://example.com\ndate_saved: 2026-01-01\ntags: [climate, policy]\n---\n\nBody text about climate.";
        let result = parse_file(content, "research.md", false);
        assert!(result.is_research);
        let research = result.research.unwrap();
        assert_eq!(research.source_url, "https://example.com");
        assert_eq!(research.tags, vec!["climate", "policy"]);
    }

    #[test]
    fn test_research_detection_by_directory() {
        let content = "Just a note in the research directory.";
        let result = parse_file(content, "note.md", true);
        assert!(result.is_research);
    }
}
