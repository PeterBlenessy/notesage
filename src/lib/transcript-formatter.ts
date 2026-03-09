export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  duration_secs: number;
  language: string;
}

function formatTimestamp(seconds: number, showHours: boolean): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (showHours) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTranscript(result: TranscriptionResult, title: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dateDisplay = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const showHours = result.duration_secs >= 3600;

  // Collect unique speakers
  const speakers = [
    ...new Set(
      result.segments
        .map((s) => s.speaker)
        .filter((s): s is string => !!s)
    ),
  ];

  // Build YAML frontmatter
  const frontmatter = [
    '---',
    'type: meeting-transcript',
    `date: ${dateStr}`,
    `duration: "${formatDuration(result.duration_secs)}"`,
  ];
  if (speakers.length > 0) {
    frontmatter.push('participants:');
    for (const speaker of speakers) {
      frontmatter.push(`  - ${speaker}`);
    }
  }
  frontmatter.push('tags:', '  - meeting', '---');

  // Build transcript body
  const heading = `# ${title || `Meeting Transcript — ${dateDisplay}`}`;

  const lines: string[] = [];
  for (const segment of result.segments) {
    const ts = formatTimestamp(segment.start, showHours);
    const text = segment.text.trim();
    if (!text) continue;

    if (segment.speaker) {
      lines.push(`**[${ts}] ${segment.speaker}:** ${text}`);
    } else {
      lines.push(`**[${ts}]** ${text}`);
    }
  }

  return `${frontmatter.join('\n')}\n\n${heading}\n\n${lines.join('\n\n')}\n`;
}
