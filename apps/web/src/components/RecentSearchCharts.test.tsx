// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ResearchHistoryItem } from '../api/data-analysis';
import RecentSearchCharts from './RecentSearchCharts';
import { datasetsFromSources } from '../utils/analysis-visualization';

vi.mock('echarts-for-react', async () => {
  const { forwardRef } = await import('react');
  return {
    default: forwardRef((_props: { option: unknown }, _ref) => (
      <div data-testid="chart">{JSON.stringify(_props.option)}</div>
    )),
  };
});
afterEach(cleanup);

function record(index: number): ResearchHistoryItem {
  return {
    id: String(index),
    query: `Search ${index}`,
    createdAt: `2026-09-${String(index).padStart(2, '0')}T12:00:00Z`,
    result: {
      sources: [
        {
          id: 'source',
          title: 'GDP',
          structuredData: [
            { country: 'China', year: 2024, value: 10 },
            { country: 'US', year: 2024, value: 20 },
            { country: 'China', year: 2025, value: 11 },
          ],
        },
      ],
    } as ResearchHistoryItem['result'],
  };
}

describe('recent search charts', () => {
  it('excludes dates and identifiers from metrics and preserves missing values', () => {
    const item = record(1);
    item.result.sources[0].structuredData = [
      { year: 2025, countryCode: '123', value: '1,000' },
      { year: 2024, value: null },
    ];
    const datasets = datasetsFromSources(item.result.sources);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].periods).toEqual(['2024', '2025']);
    expect(datasets[0].points.map((point) => point.value)).toEqual([
      1000,
      null,
    ]);
    expect(datasetsFromSources([])).toEqual([]);
  });

  it('shows only the newest four, keeps country series separate and opens the saved result', () => {
    const history = [record(2), record(5), record(1), record(4), record(3)];
    const onOpen = vi.fn();
    render(
      <RecentSearchCharts
        history={history}
        signedIn
        loading={false}
        error={false}
        onOpen={onOpen}
      />,
    );
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Search 5', 'Search 4', 'Search 3', 'Search 2']);
    const option = JSON.parse(screen.getAllByTestId('chart')[0].textContent!);
    expect(
      option.series.map((series: { name: string; data: unknown[] }) => [
        series.name,
        series.data,
      ]),
    ).toEqual([
      ['China', [10, 11]],
      ['US', [20, null]],
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: '表格' })[0]);
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole('button', { name: '查看完整搜索结果' })[0],
    );
    expect(onOpen).toHaveBeenCalledWith(history[1].result);
  });

  it('retains records without numeric data', () => {
    const item = record(1);
    item.result.sources = [];
    render(
      <RecentSearchCharts
        history={[item]}
        signedIn
        loading={false}
        error={false}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('该搜索暂无可绘图的结构化数据')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '查看完整搜索结果' }),
    ).toBeTruthy();
  });

  it('shows loading, failure and signed-out states', () => {
    const props = {
      history: [],
      signedIn: true,
      loading: true,
      error: false,
      onOpen: vi.fn(),
    };
    const { rerender } = render(<RecentSearchCharts {...props} />);
    expect(screen.getByRole('status').textContent).toContain('正在加载');
    rerender(<RecentSearchCharts {...props} loading={false} error />);
    expect(screen.getByRole('status').textContent).toContain('加载失败');
    rerender(
      <RecentSearchCharts {...props} loading={false} signedIn={false} />,
    );
    expect(screen.getByRole('status').textContent).toContain('登录后');
  });
});
