// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DataAnalysisWorkspace from './DataAnalysisWorkspace';
import { getAnalysisSession } from './api/data-analysis';

vi.mock('./layouts/ResearchLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/AnalysisResults', () => ({
  default: ({
    session,
    autoGenerateReport,
  }: {
    session?: { query: string };
    autoGenerateReport?: boolean;
  }) => (
    <div>
      已恢复：{session?.query}
      <span>{autoGenerateReport ? '自动补全报告' : '仅显示已有报告'}</span>
    </div>
  ),
}));
vi.mock('./api/data-analysis', () => ({
  getAnalysisSession: vi.fn(),
  createAnalysisSession: vi.fn(),
  exportAnalysisSession: vi.fn(),
}));
vi.mock('./api/research', () => ({ apiErrorMessage: () => '加载失败' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('加载历史会话期间不显示空结果，加载完成后恢复对应内容', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(getAnalysisSession).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }) as ReturnType<typeof getAnalysisSession>,
  );
  render(
    <MemoryRouter initialEntries={['/analysis?sessionId=saved&view=report']}>
      <DataAnalysisWorkspace
        result={null}
        selectedIds={[]}
        onBack={vi.fn()}
        session={null}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('正在加载已保存的分析会话...')).toBeTruthy();
  expect(screen.queryByText(/已恢复：/)).toBeNull();
  resolve({
    id: 'saved',
    query: '历史分析',
    selectedSourceIds: [],
    sources: [],
    rows: [],
    observations: [],
    summary: [],
    availableIndicators: [],
    warnings: [],
  });
  expect(await screen.findByText('已恢复：历史分析')).toBeTruthy();
  expect(getAnalysisSession).toHaveBeenCalledWith(
    'saved',
    expect.any(AbortSignal),
  );
});

it('历史会话读取失败时展示错误和重试入口，不展示空结果', async () => {
  vi.mocked(getAnalysisSession).mockRejectedValue(new Error('failed'));
  render(
    <MemoryRouter initialEntries={['/analysis?sessionId=saved&view=report']}>
      <DataAnalysisWorkspace
        result={null}
        selectedIds={[]}
        onBack={vi.fn()}
        session={null}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect((await screen.findByRole('alert')).textContent).toContain('加载失败');
  expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy();
  expect(screen.queryByText(/已恢复：/)).toBeNull();
});

it('历史查看不自动生成最终分析结果', async () => {
  vi.mocked(getAnalysisSession).mockResolvedValue({
    id: 'saved',
    query: '历史分析',
    selectedSourceIds: [],
    sources: [],
    rows: [],
    observations: [],
    summary: [],
    availableIndicators: [],
    warnings: [],
  } as never);
  render(
    <MemoryRouter
      initialEntries={['/analysis?sessionId=saved&view=report&saved=1']}
    >
      <DataAnalysisWorkspace
        result={null}
        selectedIds={[]}
        onBack={vi.fn()}
        session={null}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText('仅显示已有报告')).toBeTruthy();
});

it('取消全部年份后保留空选择并阻止生成结果，重新选择后恢复', async () => {
  vi.mocked(getAnalysisSession).mockResolvedValue({
    id: 'saved',
    query: 'GDP',
    selectedSourceIds: ['s1'],
    sources: [{ id: 's1', title: '统计公报' }],
    rows: [],
    summary: [],
    warnings: [],
    availableIndicators: [{ id: 'gdp', code: 'gdp', name: 'GDP', unit: '%' }],
    queryDimensions: {
      entities: ['中国'],
      periods: ['2024'],
      preferredIndicatorCodes: [],
    },
    observations: [
      {
        sourceId: 's1',
        source: '统计公报',
        indicatorId: 'gdp',
        indicatorCode: 'gdp',
        indicatorName: 'GDP',
        entity: '中国',
        period: '2024',
        value: 5,
        unit: '%',
        citation: { field: 'value', rowIndex: 0 },
      },
    ],
  } as never);
  render(
    <MemoryRouter initialEntries={['/analysis?sessionId=saved&view=matrix']}>
      <DataAnalysisWorkspace
        result={null}
        selectedIds={[]}
        onBack={vi.fn()}
        session={null}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );
  const year = await screen.findByRole('checkbox', { name: '2024' });
  await waitFor(() => expect((year as HTMLInputElement).checked).toBe(true));
  const generate = screen.getByRole('button', {
    name: '生成分析结果',
  }) as HTMLButtonElement;
  expect(generate.disabled).toBe(false);
  fireEvent.click(year);
  expect((year as HTMLInputElement).checked).toBe(false);
  expect(generate.disabled).toBe(true);
  fireEvent.click(year);
  expect(generate.disabled).toBe(false);
  fireEvent.click(screen.getByRole('checkbox', { name: '统计公报' }));
  expect(generate.disabled).toBe(true);
});
