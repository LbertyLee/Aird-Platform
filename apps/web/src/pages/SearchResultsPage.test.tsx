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
import type { AnalysisSession } from '../api/data-analysis';
vi.mock('../components/AnalysisVisual', () => ({
  default: () => <div>研究可视化</div>,
}));
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
function page(
  runId = 'run-1',
  pendingSearch: PendingSearchJob | null = null,
  sources: ResearchSearchResponse['sources'] = [],
) {
  const result = {
    runId,
    query: '历史搜索',
    sources,
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
    analysis('run-1', 'saved / 1'),
  ] as never);
  render(page());
  await screen.findByText(/研究报告与数据处理已完成/);
  fireEvent.click(
    await screen.findByRole('button', { name: '查看数据分析工作台' }),
  );
  expect(
    screen.getByText('/analysis?sessionId=saved%20%2F%201&view=matrix'),
  ).toBeTruthy();
  expect(createAnalysisSession).not.toHaveBeenCalled();
});

it('没有历史会话时保留生成入口，不显示查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  render(page());
  await screen.findByText(/全部来源将自动处理/);
  expect(
    screen.queryByRole('button', { name: '查看已生成的分析表' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: '查看数据分析工作台' }),
  ).toBeTruthy();
});

it('查找失败时提供重试，并恢复查看入口', async () => {
  vi.mocked(getRecentAnalysisSessions)
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce([analysis('run-1')] as never);
  render(page());
  fireEvent.click(
    await screen.findByRole('button', { name: '重试查找历史分析' }),
  );
  expect(
    await screen.findByRole('button', { name: '查看数据分析工作台' }),
  ).toBeTruthy();
});

it('检索完成后展示五步，但未执行的分析和报告保持等待', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  render(page());
  await screen.findByText(/全部来源将自动处理/);
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

it('初步研究报告完成后五步完成，但不自动生成最终分析结果', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([
    analysis('run-1'),
  ] as never);
  render(page());
  await screen.findByText(
    '研究报告与数据处理已完成，可进入工作台调整数据与图表，再生成最终分析结果。',
  );
  const steps = within(
    screen.getByRole('list', { name: '搜索与分析流程' }),
  ).getAllByRole('listitem');
  expect(steps.map((step) => step.className)).toEqual([
    'done',
    'done',
    'done',
    'done',
    'done',
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

it('实时检索时在正文展示本次搜索的问题', async () => {
  vi.mocked(searchDataAnalysisAsync).mockImplementation(
    () => new Promise(() => undefined),
  );
  render(
    page('run-1', {
      query: '中国 CPI / PPI 月度走势分析（2023-2025）',
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
  expect(
    screen.getByRole('heading', {
      name: '中国 CPI / PPI 月度走势分析（2023-2025）',
    }),
  ).toBeTruthy();
  expect(document.querySelector('.results-center')?.classList.contains('is-search-running')).toBe(true);
});

function analysis(runId = 'run-1', id = 'saved'): AnalysisSession {
  return {
    id,
    runId,
    query: '历史搜索',
    createdAt: '2026-11-17T00:00:00Z',
    status: 'ready',
    selectedSourceIds: ['s1', 's2'],
    sources: [],
    rows: [],
    observations: [],
    summary: [],
    availableIndicators: [],
    warnings: [],
  };
}
const documents = ['s1', 's2'].map((id) => ({
  id,
  title: `文档 ${id}`,
  origin: 'exa',
  storageType: 'knowledge',
  createdAt: '2026-11-17T00:00:00Z',
  sourceUrl: 'https://example.com',
  mimeType: 'text/plain',
  excerpt: '文档内容',
  recordCount: 1,
})) as ResearchSearchResponse['sources'];

it('不依赖勾选，自动提取全部来源；完成后保留研究报告，由用户进入工作台', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  vi.mocked(createAnalysisSession).mockResolvedValue(analysis());
  render(page('run-1', null, documents));
  await screen.findByText(/研究报告与数据处理已完成/);
  expect(createAnalysisSession).toHaveBeenCalledTimes(1);
  expect(createAnalysisSession).toHaveBeenCalledWith(
    { runId: 'run-1', query: '历史搜索', sourceIds: ['s1', 's2'] },
    expect.any(AbortSignal),
  );
  expect(screen.getByRole('article', { name: '研究报告' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看数据分析工作台' }));
  expect(
    screen.getByText('/analysis?sessionId=saved&view=matrix'),
  ).toBeTruthy();
});

it('旧会话只处理部分来源时重新对全部文档提取', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([
    { ...analysis(), selectedSourceIds: ['s1'] },
  ]);
  vi.mocked(createAnalysisSession).mockResolvedValue(analysis());
  render(page('run-1', null, documents));
  await screen.findByText(/研究报告与数据处理已完成/);
  expect(createAnalysisSession).toHaveBeenCalledWith(
    expect.objectContaining({ sourceIds: ['s1', 's2'] }),
    expect.any(AbortSignal),
  );
});

it('提取失败不显示已完成，提供重试入口', async () => {
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  vi.mocked(createAnalysisSession).mockRejectedValue(new Error('failed'));
  render(page('run-1', null, documents));
  await screen.findByText('请求失败');
  expect(screen.queryByText(/已处理 2/)).toBeNull();
  expect(screen.getByLabelText('数据标准化与清洗：等待中')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: '查看数据分析工作台' })
      .hasAttribute('disabled'),
  ).toBe(false);
});

it('切换检索后丢弃旧任务的迟到结果，并启动新任务', async () => {
  let completeOld!: (session: AnalysisSession) => void;
  vi.mocked(getRecentAnalysisSessions).mockResolvedValue([]);
  vi.mocked(createAnalysisSession)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeOld = resolve;
        }),
    )
    .mockResolvedValueOnce(analysis('run-2', 'new-session'));
  const view = render(page('run-1', null, documents));
  await screen.findByText('正在处理全部检索来源');
  view.rerender(page('run-2', null, documents));
  await screen.findByText(/研究报告与数据处理已完成/);
  await act(async () => completeOld(analysis('run-1', 'old-session')));
  fireEvent.click(screen.getByRole('button', { name: '查看数据分析工作台' }));
  expect(
    screen.getByText('/analysis?sessionId=new-session&view=matrix'),
  ).toBeTruthy();
});
