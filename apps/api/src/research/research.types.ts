import type { ResearchSource, StorageType } from '@agent/contracts';

export interface SourceEntity extends ResearchSource {
  textContent: string;
  structuredData?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CreateSourceInput {
  title: string;
  origin: 'upload' | 'exa' | 'local';
  storageType: StorageType;
  sourceUrl?: string;
  mimeType?: string;
  textContent: string;
  searchText: string;
  structuredData?: unknown;
  metadata?: Record<string, unknown>;
  recordCount: number;
}

export interface ExaResult {
  /** Verified official API rows; persisted without model re-extraction. */
  officialData?: Array<Record<string, unknown>>;
  /** Provider identifier for structured official API results. */
  officialProvider?: string;
  title: string;
  url: string;
  description: string;
  extraSnippets: string[];
  /** Exa relevance score. Older responses may omit it. */
  score?: number;
  /** Normalized Exa score (0–1) after platform ranking. */
  exaScore?: number;
  /** Platform business composite (0–1) after platform ranking. */
  platformScore?: number;
}

export interface ParsedDocument {
  storageType: StorageType;
  textContent: string;
  structuredData?: unknown;
  recordCount: number;
  metadata: Record<string, unknown>;
}
