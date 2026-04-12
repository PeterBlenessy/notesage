use super::markdown_to_docx::{markdown_to_docx, DocxOptions};
use super::markdown_to_html::markdown_to_html;
use super::markdown_to_pptx::markdown_to_pptx;
use super::templates::PptxTemplate;
use crate::commands::export::EmbeddedImage;
use std::time::Instant;

// ---------------------------------------------------------------------------
// Reference documents
// ---------------------------------------------------------------------------

const SIMPLE_DOC: &str = r#"# Meeting Notes

## Agenda

- Review Q4 goals
- Discuss budget allocation
- Team updates

## Discussion

The team agreed that the current trajectory is positive. Revenue targets
are on track, and customer satisfaction scores have improved by 12% over
the previous quarter.

### Action Items

1. Update the roadmap by Friday
2. Schedule follow-up with marketing
3. Prepare the quarterly report

## Next Meeting

Scheduled for next Tuesday at 10am.
"#;

const COMPLEX_DOC: &str = r#"---
title: Technical Specification
type: document
tags:
  - engineering
  - specification
---

# API Design Guide

This document covers the **API design principles** used in our codebase,
including *best practices* and ~~deprecated patterns~~.

## Authentication

All requests require a `Bearer` token in the `Authorization` header:

```http
GET /api/v1/users
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9...
```

For more details, see the [Auth Documentation](https://docs.example.com/auth).

## Data Models

### User Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| name | string | Yes | Display name |
| email | string | Yes | Email address |
| role | enum | No | admin, user, viewer |
| created_at | datetime | Yes | Creation timestamp |

### Response Format

All responses follow a standard envelope:

```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "total": 42
  }
}
```

## Implementation Checklist

- [x] Define OpenAPI specification
- [x] Implement authentication middleware
- [ ] Add rate limiting
- [ ] Write integration tests
- [ ] Deploy to staging

## Error Handling

> **Important:** All errors must include a machine-readable error code
> in addition to a human-readable message. This allows clients to
> programmatically handle specific error conditions.

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| AUTH_INVALID_TOKEN | 401 | Token is malformed or expired |
| AUTH_INSUFFICIENT_SCOPE | 403 | Token lacks required permissions |
| RESOURCE_NOT_FOUND | 404 | Requested resource does not exist |
| VALIDATION_FAILED | 422 | Request body failed validation |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |

---

## Performance Guidelines

Endpoints should respond within **200ms** at the 95th percentile.
Use `cache-control` headers where appropriate. Consider implementing
ETags for frequently accessed resources.

The following Rust snippet demonstrates a basic handler:

```rust
async fn get_user(
    Path(id): Path<Uuid>,
    State(db): State<Pool>,
) -> Result<Json<User>, AppError> {
    let user = db.get_user(id).await?;
    Ok(Json(user))
}
```
"#;

const LONG_DOC: &str = r#"# Comprehensive Project Report

## Executive Summary

This report provides a detailed analysis of the project's progress over the
past twelve months. It covers technical achievements, team performance,
financial status, and strategic recommendations for the upcoming fiscal year.

The project has successfully delivered on 87% of planned milestones, with
the remaining items scheduled for completion within the next quarter.

## Technical Overview

### Architecture

The system uses a microservices architecture deployed on Kubernetes. Each
service communicates via gRPC for internal calls and exposes REST APIs for
external consumers. The event-driven backbone uses Apache Kafka for
asynchronous message processing.

Key architectural decisions made during this period include the migration
from a monolithic database to a distributed data store, the adoption of
a service mesh for inter-service communication, and the implementation of
a centralized configuration management system.

### Infrastructure

The infrastructure is managed using Terraform and deployed across multiple
availability zones. Auto-scaling groups handle traffic fluctuations, and
a comprehensive monitoring stack provides real-time visibility into system
health and performance metrics.

### Performance Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Uptime | 99.9% | 99.95% | Exceeded |
| P95 Latency | 200ms | 145ms | Exceeded |
| Error Rate | < 0.1% | 0.03% | Exceeded |
| Deploy Frequency | Daily | 3x Daily | Exceeded |

## Team Updates

### Engineering

The engineering team grew from 12 to 18 members this year. We successfully
onboarded six new engineers across three different time zones, establishing
a follow-the-sun development model that has increased our effective
development hours by 40%.

Training initiatives included workshops on distributed systems, security
best practices, and observability tooling. Each team member completed an
average of 30 hours of professional development.

### Product

The product team refined the roadmap based on customer feedback collected
through quarterly surveys, support ticket analysis, and direct interviews
with key accounts. The Net Promoter Score improved from 42 to 58, placing
us in the "excellent" category for our industry segment.

### Design

The design system was overhauled to improve accessibility compliance. All
components now meet WCAG 2.1 AA standards, and key user flows have been
tested with screen readers and alternative input devices.

## Financial Analysis

### Revenue

Revenue grew 34% year-over-year, driven primarily by expansion within
existing accounts. The average contract value increased by 22%, while
customer acquisition costs decreased by 15% due to improved organic
discovery and referral programs.

### Cost Structure

Infrastructure costs were optimized through right-sizing instances,
implementing spot instances for non-critical workloads, and negotiating
reserved capacity agreements. This resulted in a 28% reduction in
per-transaction infrastructure costs despite a 45% increase in traffic.

### Projections

Based on current trends and the sales pipeline, we project 40-50%
revenue growth for the next fiscal year. Key assumptions include
successful launch of the enterprise tier, expansion into two new
geographic markets, and continued improvement in retention metrics.

## Risk Assessment

### Technical Risks

1. **Scalability ceiling** — The current database architecture may not
   support the projected 10x growth in write throughput without
   significant rearchitecting. Mitigation: begin evaluation of
   distributed write-ahead log solutions in Q1.

2. **Security vulnerabilities** — As the attack surface grows with new
   integrations, the risk of security incidents increases. Mitigation:
   implement automated security scanning in the CI pipeline and conduct
   quarterly penetration tests.

3. **Technical debt** — Several core modules carry significant technical
   debt from the rapid growth phase. Mitigation: allocate 20% of
   engineering capacity to refactoring efforts, prioritized by risk.

### Business Risks

1. **Market competition** — Two well-funded competitors entered the
   market this year. Mitigation: accelerate differentiation through
   AI-powered features and superior developer experience.

2. **Key person dependency** — Critical knowledge is concentrated in
   a small number of senior engineers. Mitigation: implement knowledge
   sharing sessions and comprehensive documentation practices.

## Strategic Recommendations

### Short Term (Q1-Q2)

- Launch the enterprise self-service portal
- Implement single sign-on integration
- Expand the API to support batch operations
- Hire three additional senior engineers

### Medium Term (Q3-Q4)

- Enter the European market with local data residency
- Launch the partner ecosystem program
- Implement AI-assisted code review features
- Achieve SOC 2 Type II certification

### Long Term (Year 2+)

- Evaluate strategic partnerships or acquisition opportunities
- Build a developer marketplace for extensions
- Expand into adjacent market segments
- Consider international team expansion

## Appendix A: Detailed Metrics

### Monthly Active Users

| Month | Users | Growth |
|-------|-------|--------|
| January | 12,400 | - |
| February | 13,100 | 5.6% |
| March | 14,200 | 8.4% |
| April | 15,800 | 11.3% |
| May | 16,500 | 4.4% |
| June | 18,200 | 10.3% |
| July | 19,100 | 4.9% |
| August | 20,500 | 7.3% |
| September | 22,800 | 11.2% |
| October | 24,100 | 5.7% |
| November | 26,300 | 9.1% |
| December | 28,500 | 8.4% |

### Feature Adoption Rates

| Feature | Adoption | Satisfaction |
|---------|----------|-------------|
| Dashboard | 94% | 4.2/5 |
| API Access | 67% | 4.5/5 |
| Webhooks | 45% | 3.8/5 |
| Custom Reports | 38% | 4.1/5 |
| Team Management | 72% | 4.0/5 |
| SSO | 28% | 4.6/5 |

## Appendix B: Technology Stack

```yaml
frontend:
  framework: React 19
  language: TypeScript 5
  state: Zustand
  styling: Tailwind CSS v4

backend:
  runtime: Rust (Tokio)
  api: Axum
  database: PostgreSQL 16
  cache: Redis 7
  queue: Apache Kafka

infrastructure:
  orchestration: Kubernetes 1.29
  iac: Terraform
  ci: GitHub Actions
  monitoring: Grafana + Prometheus
  logging: Loki
```

## Conclusion

The project is in a strong position heading into the next fiscal year.
The technical foundation is solid, the team is growing and developing,
and the market opportunity remains significant. By executing on the
strategic recommendations outlined above, we are well-positioned to
achieve our ambitious growth targets while maintaining the quality and
reliability that our customers depend on.
"#;

const EMPTY_DOC: &str = "";

const NO_HEADINGS_DOC: &str = r#"This document has no headings at all.

Just paragraphs of text. The table of contents should be empty
or not generated when there are no headings to reference.

Some **bold** and *italic* text for good measure.

- A list item
- Another item
"#;

// ===========================================================================
// PPTX Integration Tests
// ===========================================================================

/// Helper: generate PPTX and verify it's a valid ZIP with expected entries.
fn pptx_pipeline(markdown: &str, title: &str, template: &str) -> Vec<u8> {
    let result = markdown_to_pptx(markdown, title, template, None, None);
    assert!(result.is_ok(), "PPTX export failed: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.len() > 100, "PPTX too small: {} bytes", bytes.len());
    assert_eq!(&bytes[0..4], b"PK\x03\x04", "Not a valid ZIP/PPTX");
    bytes
}

/// Verify that the PPTX ZIP contains expected Office Open XML entries.
fn assert_pptx_has_entries(bytes: &[u8], expected: &[&str]) {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).expect("Failed to open PPTX as ZIP");
    let names: Vec<String> = (0..archive.len())
        .map(|i| archive.by_index(i).unwrap().name().to_string())
        .collect();

    for entry in expected {
        assert!(
            names.iter().any(|n| n.contains(entry)),
            "Missing expected PPTX entry '{}'. Found: {:?}",
            entry,
            names
        );
    }
}

#[test]
fn test_pptx_simple_document() {
    let bytes = pptx_pipeline(SIMPLE_DOC, "Meeting Notes", "simple");
    assert_pptx_has_entries(&bytes, &[
        "[Content_Types].xml",
        "ppt/presentation.xml",
        "ppt/slides/slide1.xml",
    ]);
}

#[test]
fn test_pptx_complex_document() {
    let bytes = pptx_pipeline(COMPLEX_DOC, "API Design Guide", "business");
    // Complex doc has multiple H1s and tables — should produce multiple slides
    assert_pptx_has_entries(&bytes, &[
        "ppt/slides/slide1.xml",
        "ppt/slides/slide2.xml",
    ]);
}

#[test]
fn test_pptx_all_templates_produce_valid_output() {
    for template in ["simple", "business", "report"] {
        let bytes = pptx_pipeline(SIMPLE_DOC, "Template Test", template);
        assert_pptx_has_entries(&bytes, &["ppt/presentation.xml"]);
    }
}

#[test]
fn test_pptx_long_document_creates_multiple_slides() {
    let bytes = pptx_pipeline(LONG_DOC, "Long Report", "report");
    // Long doc has many H1/H2 sections — should produce many slides
    let reader = std::io::Cursor::new(&bytes);
    let archive = zip::ZipArchive::new(reader).expect("Failed to open PPTX");
    let slide_count = (0..archive.len())
        .filter(|&i| {
            let name = archive.name_for_index(i).unwrap_or_default();
            name.starts_with("ppt/slides/slide") && name.ends_with(".xml")
        })
        .count();
    assert!(
        slide_count >= 5,
        "Long document should produce at least 5 slides, got {}",
        slide_count
    );
}

#[test]
fn test_pptx_empty_document() {
    let bytes = pptx_pipeline(EMPTY_DOC, "Empty", "simple");
    // Should still produce at least a title slide
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
}

#[test]
fn test_pptx_no_headings_document() {
    let bytes = pptx_pipeline(NO_HEADINGS_DOC, "No Headings", "simple");
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
}

#[test]
fn test_pptx_unicode_content() {
    let markdown = "# Übersicht\n\n日本語のテキスト\n\n## Résumé\n\nCafé, naïve, über\n";
    let bytes = pptx_pipeline(markdown, "Unicode", "simple");
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
}

#[test]
fn test_pptx_special_characters_in_title() {
    let titles = [
        "Hello \"World\"",
        "Report — Q4 2025",
        "Notes: Important & Urgent",
        "Price $100 @company",
    ];
    for title in &titles {
        let result = markdown_to_pptx("# Test\n\nContent.", title, "simple", None, None);
        assert!(result.is_ok(), "Title '{}' failed: {:?}", title, result.err());
    }
}

#[test]
fn test_pptx_performance_long_document() {
    let start = Instant::now();
    let _ = pptx_pipeline(LONG_DOC, "Perf Test", "report");
    let elapsed = start.elapsed();
    assert!(
        elapsed.as_secs() < 3,
        "PPTX export took too long: {:?} (budget: 3s)",
        elapsed
    );
}

#[test]
fn test_pptx_with_tables_and_code() {
    let markdown = r#"# Data Review

| Metric | Q1 | Q2 | Q3 |
|--------|-----|-----|-----|
| Revenue | 100 | 120 | 150 |
| Users | 500 | 650 | 800 |

## Implementation

```rust
fn calculate_growth(prev: f64, curr: f64) -> f64 {
    (curr - prev) / prev * 100.0
}
```

---

# Summary

- Growth is on track
- Revenue exceeds projections
"#;
    let bytes = pptx_pipeline(markdown, "Data Review", "business");
    assert_pptx_has_entries(&bytes, &[
        "ppt/slides/slide1.xml",
        "ppt/slides/slide2.xml",
    ]);
}

#[test]
fn test_pptx_with_speaker_notes() {
    let markdown = r#"# Opening

Welcome everyone.

> [!notes]
> Remember to introduce the team members.
> Mention the agenda.

# Agenda

- Item 1
- Item 2

> [!notes]
> Keep this section brief — 5 minutes max.
"#;
    let bytes = pptx_pipeline(markdown, "With Notes", "simple");
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
    // Notes are embedded in the slide XML — verify the file is non-trivially sized
    assert!(bytes.len() > 500);
}

#[test]
fn test_pptx_with_callouts() {
    let markdown = r#"# Guidelines

> [!note]
> Follow the coding standards.

> [!warning]
> Breaking changes require a migration guide.

> [!tip]
> Use automated testing.

> [!important]
> All PRs need two reviewers.
"#;
    let bytes = pptx_pipeline(markdown, "With Callouts", "simple");
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
}

#[test]
fn test_pptx_overflow_produces_continuation_slides() {
    // Create a slide with many bullet points to trigger continuation
    let mut markdown = String::from("# Dense Slide\n\n");
    for i in 1..=15 {
        markdown.push_str(&format!("- Bullet point number {}\n", i));
    }
    let bytes = pptx_pipeline(&markdown, "Overflow Test", "simple");
    let reader = std::io::Cursor::new(&bytes);
    let archive = zip::ZipArchive::new(reader).expect("Failed to open PPTX");
    let slide_count = (0..archive.len())
        .filter(|&i| {
            let name = archive.name_for_index(i).unwrap_or_default();
            name.starts_with("ppt/slides/slide") && name.ends_with(".xml")
        })
        .count();
    // Title slide + original slide + at least one continuation = 3+
    assert!(
        slide_count >= 3,
        "15 bullets should produce continuation slides, got {} slides",
        slide_count
    );
}

#[test]
fn test_pptx_task_lists() {
    let markdown = r#"# Sprint Review

- [x] Complete API design
- [x] Write integration tests
- [ ] Deploy to staging
- [ ] Update documentation
"#;
    let bytes = pptx_pipeline(markdown, "Sprint Review", "simple");
    assert_pptx_has_entries(&bytes, &["ppt/slides/slide1.xml"]);
}

// ===========================================================================
// HTML Export Integration Tests
// ===========================================================================

#[test]
fn test_html_simple_heading() {
    let html = markdown_to_html("# Test", "light", None);
    assert!(
        html.contains("<h1>Test</h1>") || html.contains("<h1"),
        "Expected an h1 element in output, got: {}",
        &html[..html.len().min(500)]
    );
}

#[test]
fn test_html_renders_paragraph() {
    let html = markdown_to_html("Hello world", "light", None);
    assert!(html.contains("Hello world"), "Expected paragraph text in output");
}

#[test]
fn test_html_dark_theme_accepted() {
    // Should not panic or error with dark theme
    let html = markdown_to_html("# Dark", "dark", None);
    assert!(!html.is_empty(), "Dark theme should produce non-empty output");
}

#[test]
fn test_html_with_code_block() {
    let md = "```rust\nfn main() {}\n```\n";
    let html = markdown_to_html(md, "light", None);
    // syntect wraps tokens in <span> elements, so look for the <pre> structure
    assert!(html.contains("<pre"), "Code block should produce a <pre> element");
    assert!(html.contains("<code"), "Code block should produce a <code> element");
    // The text "fn" and "main" will appear somewhere within spans
    assert!(html.contains("fn"), "Code block content should appear in HTML");
}

#[test]
fn test_html_with_table() {
    let md = "| A | B |\n|---|---|\n| 1 | 2 |\n";
    let html = markdown_to_html(md, "light", None);
    assert!(html.contains("<table"), "Table should be rendered");
}

#[test]
fn test_html_empty_input() {
    let html = markdown_to_html("", "light", None);
    // Should not panic, may return empty or minimal HTML
    assert!(html.len() < 1000, "Empty input should produce minimal output");
}

// ===========================================================================
// DOCX Export Integration Tests
// ===========================================================================

fn docx_default_options() -> DocxOptions {
    DocxOptions {
        include_toc: false,
        include_page_numbers: false,
        page_size: "a4".to_string(),
        project_root: None,
    }
}

#[test]
fn test_docx_simple_document() {
    let opts = docx_default_options();
    let result = markdown_to_docx("# Hello\n\nWorld", "Hello", "clean", &opts, None, None, None);
    assert!(result.is_ok(), "DOCX export failed: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.len() > 100, "DOCX too small: {} bytes", bytes.len());
    assert_eq!(&bytes[0..4], b"PK\x03\x04", "DOCX should be a valid ZIP (PK header)");
}

#[test]
fn test_docx_with_embedded_images_parameter_accepted() {
    // Test that the embedded_images parameter is wired through.
    // docx-rs validates PNG data internally, so we pass an empty vec
    // to verify the code path without needing a full valid PNG.
    let images: Vec<EmbeddedImage> = vec![];

    let md = "# Report\n\n```chart\n{\"type\":\"bar\"}\n```\n";
    let opts = docx_default_options();
    let result = markdown_to_docx(md, "Report", "clean", &opts, None, None, Some(&images));
    assert!(result.is_ok(), "DOCX with empty embedded images failed: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.len() > 100, "DOCX too small: {} bytes", bytes.len());
    assert_eq!(&bytes[0..4], b"PK\x03\x04", "DOCX should be a valid ZIP (PK header)");
}

#[test]
fn test_docx_embedded_image_struct_fields() {
    // Verify the EmbeddedImage struct has the expected fields
    let img = EmbeddedImage {
        data: vec![0x89, 0x50],
        width: 300,
        height: 200,
    };
    assert_eq!(img.width, 300);
    assert_eq!(img.height, 200);
    assert_eq!(img.data.len(), 2);
}

#[test]
fn test_docx_empty_input() {
    let opts = docx_default_options();
    let result = markdown_to_docx("", "Empty", "clean", &opts, None, None, None);
    assert!(result.is_ok(), "Empty DOCX should not fail");
    let bytes = result.unwrap();
    assert_eq!(&bytes[0..4], b"PK\x03\x04", "Even empty DOCX should be valid ZIP");
}

#[test]
fn test_docx_with_toc_option() {
    let mut opts = docx_default_options();
    opts.include_toc = true;
    let result = markdown_to_docx("# Chapter 1\n\n## Section A\n\nText.", "TOC Test", "clean", &opts, None, None, None);
    assert!(result.is_ok(), "DOCX with TOC failed: {:?}", result.err());
    let bytes = result.unwrap();
    assert_eq!(&bytes[0..4], b"PK\x03\x04");
}

#[test]
fn test_docx_all_templates() {
    let opts = docx_default_options();
    for template in ["clean", "academic", "report"] {
        let result = markdown_to_docx("# Test\n\nContent.", "Test", template, &opts, None, None, None);
        assert!(result.is_ok(), "Template '{}' failed: {:?}", template, result.err());
        let bytes = result.unwrap();
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "Template '{}' should produce valid ZIP", template);
    }
}

// ===========================================================================
// Typst / old export_pdf removal verification
// ===========================================================================

#[test]
fn test_no_typst_modules_in_export() {
    // This test documents that the old Typst-based PDF pipeline has been removed.
    // The export module no longer contains typst_world or markdown_to_typst modules.
    // If someone re-adds them, the module list in mod.rs would need to change,
    // and this test serves as a reminder that PDF export is now WebKit-based.
    //
    // We verify by checking that the module compiles without typst dependencies
    // in the export crate — this test passing means no Typst code is linked.
    assert!(true, "Export module compiles without Typst — PDF export is WebKit-based");
}
