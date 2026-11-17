/**
 * Keep fixed-size chunking available for compatibility, while making the
 * configured "smart" mode respect paragraph and sentence boundaries first.
 */
export function chunkKnowledgeText(
  text: string,
  size: number,
  overlap: number,
  method = 'smart',
): string[] {
  const normalizedSize = Math.max(1, size);
  const normalizedOverlap = Math.min(Math.max(0, overlap), normalizedSize - 1);
  const cleaned = text.replace(/\r\n?/g, '\n').trim();
  if (!cleaned) return [];

  if (method !== 'smart') {
    return fixedChunks(
      cleaned.replace(/\s+/g, ' '),
      normalizedSize,
      normalizedOverlap,
    );
  }

  // Some DOCX parsers flatten paragraph breaks into spaces. Restore the
  // report-style section boundaries before chunking so a heading never lands
  // at the end of the previous chunk.
  const sectionized = cleaned
    .replace(/[ \t]+/g, ' ')
    .replace(
      /\s+(?=(?:[一二三四五六七八九十]+、|\d+\.\d+(?:\s|$)|报告声明(?:\s|$)|报告生成日期(?:\s|$)))/g,
      '\n\n',
    );
  const units = sectionized
    // Keep spreadsheet/table rows as atomic units. Normal prose paragraphs
    // are also safe to split by line here because the aggregator below joins
    // adjacent units back into chunks up to the configured size.
    .split(/\n+/)
    .flatMap((paragraph) => splitLongUnit(paragraph.trim(), normalizedSize))
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }
    // A new section starts a fresh chunk even when there is room left. This
    // keeps headings together with their following content and prevents
    // awkward boundaries such as "二、政策环境" at the previous chunk's end.
    if (isHeadingUnit(unit) && current) {
      chunks.push(current);
      current = unit;
      continue;
    }
    if (current.length + 2 + unit.length <= normalizedSize) {
      current = `${current}\n\n${unit}`;
      continue;
    }
    chunks.push(current);
    const prefix = normalizedOverlap && !isHeadingUnit(unit)
      ? current.slice(-normalizedOverlap).trim()
      : '';
    current = prefix ? `${prefix}\n\n${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

function isHeadingUnit(unit: string): boolean {
  return /^(?:[一二三四五六七八九十]+、|\d+\.\d+(?:\s|$)|报告声明(?:\s|$)|报告生成日期(?:\s|$))/.test(unit.trim());
}

function splitLongUnit(unit: string, size: number): string[] {
  if (unit.length <= size) return [unit];
  const sentences = unit.match(/[^。！？.!?]+[。！？.!?]?/g) ?? [unit];
  const result: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const value = sentence.trim();
    if (!value) continue;
    if (value.length > size) {
      if (current) result.push(current);
      result.push(...fixedChunks(value, size, 0));
      current = '';
    } else if (!current || current.length + 1 + value.length <= size) {
      current = current ? `${current} ${value}` : value;
    } else {
      result.push(current);
      current = value;
    }
  }
  if (current) result.push(current);
  return result;
}

function fixedChunks(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push(text.slice(start, start + size));
  }
  return chunks;
}
