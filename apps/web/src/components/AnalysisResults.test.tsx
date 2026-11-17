// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import AnalysisResults from './AnalysisResults';
import { saveAnalysisPresentation } from '../api/data-analysis';

vi.mock('./AnalysisVisual', () => ({ default: () => <div>已保存图表</div>, VisualViewTabs: () => null }));
vi.mock('../api/data-analysis', () => ({ createAnalysisSession: vi.fn(), saveAnalysisPresentation: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('查看历史会话时展示已保存的图表与文章，不重新生成', async () => {
  const presentation = { datasetId: 'd', entities: ['中国'], startPeriod: '2024', endPeriod: '2024', currentPeriod: '2024', view: 'line', reportViews: ['line'] };
  const session = { id: 'saved', visualDatasets: [{ id: 'd', name: '人口', unit: '人', definition: '', entities: ['中国'], periods: ['2024'], points: [{ entity: '中国', period: '2024', value: 10, sourceIds: ['s'] }], sources: [{ id: 's', title: '来源' }] }], presentation, visualReport: { title: '已保存文章', createdAt: '2026-11-16T00:00:00Z', presentation, metrics: [], sections: [{ title: '结论', paragraphs: ['原有结论'] }] } };
  render(<AnalysisResults session={session as never} result={null} sources={[]} mode="report" autoGenerateReport={false} onSession={vi.fn()} onNavigate={vi.fn()} />);
  expect(screen.getByText('已保存文章')).toBeTruthy();
  expect(screen.getByText('原有结论')).toBeTruthy();
  expect(screen.getAllByText('已保存图表').length).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(saveAnalysisPresentation).not.toHaveBeenCalled();
});

it('打开缺少报告的历史会话时自动保存分析结果', async () => {
  const presentation = { datasetId: 'd', entities: ['中国'], startPeriod: '2024', endPeriod: '2024', currentPeriod: '2024', view: 'line', reportViews: ['line'] };
  const session = { id: 'saved', presentation, visualDatasets: [{ id: 'd', name: '人口', unit: '人', definition: '', entities: ['中国'], periods: ['2024'], points: [{ entity: '中国', period: '2024', value: 10, sourceIds: ['s'] }], sources: [{ id: 's', title: '来源' }] }] };
  vi.mocked(saveAnalysisPresentation).mockResolvedValue({
    ...session,
    visualReport: { title: '自动生成的报告', createdAt: '2026-11-17T00:00:00Z', presentation, metrics: [], sections: [] },
  } as never);
  const onSession = vi.fn();
  render(<AnalysisResults session={session as never} result={null} sources={[]} mode="report" onSession={onSession} onNavigate={vi.fn()} />);
  await waitFor(() => expect(saveAnalysisPresentation).toHaveBeenCalledWith('saved', presentation, true, expect.any(AbortSignal)));
  expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ visualReport: expect.objectContaining({ title: '自动生成的报告' }) }), 'report');
});
