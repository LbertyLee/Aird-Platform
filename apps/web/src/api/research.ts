import axios from 'axios';
import { http } from './http';
import { runWorkJob } from './background-jobs';
import type {
  ResearchFilterCatalog,
  ResearchReport,
  UploadResponse,
} from '@agent/contracts';

export type SearchModelOption = { value: string; label: string };

export async function getSearchModelOptions(): Promise<SearchModelOption[]> {
  const response = await http.get<SearchModelOption[]>('/user/options/models');
  return Array.isArray(response.data) ? response.data : [];
}

export async function getResearchFilterCatalog(): Promise<ResearchFilterCatalog> {
  const response = await http.get<ResearchFilterCatalog>('/user/options');
  return response.data;
}

export async function getResearchDataSources(): Promise<
  ResearchFilterCatalog['sources']
> {
  const response = await http.get<ResearchFilterCatalog['sources']>(
    '/user/options/data-sources',
  );
  return response.data;
}

export interface ResearchServiceStatus {
  vectorSearch: boolean;
  externalSearch: boolean;
}

export async function getResearchServiceStatus(): Promise<ResearchServiceStatus> {
  const response = await http.get<ResearchServiceStatus>('/research/status');
  return response.data;
}

export async function uploadResearchFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  const response = await http.post<UploadResponse>('/research/upload', form);
  return response.data;
}

export async function generateResearchReport(
  query: string,
  sourceIds: string[],
  signal?: AbortSignal,
): Promise<ResearchReport> {
  return runWorkJob<ResearchReport>('report', { query, sourceIds }, signal);
}

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string | string[]; code?: string; error?: string }
      | undefined;
    if (Array.isArray(data?.message)) return data.message.join('；');
    if (typeof data?.message === 'string' && data.message) return data.message;
    if (error.code === 'ECONNABORTED') return '请求超时，请稍后重试。';
    if (!error.response) return '无法连接数据服务，请确认 API 已启动。';
  }
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}
