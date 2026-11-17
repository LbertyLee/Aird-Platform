import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LlmExtractionTrace } from '../../infrastructure/ai/deepseek-chat.service';

/**
 * Persist extraction prompts/原文 to disk for local debugging.
 * Directory: apps/api/.tmp/llm-extraction-traces/<stamp>/
 */
export async function writeLlmExtractionTraces(
  query: string,
  traces: LlmExtractionTrace[],
): Promise<string | null> {
  if (!traces.length) return null;
  const enabled =
    process.env.LLM_EXTRACTION_TRACE === '1' ||
    process.env.LLM_EXTRACTION_TRACE === 'true' ||
    (process.env.LLM_EXTRACTION_TRACE == null &&
      process.env.NODE_ENV !== 'production');
  if (!enabled) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.resolve(process.cwd(), '.tmp', 'llm-extraction-traces', stamp);
  await mkdir(dir, { recursive: true });

  const index = {
    query,
    createdAt: new Date().toISOString(),
    count: traces.length,
    files: [] as string[],
  };

  for (let i = 0; i < traces.length; i += 1) {
    const trace = traces[i];
    const safeTitle = (trace.sourceTitle || 'source')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .slice(0, 60);
    const fileName = `${String(i + 1).padStart(2, '0')}-${safeTitle}.json`;
    await writeFile(path.join(dir, fileName), JSON.stringify(trace, null, 2), 'utf8');
    index.files.push(fileName);

    const promptMd = [
      `# ${trace.sourceTitle}`,
      '',
      `- model: ${trace.model}`,
      `- origin: ${trace.sourceOrigin}`,
      `- url: ${trace.sourceUrl ?? ''}`,
      `- documentChars: ${trace.documentCharCount}`,
      `- itemCount: ${trace.itemCount}`,
      `- durationMs: ${trace.durationMs}`,
      `- error: ${trace.error ?? ''}`,
      '',
      '## System prompt',
      '',
      '```',
      trace.systemPrompt,
      '```',
      '',
      '## User prompt',
      '',
      '```',
      trace.userPrompt,
      '```',
      '',
      '## Document excerpt',
      '',
      '```',
      trace.documentExcerpt,
      '```',
      '',
      '## Raw response',
      '',
      '```',
      trace.rawResponse ?? '',
      '```',
      '',
    ].join('\n');
    await writeFile(
      path.join(dir, fileName.replace(/\.json$/, '.md')),
      promptMd,
      'utf8',
    );
  }

  await writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  return dir;
}
