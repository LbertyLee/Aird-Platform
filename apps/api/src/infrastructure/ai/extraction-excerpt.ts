/** Keep relevant passages anywhere in a long document, including table context. */
export function extractionPassages(content: string, limit = 18_000): string[] {
  if (content.length <= limit) return [content];
  // Cover the whole body. Overlap retains sentences/rows at page boundaries;
  // the introduction preserves the document subject and common unit headers.
  const prefix = content.slice(0, Math.min(1500, Math.floor(limit / 8)));
  const separator = '\n\n[…]\n\n';
  const size = limit - prefix.length - separator.length;
  const overlap = Math.min(1500, Math.floor(size / 4));
  const passages: string[] = [];
  for (let start = 0; start < content.length; start += size - overlap) {
    const end = Math.min(content.length, start + size);
    passages.push(
      start === 0
        ? content.slice(start, end)
        : prefix + separator + content.slice(start, end),
    );
    if (end === content.length) break;
  }
  return passages;
}

export function extractionExcerpt(
  content: string,
  terms: string[],
  limit = 18_000,
): string {
  if (content.length <= limit) return content;
  const needles = [
    ...new Set(
      terms
        .map((term) => term.toLowerCase().trim())
        .filter((term) => term.length > 1),
    ),
  ];
  const prefix = content.slice(0, Math.min(1500, Math.floor(limit / 8)));
  const tableExcerpt = relevantMarkdownTables(
    content,
    needles,
    Math.floor(limit * 0.55),
  );
  const separator = '\n\n[…]\n\n';
  const contextLimit = Math.max(
    2000,
    limit -
      prefix.length -
      (tableExcerpt ? tableExcerpt.length + separator.length : 0),
  );
  const windows: Array<{ start: number; end: number; score: number }> = [];
  for (let start = 0; start < content.length; start += 2400) {
    const end = Math.min(content.length, start + 3000);
    const text = content.slice(start, end).toLowerCase();
    const score =
      needles.reduce((sum, term) => sum + (text.includes(term) ? 4 : 0), 0) +
      Math.min(
        (
          text.match(
            /\d+(?:\.\d+)?\s*(?:亿元|万亿|%|％|美元|billion|trillion)/g,
          ) ?? []
        ).length,
        10,
      );
    windows.push({ start, end, score });
  }
  const selected: Array<{ start: number; end: number; score: number }> = [];
  let used = 0;
  for (const window of windows.sort(
    (a, b) => b.score - a.score || a.start - b.start,
  )) {
    if (
      window.start === 0 ||
      selected.some(
        (item) => window.start >= item.start && window.end <= item.end,
      )
    )
      continue;
    if (used + window.end - window.start + 10 > contextLimit) continue;
    selected.push(window);
    used += window.end - window.start + 10;
  }
  const context = selected
    .sort((a, b) => a.start - b.start)
    .map((item) => content.slice(item.start, item.end))
    .join(separator);
  return [prefix, tableExcerpt, context]
    .filter(Boolean)
    .join(separator)
    .slice(0, limit);
}

function relevantMarkdownTables(
  content: string,
  needles: string[],
  budget: number,
): string {
  const lines = content.split('\n');
  const tables: Array<{ lines: string[]; score: number }> = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (
      !isMarkdownTableRow(lines[index]) ||
      !isMarkdownTableDivider(lines[index + 1])
    )
      continue;
    const start = index;
    const tableLines = [lines[index]!, lines[index + 1]!];
    index += 2;
    while (index < lines.length && isMarkdownTableRow(lines[index])) {
      tableLines.push(lines[index]!);
      index += 1;
    }
    index -= 1;
    const text = tableLines.join('\n');
    const lower = text.toLowerCase();
    const matches = needles.filter((needle) => lower.includes(needle)).length;
    const numericRows = tableLines
      .slice(2)
      .filter((line) => /\d/.test(line)).length;
    tables.push({
      lines: tableLines,
      score: matches * 10 + Math.min(numericRows, 10),
    });
    if (start === index) index += 1;
  }

  let remaining = budget;
  const selected: string[] = [];
  for (const table of tables.sort((a, b) => b.score - a.score)) {
    if (remaining < 100) break;
    const full = table.lines.join('\n');
    if (full.length <= remaining) {
      selected.push(full);
      remaining -= full.length + 2;
      continue;
    }
    const rows = table.lines.slice(2);
    const ranked = rows
      .map((row, index) => ({
        row,
        index,
        score: needles.filter((needle) => row.toLowerCase().includes(needle))
          .length,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const kept = new Set<number>();
    let size = table.lines[0]!.length + table.lines[1]!.length + 2;
    for (const row of ranked) {
      if (size + row.row.length + 1 > remaining) continue;
      kept.add(row.index);
      size += row.row.length + 1;
    }
    if (kept.size) {
      selected.push(
        [
          table.lines[0],
          table.lines[1],
          ...[...kept].sort((a, b) => a - b).map((rowIndex) => rows[rowIndex]),
        ].join('\n'),
      );
      remaining -= size + 2;
    }
  }
  return selected.join('\n\n');
}

function isMarkdownTableRow(line: string | undefined): boolean {
  return Boolean(line && /^\s*\|.*\|\s*$/.test(line));
}

function isMarkdownTableDivider(line: string | undefined): boolean {
  return Boolean(
    line && /^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
  );
}
