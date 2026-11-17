import { http } from './http';
import { SearchJobEventDecoder } from './search-job-events';
import {
  BackgroundJobFailedError,
  resumeTask,
  retryTaskRequest,
  runWorkJob,
} from './background-jobs';
import { researchSearchResponseSchema } from '@agent/contracts';
import type {
  ResearchFilters,
  ResearchSearchResponse,
  ResearchSearchMode,
  ResearchSearchJobCreateResponse,
  ResearchSearchJobSnapshot,
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualReport,
} from '@agent/contracts';

export class SearchClientTimeoutError extends Error {
  constructor() {
    super('client_timeout');
    this.name = 'SearchClientTimeoutError';
  }
}

const SEARCH_JOB_POLL_INTERVAL_MS = 2000;
export const SEARCH_MAX_WAIT_MS = 600_000;

export interface DataAnalysisServiceStatus {
  vectorSearch: boolean;
}

export async function getDataAnalysisStatus(): Promise<DataAnalysisServiceStatus> {
  const response = await http.get<DataAnalysisServiceStatus>(
    '/data-analysis/status',
  );
  return response.data;
}

export async function searchDataAnalysis(
  query: string,
  filters?: ResearchFilters,
  mode: ResearchSearchMode = 'mixed',
  signal?: AbortSignal,
  model?: string,
): Promise<ResearchSearchResponse> {
  const response = await http.post<ResearchSearchResponse>(
    '/search/query',
    { query, filters, mode, model },
    { signal, timeout: SEARCH_MAX_WAIT_MS },
  );
  return response.data;
}

export async function createSearchJob(
  query: string,
  filters?: ResearchFilters,
  mode: ResearchSearchMode = 'mixed',
  signal?: AbortSignal,
  requestId?: string,
  model?: string,
): Promise<ResearchSearchJobCreateResponse> {
  const response = await http.post<ResearchSearchJobCreateResponse>(
    '/search/jobs',
    { query, filters, mode, model },
    {
      signal,
      timeout: 30_000,
      headers: requestId ? { 'X-Request-Id': requestId } : undefined,
    },
  );
  return response.data;
}

export async function getSearchJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<ResearchSearchJobSnapshot> {
  const response = await http.get<ResearchSearchJobSnapshot>(
    `/search/jobs/${encodeURIComponent(jobId)}`,
    { signal, timeout: 30_000 },
  );
  return response.data;
}

function sleepMs(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function subscribeSearchJob(
  jobId: string,
  signal: AbortSignal,
  onSnapshot?: (snapshot: ResearchSearchJobSnapshot) => void,
): Promise<ResearchSearchJobSnapshot | undefined> {
  const subscription = new AbortController();
  const abort = () => subscription.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) subscription.abort();
  let idleTimer: ReturnType<typeof setTimeout>;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, 30_000);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    resetIdle();
    // Fetch adapter retains the shared bearer-token and refresh interceptors.
    const response = await http.get<ReadableStream<Uint8Array>>(
      `/search/jobs/${encodeURIComponent(jobId)}/events`,
      {
        adapter: 'fetch',
        responseType: 'stream',
        timeout: 0,
        signal: subscription.signal,
        headers: { Accept: 'text/event-stream' },
      },
    );
    if (
      !String(response.headers['content-type']).includes('text/event-stream')
    ) {
      throw new Error('Unsupported search event stream');
    }
    reader = response.data.getReader();
    const textDecoder = new TextDecoder();
    const events = new SearchJobEventDecoder();
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      resetIdle();
      for (const snapshot of events.push(
        textDecoder.decode(value, { stream: true }),
      )) {
        if (snapshot.jobId !== jobId) throw new Error('Unexpected search job');
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        onSnapshot?.(snapshot);
        if (snapshot.status !== 'running') return snapshot;
      }
    }
    throw new DOMException('Aborted', 'AbortError');
  } finally {
    clearTimeout(idleTimer!);
    signal.removeEventListener('abort', abort);
    subscription.abort();
    await reader?.cancel().catch(() => undefined);
  }
}

/** SSE first; transport failures fall back to polling the same background job. */
export async function waitForSearchJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onSnapshot?: (snapshot: ResearchSearchJobSnapshot) => void;
  } = {},
): Promise<ResearchSearchResponse> {
  const pollIntervalMs = options.pollIntervalMs ?? SEARCH_JOB_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  // A caller may set a deadline; active background jobs have no default UI deadline.
  const deadline =
    maxWaitMs && Number.isFinite(maxWaitMs)
      ? setTimeout(() => {
          timedOut = true;
          abort();
        }, maxWaitMs)
      : undefined;
  try {
    if (controller.signal.aborted)
      throw new DOMException('Aborted', 'AbortError');
    let streamed: ResearchSearchJobSnapshot | undefined;
    try {
      streamed = await subscribeSearchJob(
        jobId,
        controller.signal,
        options.onSnapshot,
      );
    } catch (error) {
      if (controller.signal.aborted) throw error;
      // Auth/ownership failures must not be hidden by transport fallback.
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 401 || status === 403 || status === 404) throw error;
    }
    while (!controller.signal.aborted) {
      const snap =
        streamed ??
        (await retryTaskRequest(
          () => getSearchJob(jobId, controller.signal),
          controller.signal,
        ));
      if (controller.signal.aborted)
        throw new DOMException('Aborted', 'AbortError');
      if (!streamed) options.onSnapshot?.(snap);
      if (snap.status === 'completed') {
        if (!snap.result)
          throw new BackgroundJobFailedError(
            '检索已完成但未返回结果，请重试。',
          );
        return snap.result;
      }
      if (snap.status === 'failed')
        throw new BackgroundJobFailedError(snap.error || '检索失败');
      streamed = undefined;
      await sleepMs(pollIntervalMs, controller.signal);
    }
    throw new DOMException('Aborted', 'AbortError');
  } catch (error) {
    if (timedOut) throw new SearchClientTimeoutError();
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

export async function searchDataAnalysisAsync(
  query: string,
  filters?: ResearchFilters,
  mode: ResearchSearchMode = 'mixed',
  signal?: AbortSignal,
  maxWaitMs?: number,
  onSnapshot?: (snapshot: ResearchSearchJobSnapshot) => void,
  searchIdentity?: string | number,
  model?: string,
): Promise<ResearchSearchResponse> {
  return resumeTask(
    { kind: 'search', query, filters, mode, searchIdentity, model },
    (requestId) =>
      createSearchJob(query, filters, mode, signal, requestId, model),
    (jobId) => waitForSearchJob(jobId, { signal, maxWaitMs, onSnapshot }),
    signal,
  );
}

export interface ResearchHistoryItem {
  id: string;
  query: string;
  createdAt: string;
  result: ResearchSearchResponse;
  analysis?: AnalysisSession;
}

export async function getResearchHistory(): Promise<ResearchHistoryItem[]> {
  const response = await http.get<unknown>('/search/history');
  if (!Array.isArray(response.data)) return [];
  return response.data.flatMap((item) => {
    if (!isHistoryItem(item)) return [];
    const result = researchSearchResponseSchema.safeParse(item.result);
    if (!result.success) return [];
    return [
      {
        id: item.id,
        query: item.query,
        createdAt: item.createdAt,
        result: result.data,
      },
    ];
  });
}

export async function deleteResearchHistory(id: string): Promise<void> {
  await http.delete(`/search/history/${encodeURIComponent(id)}`);
}

function isHistoryItem(
  value: unknown,
): value is { id: string; query: string; createdAt: string; result: unknown } {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.query === 'string' &&
    typeof item.createdAt === 'string' &&
    'result' in item
  );
}

export interface AnalysisSessionSource {
  id: string;
  title: string;
  origin: 'upload' | 'exa' | 'local';
  capability: 'structured' | 'extractable' | 'reference-only';
  rowCount: number;
  observationCount: number;
  indicatorNames?: string[];
  message: string;
}

export interface AnalysisSessionIndicator {
  id: string;
  code: string;
  name: string;
  unit: string;
  definition: string;
  mappedSourceIds: string[];
}

export interface AnalysisObservation {
  sourceId: string;
  source: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  value: number | null;
  originalValue: unknown;
  originalUnit?: string;
  unit: string;
  normalizedValue?: number | null;
  normalizationStatus?: 'same' | 'converted' | 'unknown';
  period?: string;
  entity?: string;
  citation: { rowIndex: number; field: string };
}

export interface AnalysisSummaryRow {
  key: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  unit: string;
  entity?: string;
  period?: string;
  value: number | null;
  observationCount: number;
  sourceCount: number;
  duplicateCount: number;
  conflict: boolean;
  sourceIds: string[];
}

/** Dev: one LLM extraction round-trip (prompt + 原文 + response). */
export interface LlmExtractionTrace {
  sourceTitle: string;
  sourceOrigin: string;
  sourceUrl?: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  documentExcerpt: string;
  documentCharCount: number;
  preferredCodes: string[];
  query?: string;
  rawResponse?: string;
  itemCount: number;
  error?: string;
  durationMs: number;
  createdAt: string;
}

/** Dimensions parsed from the research question (not from source text). */
export interface QueryDimensions {
  entities: string[];
  periods: string[];
  preferredIndicatorCodes: string[];
}

export interface AnalysisSession {
  runId?: string;
  presentation?: AnalysisPresentation;
  visualReport?: AnalysisVisualReport;
  visualDatasets?: AnalysisVisualDataset[];
  id: string;
  createdAt: string;
  query: string;
  status: 'ready' | 'partial';
  selectedSourceIds: string[];
  preferredIndicatorIds?: string[];
  queryDimensions?: QueryDimensions;
  sources: AnalysisSessionSource[];
  availableIndicators: AnalysisSessionIndicator[];
  rows: Array<
    Record<string, unknown> & { __source: string; __sourceId: string }
  >;
  observations: AnalysisObservation[];
  summary: AnalysisSummaryRow[];
  llmSummary?: string;
  warnings: string[];
  /** Dev: full prompts + document excerpts for each extraction call. */
  llmExtractionTraces?: LlmExtractionTrace[];
}

export async function getRecentAnalysisSessions(
  runIds: string[],
  signal?: AbortSignal,
): Promise<AnalysisSession[]> {
  if (!runIds.length) return [];
  return (
    await http.post<AnalysisSession[]>(
      '/analysis/sessions/recent',
      { runIds: runIds.slice(0, 4) },
      { signal },
    )
  ).data;
}

export async function saveAnalysisPresentation(
  id: string,
  presentation: AnalysisPresentation,
  generateReport = false,
  signal?: AbortSignal,
): Promise<AnalysisSession> {
  const url = `/analysis/sessions/${encodeURIComponent(id)}/${generateReport ? 'report' : 'presentation'}`;
  return (
    await http.request<AnalysisSession>({
      url,
      method: generateReport ? 'POST' : 'PUT',
      data: presentation,
      signal,
    })
  ).data;
}

export async function createAnalysisSession(
  input: {
    runId: string;
    query: string;
    sourceIds: string[];
    indicatorIds?: string[];
  },
  signal?: AbortSignal,
): Promise<AnalysisSession> {
  return runWorkJob<AnalysisSession>('analysis', input, signal);
}

export async function getAnalysisSession(
  id: string,
  signal?: AbortSignal,
): Promise<AnalysisSession> {
  const response = await http.get<AnalysisSession>(`/analysis/sessions/${id}`, {
    signal,
  });
  return response.data;
}

export async function exportAnalysisSession(
  id: string,
  columns?: string[],
  signal?: AbortSignal,
  presentation?: AnalysisPresentation,
): Promise<Blob> {
  const response = await http.post<Blob>(
    `/analysis/sessions/${encodeURIComponent(id)}/export.xlsx`,
    { columns, ...(presentation ? { presentation } : {}) },
    { responseType: 'blob', signal },
  );
  return response.data;
}

export type KnowledgeSourcePreview =
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: 'application/pdf';
      sourceUrl: string;
    }
  | {
      kind: 'document';
      fileName: string;
      text: string;
      truncated: boolean;
      sourceUrl?: string;
    }
  | { kind: 'html'; fileName: string; html: string; truncated: boolean }
  | {
      kind: 'spreadsheet';
      fileName: string;
      sheetName: string;
      rows: string[][];
      totalRows: number;
      totalColumns: number;
      truncated: boolean;
    };

export async function getKnowledgeSourcePreview(sourceId: string) {
  const response = await http.get<KnowledgeSourcePreview>(
    `/search/sources/${sourceId}/preview-url`,
  );
  return response.data;
}
