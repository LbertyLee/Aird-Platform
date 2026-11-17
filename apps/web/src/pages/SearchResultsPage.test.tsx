// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { LoginResponse, ResearchSearchResponse } from '@agent/contracts';
import SearchResultsPage from './SearchResultsPage';
import { createAnalysisSession, getRecentAnalysisSessions } from '../api/data-analysis';

vi.mock('../layouts/ResearchLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../components/DepositKnowledgeModal', () => ({ default: () => null }));
vi.mock('../api/data-analysis', () => ({ getResearchHistory: vi.fn().mockResolvedValue([]), getRecentAnalysisSessions: vi.fn(), createAnalysisSession: vi.fn(), deleteResearchHistory: vi.fn(), getKnowledgeSourcePreview: vi.fn(), SearchClientTimeoutError: class extends Error {}, searchDataAnalysisAsync: vi.fn(), SEARCH_MAX_WAIT_MS: 1000 }));
vi.mock('../api/research', () => ({ apiErrorMessage: () => '请求失败' }));
vi.mock('../api/membership', () => ({ isMembershipRequiredError: () => false }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function Location() {
  const location = useLocation();
  return <div>{location.pathname + location.search}</div>;
}
function page(runId = 'run-1') {
  const result = { runId, query: '历史搜索', sources: [], stages: [], mode: 'mixed' } as unknown as ResearchSearchResponse;
  return <MemoryRouter initialEntries={['/results']}><Routes><Route path="/results" element={<SearchResultsPage session={{ accessToken: 'token' } as LoginResponse} result={result} pendingSearch={null} selectedIds={[]} onSelectionChange={vi.fn()} onResult={vi.fn()} onClearPending={vi.fn()} onHistorySelect={vi.fn()} onAnalysisPending={vi.fn()} onAnalysisReady={vi.fn()} onSearchFailed={vi.fn()} onLogout={vi.fn()} onBack={vi.fn()} />} /><Route path="/analysis" element={<Location />} /></Routes></MemoryRouter>;
}

it('打开历史分析会话，无需重新勾选或生成', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([{ id: 'saved / 1', runId: 'run-1', selectedSourceIds: ['source-1'] }] as never);
  render(page());
  fireEvent.click(await screen.findByRole('button', { name: '查看已生成的分析表' }));
  expect(screen.getByText('/analysis?sessionId=saved%20%2F%201&view=matrix&saved=1')).toBeTruthy();
  expect(createAnalysisSession).not.toHaveBeenCalled();
});

it('没有历史会话时保留生成入口，不显示查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  render(page());
  await screen.findByText(/生成后直接进入/);
  expect(screen.queryByRole('button', { name: '查看已生成的分析表' })).toBeNull();
  expect(screen.getByRole('button', { name: '生成数据分析表' })).toBeTruthy();
});

it('查找失败时提供重试，并恢复查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions).mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce([{ id: 'saved', runId: 'run-1' }] as never);
  render(page());
  fireEvent.click(await screen.findByRole('button', { name: '重试查找历史分析' }));
  expect(await screen.findByRole('button', { name: '查看已生成的分析表' })).toBeTruthy();
});
