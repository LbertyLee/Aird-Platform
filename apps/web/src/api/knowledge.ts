import { http } from './http';
import { apiErrorMessage } from './research';

export type KnowledgeVisibility = 'public' | 'private';
export type VectorSyncStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed';

export interface UserKnowledgeLibrary {
  id: string;
  name: string;
  code: string;
  type: string;
  visibility: KnowledgeVisibility;
  intro?: string | null;
  groupCode?: string | null;
  icon: string;
  color: string;
  fileTotal: number;
  fileSize: number;
  chunkMethod?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  recallTopK?: number;
  similarityThreshold?: number;
  hybridSemanticWeight?: number;
  hybridKeywordWeight?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserKnowledgeOverview {
  stats: {
    libraryCount: number;
    documentCount: number;
    learnedCount: number;
    failedCount: number;
  };
  libraries: UserKnowledgeLibrary[];
}

export interface KnowledgeTagBrief {
  id: string;
  name: string;
  code: string;
}

export interface UserKnowledgeItem {
  id: string;
  title: string;
  code: string;
  summary?: string | null;
  content?: string | null;
  visibility: KnowledgeVisibility;
  auditStatus: string;
  publishStatus: string;
  groupCode?: string | null;
  sourceType?: string;
  sourceMeta?: Record<string, unknown> | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  vectorStatus: VectorSyncStatus;
  vectorError?: string | null;
  vectorSyncedAt?: string | null;
  chunkCount: number;
  hitCount?: number;
  auditedAt?: string | null;
  rejectReason?: string | null;
  tags?: KnowledgeTagBrief[];
  submitter?: {
    id: string;
    username: string;
    displayName?: string | null;
  } | null;
  auditor?: {
    id: string;
    username: string;
    displayName?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeGroupOption {
  code: string;
  name: string;
}

export type KnowledgeFilePreview =
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: 'application/pdf';
    }
  | {
      kind: 'document';
      fileName: string;
      text: string;
      truncated: boolean;
    }
  | {
      kind: 'html';
      fileName: string;
      html: string;
      truncated: boolean;
    }
  | {
      kind: 'spreadsheet';
      fileName: string;
      sheetName: string;
      rows: string[][];
      totalRows: number;
      totalColumns: number;
      truncated: boolean;
    };

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateUserKnowledgeLibraryPayload {
  name: string;
  intro?: string;
  visibility?: KnowledgeVisibility;
  color?: string;
}

export interface UpdateKnowledgeLibraryPayload {
  name?: string;
  visibility?: KnowledgeVisibility;
  intro?: string | null;
  chunkMethod?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  recallTopK?: number;
  similarityThreshold?: number;
  hybridSemanticWeight?: number;
  hybridKeywordWeight?: number;
}

export interface KnowledgeRecallHit {
  chunkId: string;
  knowledgeItemId: string;
  title: string;
  content: string;
  score: number;
  chunkIndex: number;
  pageNumber?: number | null;
  section?: string | null;
}

export interface UploadKnowledgeFilePayload {
  libraryId: string;
  file: File;
  groupCode?: string;
  title?: string;
  code?: string;
  summary?: string;
  tags?: string;
}

export interface UpdateKnowledgeItemPayload {
  title?: string;
  tags?: string[];
  groupCode?: string | null;
  summary?: string | null;
}

export async function fetchKnowledgeOverview(): Promise<UserKnowledgeOverview> {
  const { data } = await http.get<UserKnowledgeOverview>(
    '/user/knowledge/overview',
  );
  return data;
}

export interface DepositKnowledgePayload {
  libraryId: string;
  sourceIds: string[];
  groupCode?: string;
  visibility?: KnowledgeVisibility;
  tags?: string[];
}

export interface DepositKnowledgeResult {
  libraryId: string;
  libraryName: string;
  needsAudit: boolean;
  successCount: number;
  failedCount: number;
  message: string;
  errors?: Array<{ sourceId: string; title: string; message: string }>;
}

export async function fetchDepositableLibraries(): Promise<
  UserKnowledgeLibrary[]
> {
  const { data } = await http.get<UserKnowledgeLibrary[]>(
    '/user/knowledge/libraries',
  );
  return data;
}

export async function depositKnowledgeSources(
  payload: DepositKnowledgePayload,
): Promise<DepositKnowledgeResult> {
  const { data } = await http.post<DepositKnowledgeResult>(
    '/user/knowledge/deposit',
    payload,
  );
  return data;
}

export async function createKnowledgeLibrary(
  payload: CreateUserKnowledgeLibraryPayload,
): Promise<UserKnowledgeLibrary> {
  const { data } = await http.post<UserKnowledgeLibrary>(
    '/user/knowledge/libraries',
    payload,
  );
  return data;
}

export async function fetchKnowledgeLibraryDetail(
  id: string,
): Promise<UserKnowledgeLibrary> {
  const { data } = await http.get<UserKnowledgeLibrary>(
    `/user/knowledge/libraries/${id}`,
  );
  return data;
}

export async function updateKnowledgeLibrary(
  id: string,
  payload: UpdateKnowledgeLibraryPayload,
): Promise<UserKnowledgeLibrary> {
  const { data } = await http.put<UserKnowledgeLibrary>(
    `/user/knowledge/libraries/${id}`,
    payload,
  );
  return data;
}

export async function recallTestKnowledgeLibrary(
  id: string,
  payload: { query: string; topK?: number },
): Promise<KnowledgeRecallHit[]> {
  const { data } = await http.post<KnowledgeRecallHit[]>(
    `/user/knowledge/libraries/${id}/recall-test`,
    payload,
  );
  return data;
}

export async function fetchKnowledgeLibraryItems(
  id: string,
  params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    groupCode?: string;
  },
): Promise<PageResult<UserKnowledgeItem>> {
  const { data } = await http.get<PageResult<UserKnowledgeItem>>(
    `/user/knowledge/libraries/${id}/items`,
    {
      params: {
        page: params?.page ?? 1,
        pageSize: params?.pageSize ?? 100,
        keyword: params?.keyword || undefined,
        groupCode: params?.groupCode || undefined,
      },
    },
  );
  return data;
}

export async function fetchKnowledgeGroups(libraryId?: string): Promise<KnowledgeGroupOption[]> {
  const { data } = await http.get<KnowledgeGroupOption[]>(
    '/user/knowledge/groups',
    { params: { libraryId } },
  );
  return data;
}

export async function saveKnowledgeGroup(libraryId: string, name: string, code?: string): Promise<KnowledgeGroupOption> {
  const url = `/user/knowledge/libraries/${encodeURIComponent(libraryId)}/groups`;
  const { data } = code
    ? await http.put<KnowledgeGroupOption>(`${url}/${encodeURIComponent(code)}`, { name })
    : await http.post<KnowledgeGroupOption>(url, { name });
  return data;
}

export async function deleteKnowledgeGroup(libraryId: string, code: string): Promise<{ movedCount: number }> {
  const { data } = await http.delete<{ movedCount: number }>(
    `/user/knowledge/libraries/${encodeURIComponent(libraryId)}/groups/${encodeURIComponent(code)}`,
  );
  return data;
}

export async function uploadKnowledgeFile(
  payload: UploadKnowledgeFilePayload,
): Promise<UserKnowledgeItem> {
  const form = new FormData();
  form.append('file', payload.file);
  form.append('libraryId', payload.libraryId);
  if (payload.groupCode !== undefined) form.append('groupCode', payload.groupCode);
  if (payload.title) form.append('title', payload.title);
  if (payload.code) form.append('code', payload.code);
  if (payload.summary) form.append('summary', payload.summary);
  if (payload.tags) form.append('tags', payload.tags);
  const { data } = await http.post<UserKnowledgeItem>(
    '/user/knowledge/upload',
    form,
  );
  return data;
}

export async function createTextKnowledge(payload: {
  libraryId: string;
  title: string;
  content: string;
  groupCode?: string;
  tags?: string[];
  summary?: string;
}): Promise<UserKnowledgeItem> {
  const { data } = await http.post<UserKnowledgeItem>(
    '/user/knowledge/text',
    payload,
  );
  return data;
}

export async function fetchKnowledgeItem(
  id: string,
): Promise<UserKnowledgeItem> {
  const { data } = await http.get<UserKnowledgeItem>(
    `/user/knowledge/items/${id}`,
  );
  return data;
}

export async function fetchKnowledgeItemPreview(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeFilePreview> {
  const { data } = await http.get<KnowledgeFilePreview>(
    `/user/knowledge/items/${id}/preview`,
    { signal },
  );
  return data;
}

export async function fetchKnowledgeItemFileBlob(
  id: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const { data } = await http.get<Blob>(`/user/knowledge/items/${id}/file`, {
    responseType: 'blob',
    signal,
  });
  return data;
}

export async function updateKnowledgeItem(
  id: string,
  payload: UpdateKnowledgeItemPayload,
): Promise<UserKnowledgeItem> {
  const { data } = await http.put<UserKnowledgeItem>(
    `/user/knowledge/items/${id}`,
    payload,
  );
  return data;
}

export async function archiveKnowledgeItem(
  id: string,
): Promise<{ ok: boolean }> {
  const { data } = await http.delete<{ ok: boolean }>(
    `/user/knowledge/items/${id}`,
  );
  return data;
}

export async function downloadKnowledgeItem(id: string, fileName: string) {
  const { data } = await http.get<Blob>(`/user/knowledge/items/${id}/file`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  a.click();
  URL.revokeObjectURL(url);
}

export { apiErrorMessage };
