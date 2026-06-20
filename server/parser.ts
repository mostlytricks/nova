export interface LlmsLink {
  title: string;
  url: string;
  description?: string;
}

export interface LlmsSection {
  name: string;
  links: LlmsLink[];
}

export interface LlmsDoc {
  title: string;
  summary?: string;
  note?: string;           // operator note, written as `> Note: ...` blockquote after summary
  intro?: string;          // any other free-text / blockquotes between summary and first H2
  sections: LlmsSection[];
}

const LINK_RE = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?::\s*(.+?))?\s*$/;

export function parseLlmsTxt(input: string): LlmsDoc {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  // Title
  let title = '';
  while (i < lines.length) {
    const m = lines[i].match(/^#\s+(.+)$/);
    if (m) { title = m[1].trim(); i++; break; }
    i++;
  }

  // Summary (first blockquote)
  let summary: string | undefined;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && lines[i].startsWith('>')) {
    const parts: string[] = [];
    while (i < lines.length && lines[i].startsWith('>')) {
      parts.push(lines[i].replace(/^>\s?/, ''));
      i++;
    }
    summary = parts.join('\n').trim();
  }

  // Anything between summary and first H2:
  //  - A blockquote whose first line starts with `Note:` becomes the operator note.
  //  - Everything else is preserved as `intro`.
  const introLines: string[] = [];
  let note: string | undefined;
  while (i < lines.length && !/^##\s+/.test(lines[i]) && !LINK_RE.test(lines[i])) {
    if (lines[i].startsWith('>')) {
      const blockStart = i;
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        parts.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const text = parts.join('\n').trim();
      const m = text.match(/^Note:\s*([\s\S]+)$/i);
      if (m && note === undefined) {
        note = m[1].trim();
      } else {
        for (let j = blockStart; j < i; j++) introLines.push(lines[j]);
      }
      continue;
    }
    introLines.push(lines[i]);
    i++;
  }
  const intro = introLines.join('\n').trim() || undefined;

  // Sections
  const sections: LlmsSection[] = [];
  let current: LlmsSection | null = null;
  while (i < lines.length) {
    const h2 = lines[i].match(/^##\s+(.+)$/);
    if (h2) {
      current = { name: h2[1].trim(), links: [] };
      sections.push(current);
      i++;
      continue;
    }
    const linkMatch = lines[i].match(LINK_RE);
    if (linkMatch) {
      if (!current) {
        current = { name: 'Docs', links: [] };
        sections.push(current);
      }
      current.links.push({
        title: linkMatch[1].trim(),
        url: linkMatch[2].trim(),
        description: linkMatch[3]?.trim(),
      });
    }
    i++;
  }

  return { title, summary, note, intro, sections };
}

export function serializeLlmsTxt(doc: LlmsDoc): string {
  const out: string[] = [];
  out.push(`# ${doc.title}`);
  out.push('');
  if (doc.summary) {
    for (const line of doc.summary.split('\n')) out.push(`> ${line}`);
    out.push('');
  }
  if (doc.note) {
    const noteLines = doc.note.split('\n');
    out.push(`> Note: ${noteLines[0]}`);
    for (const line of noteLines.slice(1)) out.push(`> ${line}`);
    out.push('');
  }
  if (doc.intro) {
    out.push(doc.intro);
    out.push('');
  }
  for (const section of doc.sections) {
    out.push(`## ${section.name}`);
    out.push('');
    for (const link of section.links) {
      const desc = link.description ? `: ${link.description}` : '';
      out.push(`- [${link.title}](${link.url})${desc}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
