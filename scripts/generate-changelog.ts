import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

interface ReleaseEntry {
  version: string;
  date: string;
  previousVersion: string;
  sections: {
    features?: string[];
    fixes?: string[];
    improvements?: string[];
  };
}

interface Changelog {
  releases: ReleaseEntry[];
}

const HISTORY_DIR = join(import.meta.dirname, '..', 'docs', 'history');
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public');
const OUTPUT_FILE = join(OUTPUT_DIR, 'changelog.json');

function parseVersion(filename: string): string | null {
  // Accepts stable (`0.43.0`) and pre-release (`0.44.0-alpha.0`) suffixes.
  const match = filename.match(/release-v([\d.]+(?:-[\w.]+)?)\.md$/);
  return match ? match[1] : null;
}

function parseReleaseFile(filepath: string): ReleaseEntry | null {
  const content = readFileSync(filepath, 'utf-8');
  const filename = basename(filepath);
  const version = parseVersion(filename);
  if (!version) return null;

  // Extract date — supports both "**Date:** 2026-02-25 **Previous" and "**Date:** 2026-02-25\n**Previous"
  const dateMatch = content.match(/\*\*Date:\*\*\s*([\d-]+)/);
  const date = dateMatch ? dateMatch[1] : '';

  // Extract previous version
  const prevMatch = content.match(/\*\*Previous version:\*\*\s*([\d.]+)/);
  const previousVersion = prevMatch ? prevMatch[1] : '';

  // Parse sections
  const sections: ReleaseEntry['sections'] = {};

  const sectionPattern = /###\s+(Features|Fixes|Improvements)\s*\n([\s\S]*?)(?=###|\n## |$)/g;
  let match: RegExpExecArray | null;

  while ((match = sectionPattern.exec(content)) !== null) {
    const sectionName = match[1].toLowerCase() as keyof typeof sections;
    const sectionContent = match[2];

    // Parse list items — supports nested items by only capturing top-level
    const items: string[] = [];
    for (const line of sectionContent.split('\n')) {
      const itemMatch = line.match(/^- (.+)/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      }
    }

    if (items.length > 0) {
      sections[sectionName] = items;
    }
  }

  // Skip releases with no sections
  if (!sections.features && !sections.fixes && !sections.improvements) {
    return null;
  }

  return { version, date, previousVersion, sections };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return nb - na; // Descending (newest first)
  }
  return 0;
}

function main() {
  const files = readdirSync(HISTORY_DIR).filter(
    (f) => f.match(/^\d+-release-v[\d.]+(?:-[\w.]+)?\.md$/),
  );

  const releases: ReleaseEntry[] = [];

  for (const file of files) {
    const entry = parseReleaseFile(join(HISTORY_DIR, file));
    if (entry) {
      releases.push(entry);
    }
  }

  // Sort newest first
  releases.sort((a, b) => compareVersions(a.version, b.version));

  const changelog: Changelog = { releases };

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(changelog, null, 2) + '\n');
  console.log(`Generated changelog.json with ${releases.length} releases`);
}

main();
