// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LoginResponse } from '@agent/contracts';
import ResearchPage from './ResearchPage';

vi.mock('antd', () => ({ Select: (props: any) => <select aria-label={props['aria-label']} multiple={props.mode === 'multiple'} value={props.value ?? (props.mode === 'multiple' ? [] : '')} onChange={(e) => props.onChange(props.mode === 'multiple' ? Array.from(e.target.selectedOptions).map((option) => option.value) : e.target.value)}><option value="">请选择</option>{props.options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));
vi.mock('../api/research', () => ({ getResearchFilterCatalog: vi.fn().mockResolvedValue({ countries: [{ value: '中国', label: '中国' }, { value: '美国', label: '美国' }], regions: [], sources: [{ value: 'World Bank', label: '世界银行' }, { value: '联合国', label: '联合国' }], indicators: [], entities: [], timeRanges: [] }), getSearchModelOptions: vi.fn().mockResolvedValue([{ value: 'qwen3.7-plus-2026-05-26', label: '标准模型' }, { value: 'qwen3.8-max', label: '复杂推理模型' }]), apiErrorMessage: String, uploadResearchFile: vi.fn() }));
vi.mock('../api/knowledge', () => ({ fetchDepositableLibraries: vi.fn().mockResolvedValue([{ id: 'library-1', name: '研究资料库' }, { id: 'library-2', name: '经济资料库' }]) }));
vi.mock('../api/data-analysis', () => ({ getResearchHistory: vi.fn().mockResolvedValue([]), getRecentAnalysisSessions: vi.fn().mockResolvedValue([]), deleteResearchHistory: vi.fn() }));
vi.mock('../api/membership', () => ({ fetchMembershipStatus: vi.fn().mockResolvedValue({ canSearch: true }), isMembershipRequiredError: () => false }));
vi.mock('../components/RecentSearchCharts', () => ({ default: () => null }));
afterEach(cleanup);

function selectMultiple(label: string, values: string[]) {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  Array.from(select.options).forEach((option) => {
    option.selected = values.includes(option.value);
  });
  fireEvent.change(select);
}

describe('首页搜索筛选', () => {
  it('预填问题并将国家、来源及年份传给搜索任务', async () => {
    const start = vi.fn();
    render(<MemoryRouter><ResearchPage session={{ accessToken: 'test' } as LoginResponse} onStartSearch={start} onHistorySelect={vi.fn()} /></MemoryRouter>);
    await screen.findByRole('option', { name: '中国' });
    fireEvent.click(screen.getByRole('button', { name: '主要经济体 2025 年 GDP 排名' }));
    selectMultiple('国家 / 地区', ['中国', '美国']);
    fireEvent.change(screen.getByLabelText('指定数据源'), { target: { value: ['World Bank'] } });
    fireEvent.change(screen.getByLabelText('开始年份'), { target: { value: '1950' } });
    fireEvent.change(screen.getByLabelText('结束年份'), { target: { value: '2100' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'qwen3.8-max' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ query: '主要经济体 2025 年 GDP 排名', model: 'qwen3.8-max', filters: expect.objectContaining({ countries: ['中国', '美国'], sources: ['World Bank'], timeRanges: ['1950-2100'] }) })));
  });

  it('移除检索模式并允许同时选择多个知识库和数据源', async () => {
    const start = vi.fn();
    render(<MemoryRouter><ResearchPage session={{ accessToken: 'test' } as LoginResponse} onStartSearch={start} onHistorySelect={vi.fn()} /></MemoryRouter>);
    await screen.findByRole('option', { name: '中国' });
    expect(screen.queryByLabelText('检索模式')).toBeNull();
    await screen.findByRole('option', { name: '研究资料库' });
    selectMultiple('国家 / 地区', ['中国', '美国']);
    selectMultiple('指定知识库', ['library-1', 'library-2']);
    selectMultiple('指定数据源', ['World Bank', '联合国']);
    fireEvent.change(screen.getByLabelText('研究问题'), { target: { value: '研究资料中的人口趋势' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'mixed', filters: expect.objectContaining({ countries: ['中国', '美国'], libraryIds: ['library-1', 'library-2'], sources: ['World Bank', '联合国'] }) })));
  });

  it('默认不限制知识库和数据源，并显示模型配置名称', async () => {
    const start = vi.fn();
    render(<MemoryRouter><ResearchPage session={{ accessToken: 'test' } as LoginResponse} onStartSearch={start} onHistorySelect={vi.fn()} /></MemoryRouter>);
    expect(await screen.findByRole('option', { name: '复杂推理模型' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('研究问题'), { target: { value: '默认全量检索测试' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'mixed', filters: expect.objectContaining({ libraryIds: [], sources: [] }) })));
  });
});
