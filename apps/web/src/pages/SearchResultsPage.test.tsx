// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { LoginResponse, ResearchSearchResponse } from '@agent/contracts';
import SearchResultsPage from './SearchResultsPage';
import {
  createAnalysisSession,
  getRecentAnalysisSessions,
  searchDataAnalysisAsync,
} from '../api/data-analysis';
import type { PendingSearchJob } from '../search-progress';

vi.mock('../layouts/ResearchLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/DepositKnowledgeModal', () => ({ default: () => null }));
vi.mock('../api/data-analysis', () => ({
  getResearchHistory: vi.fn().mockResolvedValue([]),
  getRecentAnalysisSessions: vi.fn(),
  createAnalysisSession: vi.fn(),
  deleteResearchHistory: vi.fn(),
  getKnowledgeSourcePreview: vi.fn(),
  SearchClientTimeoutError: class extends Error {},
  searchDataAnalysisAsync: vi.fn(),
  SEARCH_MAX_WAIT_MS: 1000,
}));
vi.mock('../api/research', () => ({ apiErrorMessage: () => '请求失败' }));
vi.mock('../api/membership', () => ({
  isMembershipRequiredError: () => false,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Location() {
  const location = useLocation();
  return <div>{location.pathname + location.search}</div>;
}
function page(runId = 'run-1', pendingSearch: PendingSearchJob | null = null) {
  const result = {
    runId,
    query: '历史搜索',
    sources: [],
    stages: [],
    mode: 'mixed',
  } as unknown as ResearchSearchResponse;
  return (
    <MemoryRouter initialEntries={['/results']}>
      <Routes>
        <Route
          path="/results"
          element={
            <SearchResultsPage
              session={{ accessToken: 'token' } as LoginResponse}
              result={result}
              pendingSearch={pendingSearch}
              selectedIds={[]}
              onSelectionChange={vi.fn()}
              onResult={vi.fn()}
              onClearPending={vi.fn()}
              onHistorySelect={vi.fn()}
              onAnalysisPending={vi.fn()}
              onAnalysisReady={vi.fn()}
              onSearchFailed={vi.fn()}
              onLogout={vi.fn()}
              onBack={vi.fn()}
            />
          }
        />
        <Route path="/analysis" element={<Location />} />
      </Routes>
    </MemoryRouter>
  );
}

it('打开历史分析会话，无需重新勾选或生成', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([
    { id: 'saved / 1', runId: 'run-1', selectedSourceIds: ['source-1'] },
  ] as never);
  render(page());
  fireEvent.click(
    await screen.findByRole('button', { name: '查看已生成的分析表' }),
  );
  expect(
    screen.getByText('/analysis?sessionId=saved%20%2F%201&view=matrix&saved=1'),
  ).toBeTruthy();
  expect(createAnalysisSession).not.toHaveBeenCalled();
});

it('没有历史会话时保留生成入口，不显示查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  render(page());
  await screen.findByText(/生成后直接进入/);
  expect(
    screen.queryByRole('button', { name: '查看已生成的分析表' }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: '生成数据分析表' })).toBeTruthy();
});

it('查找失败时提供重试，并恢复查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions)
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce([{ id: 'saved', runId: 'run-1' }] as never);
  render(page());
  fireEvent.click(
    await screen.findByRole('button', { name: '重试查找历史分析' }),
  );
  expect(
    await screen.findByRole('button', { name: '查看已生成的分析表' }),
  ).toBeTruthy();
});

it('检索完成后展示五步，但未执行的分析和报告保持等待', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  render(page());
  await screen.findByText(/请勾选右侧来源并生成数据分析表/);
  const steps = within(
    screen.getByRole('list', { name: '搜索与分析流程' }),
  ).getAllByRole('listitem');
  expect(steps).toHaveLength(5);
  expect(steps.map((step) => step.className)).toEqual([
    'done',
    'done',
    'pending',
    'pending',
    'pending',
  ]);
  expect(steps[0].textContent).toContain('解析问题意图');
});

it('历史分析已完成但没有报告时，第五步仍等待', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([
    { id: 'saved', runId: 'run-1', status: 'ready' },
  ] as never);
  render(page());
  await screen.findByText('数据分析已完成，可进入工作台生成报告与可视化。');
  const steps = within(
    screen.getByRole('list', { name: '搜索与分析流程' }),
  ).getAllByRole('listitem');
  expect(steps.map((step) => step.className)).toEqual([
    'done',
    'done',
    'done',
    'done',
    'pending',
  ]);
});

it('实时检索阶段更新到第二步，失败后停在中断位置', async () => {
  let rejectSearch!: (error: Error) => void;
  vi.mocked(searchDataAnalysisAsync).mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectSearch = reject;
      }),
  );
  render(
    page('run-1', {
      query: '实时搜索',
      mode: 'mixed',
      filters: {
        indicators: [],
        timeRanges: [],
        countries: [],
        regions: [],
        entities: [],
        sources: [],
      },
      startedAt: Date.now(),
    }),
  );
  expect(screen.getByLabelText('解析问题意图：进行中')).toBeTruthy();
  await act(async () => {
    const callback = vi.mocked(searchDataAnalysisAsync).mock.calls[0][5];
    callback?.({
      progress: { stage: 'searching', message: '正在检索来源' },
    } as Parameters<NonNullable<typeof callback>>[0]);
  });
  expect(screen.getByLabelText('解析问题意图：已完成')).toBeTruthy();
  expect(screen.getByLabelText('多源并行检索：进行中')).toBeTruthy();
  await act(async () => rejectSearch(new Error('failed')));
  expect(screen.getByLabelText('多源并行检索：已中断')).toBeTruthy();
  expect(screen.getByLabelText('数据标准化与清洗：等待中')).toBeTruthy();
});
