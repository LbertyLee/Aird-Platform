import { researchSearchJobSnapshotSchema } from '@agent/contracts';
import type { ResearchSearchJobSnapshot } from '@agent/contracts';

/** Incremental SSE decoding: UTF-8, CR/LF, comments and multiline data. */
export class SearchJobEventDecoder {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private skipLf = false;

  push(text: string): ResearchSearchJobSnapshot[] {
    const snapshots: ResearchSearchJobSnapshot[] = [];
    for (const char of text) {
      if (this.skipLf && char === '\n') { this.skipLf = false; continue; }
      this.skipLf = false;
      if (char !== '\r' && char !== '\n') {
        this.buffer += char;
        if (this.buffer.length > 16_000_000) throw new Error('SSE frame too large');
        continue;
      }
      this.skipLf = char === '\r';
      const line = this.buffer;
      this.buffer = '';
      if (!line) {
        if (this.event === 'snapshot' && this.data.length) {
          snapshots.push(researchSearchJobSnapshotSchema.parse(JSON.parse(this.data.join('\n'))));
        }
        this.event = '';
        this.data = [];
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') this.event = value;
        if (field === 'data') this.data.push(value);
      }
    }
    return snapshots;
  }
}
