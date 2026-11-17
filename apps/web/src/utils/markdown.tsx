import type { ReactNode } from 'react';

/**
 * Render the subset of Markdown used by uploaded research documents.
 * React escapes text nodes, while links are limited to http(s) URLs.
 */
export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let orderedList = false;
  let quoteLines: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    nodes.push(
      <p key={`paragraph-${nodes.length}`}>
        {renderInlineMarkdown(paragraph.join(' '))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const List = orderedList ? 'ol' : 'ul';
    nodes.push(
      <List key={`list-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li key={`${index}-${item}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </List>,
    );
    listItems = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    nodes.push(
      <blockquote key={`quote-${nodes.length}`}>
        {quoteLines.map((line, index) => (
          <p key={`${index}-${line}`}>{renderInlineMarkdown(line)}</p>
        ))}
      </blockquote>,
    );
    quoteLines = [];
  };

  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (codeLines) {
      if (/^```/.test(trimmed)) {
        nodes.push(
          <pre key={`code-${nodes.length}`}>
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = null;
      } else {
        codeLines.push(raw);
      }
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushBlocks();
      codeLines = [];
      continue;
    }
    if (!trimmed) {
      flushBlocks();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushBlocks();
      const Tag = `h${heading[1].length}` as keyof JSX.IntrinsicElements;
      nodes.push(
        <Tag key={`heading-${nodes.length}`}>
          {renderInlineMarkdown(heading[2])}
        </Tag>,
      );
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
      flushBlocks();
      nodes.push(<hr key={`rule-${nodes.length}`} />);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }
    if (quoteLines.length) flushQuote();

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const isOrdered = Boolean(numbered);
      if (listItems.length && orderedList !== isOrdered) flushList();
      orderedList = isOrdered;
      listItems.push((bullet ?? numbered)![1]);
      continue;
    }
    if (listItems.length) flushList();

    const next = lines[index + 1]?.trim() ?? '';
    if (trimmed.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next)) {
      flushBlocks();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitTableRow(lines[index].trim()));
        index += 1;
      }
      index -= 1;
      nodes.push(
        <div className="markdown-table-scroll" key={`table-${nodes.length}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th key={`${cellIndex}-${cell}`}>{renderInlineMarkdown(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`}>
                      {renderInlineMarkdown(row[cellIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    paragraph.push(trimmed);
  }

  if (codeLines) {
    nodes.push(
      <pre key={`code-${nodes.length}`}>
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
  }
  flushBlocks();
  return nodes;
}

function splitTableRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return value.split('|').map((cell) => cell.trim());
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  value.replace(pattern, (match, _group, offset: number) => {
    if (offset > cursor) nodes.push(value.slice(cursor, offset));
    if (match.startsWith('**') || match.startsWith('__')) {
      nodes.push(<strong key={`${offset}-strong`}>{match.slice(2, -2)}</strong>);
    } else if (match.startsWith('~~')) {
      nodes.push(<del key={`${offset}-delete`}>{match.slice(2, -2)}</del>);
    } else if (match.startsWith('*') || match.startsWith('_')) {
      nodes.push(<em key={`${offset}-italic`}>{match.slice(1, -1)}</em>);
    } else if (match.startsWith('`')) {
      nodes.push(<code key={`${offset}-code`}>{match.slice(1, -1)}</code>);
    } else {
      const link = match.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        nodes.push(
          <a key={`${offset}-link`} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(match);
      }
    }
    cursor = offset + match.length;
    return match;
  });
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}
