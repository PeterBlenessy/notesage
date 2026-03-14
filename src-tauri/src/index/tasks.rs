use regex::Regex;
use std::sync::LazyLock;

static TASK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*(?:[-*]|\d+\.)\s+)\[([ xX])\]\s+").unwrap());

/// Toggle a task's completion status in a markdown file using context-based matching.
///
/// Instead of relying on fragile line numbers, this finds the task by matching
/// the task text combined with surrounding context.
///
/// Returns the modified file content, or an error if the task couldn't be found.
pub fn toggle_task_in_content(
    content: &str,
    task_text: &str,
    context_before: &str,
    context_after: &str,
    new_done: bool,
) -> Result<String, String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut best_match: Option<(usize, f64)> = None;

    for (i, line) in lines.iter().enumerate() {
        // Check if this line is a task item
        if !TASK_RE.is_match(line) {
            continue;
        }

        // Extract task text from the line
        let line_task_text = TASK_RE.replace(line, "").trim().to_string();

        // Score this match
        let mut score = 0.0;

        // Primary: task text similarity
        if line_task_text == task_text {
            score += 1.0;
        } else if line_task_text.contains(task_text) || task_text.contains(&line_task_text) {
            score += 0.5;
        } else {
            continue; // Task text must at least partially match
        }

        // Secondary: context matching
        if !context_before.is_empty() {
            // Check text in the lines above
            let above_text: String = lines[..i].iter().rev().take(3).copied().collect::<Vec<_>>().join(" ");
            if above_text.contains(context_before) {
                score += 0.3;
            }
        }

        if !context_after.is_empty() {
            // Check text in the lines below
            let below_text: String = lines[i + 1..].iter().take(3).copied().collect::<Vec<_>>().join(" ");
            if below_text.contains(context_after) {
                score += 0.2;
            }
        }

        if best_match.is_none() || score > best_match.unwrap().1 {
            best_match = Some((i, score));
        }
    }

    let line_idx = best_match
        .map(|(idx, _)| idx)
        .ok_or_else(|| format!("Could not find task '{}' in file", task_text))?;

    // Toggle the checkbox on the matched line
    let mut result_lines: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
    let line = &result_lines[line_idx];

    let new_line = if new_done {
        TASK_RE
            .replace(line, |caps: &regex::Captures| {
                format!("{}[x] ", &caps[1])
            })
            .to_string()
    } else {
        TASK_RE
            .replace(line, |caps: &regex::Captures| {
                format!("{}[ ] ", &caps[1])
            })
            .to_string()
    };

    result_lines[line_idx] = new_line;

    // Preserve original line endings
    let mut result = result_lines.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_toggle_unchecked_to_checked() {
        let content = "# Tasks\n\n- [ ] Buy groceries\n- [ ] Clean house\n";
        let result = toggle_task_in_content(content, "Buy groceries", "", "", true).unwrap();
        assert!(result.contains("- [x] Buy groceries"));
        assert!(result.contains("- [ ] Clean house"));
    }

    #[test]
    fn test_toggle_checked_to_unchecked() {
        let content = "- [x] Done task\n- [ ] Open task\n";
        let result = toggle_task_in_content(content, "Done task", "", "", false).unwrap();
        assert!(result.contains("- [ ] Done task"));
    }

    #[test]
    fn test_context_disambiguation() {
        let content = "## Section A\n\n- [ ] Fix bug\n\n## Section B\n\n- [ ] Fix bug\n";
        // With context_before matching Section B
        let result = toggle_task_in_content(content, "Fix bug", "Section B", "", true).unwrap();
        // The second "Fix bug" should be toggled
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines[2], "- [ ] Fix bug"); // First one stays unchecked
        assert_eq!(lines[6], "- [x] Fix bug"); // Second one gets checked
    }

    #[test]
    fn test_task_not_found() {
        let content = "# Notes\n\nJust text, no tasks.\n";
        let result = toggle_task_in_content(content, "Nonexistent task", "", "", true);
        assert!(result.is_err());
    }
}
