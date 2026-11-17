// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LoginResponse } from '@agent/contracts';
import KnowledgeDetailPage from './KnowledgeDetailPage';
import * as knowledge from '../api/knowledge';

vi.mock('../api/knowledge', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/knowledge')>(),
  fetchKnowledgeLibraryDetail: vi.fn(),
  fetchKnowledgeLibraryItems: vi.fn(),
  fetchKnowledgeGroups: vi.fn(),
  saveKnowledgeGroup: vi.fn(),
  deleteKnowledgeGroup: vi.fn(),
  updateKnowledgeItem: vi.fn(),
}));

const document = {
  id: 'doc-a', code: 'report', title: '季度研究报告', groupCode: 'macro',
  visibility: 'private', auditStatus: 'approved', publishStatus: 'published',
  vectorStatus: 'ready', chunkCount: 2,
} as knowledge.UserKnowledgeItem;

beforeEach(() => {
  vi.mocked(knowledge.fetchKnowledgeLibraryDetail).mockResolvedValue({
    id: 'lib-a', name: '测试知识库', icon: '知', visibility: 'private',
  } as knowledge.UserKnowledgeLibrary);
  vi.mocked(knowledge.fetchKnowledgeLibraryItems).mockResolvedValue({ items: [document], total: 1, page: 1, pageSize: 100 });
  vi.mocked(knowledge.fetchKnowledgeGroups).mockResolvedValue([
    { code: 'macro', name: '宏观研究' }, { code: 'custom-a', name: '季度报告' },
  ]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

async function openPage() {
  render(<MemoryRouter initialEntries={['/knowledge/lib-a']}>
    <Routes><Route path="/knowledge/:id" element={<KnowledgeDetailPage session={{ accessToken: 'test' } as LoginResponse} />} /></Routes>
  </MemoryRouter>);
  await screen.findByText('知识库文档');
}

describe('知识库自主分组', () => {
  it('新增分组成功后刷新当前库的分组选项', async () => {
    vi.mocked(knowledge.saveKnowledgeGroup).mockResolvedValue({ code: 'new-group', name: '专题资料' });
    await openPage();
    expect(knowledge.fetchKnowledgeGroups).toHaveBeenCalledWith('lib-a');
    fireEvent.click(screen.getByRole('button', { name: '添加分组' }));
    const dialog = screen.getByRole('dialog', { name: '新增分组' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '分组名称' }), { target: { value: ' 专题资料 ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(knowledge.saveKnowledgeGroup).toHaveBeenCalledWith('lib-a', '专题资料', undefined));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(knowledge.fetchKnowledgeGroups).toHaveBeenCalledTimes(2);
  });

  it('重命名使用原分组编码，不改变文档', async () => {
    vi.mocked(knowledge.saveKnowledgeGroup).mockResolvedValue({ code: 'macro', name: '经济研究' });
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '重命名分组：宏观研究' }));
    const dialog = screen.getByRole('dialog', { name: '重命名分组' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '经济研究' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(knowledge.saveKnowledgeGroup).toHaveBeenCalledWith('lib-a', '经济研究', 'macro'));
    expect(knowledge.updateKnowledgeItem).not.toHaveBeenCalled();
  });

  it('取消删除不会提交，确认后刷新文档并切换到未分组', async () => {
    vi.mocked(knowledge.deleteKnowledgeGroup).mockResolvedValue({ movedCount: 1 });
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '宏观研究 1' }));
    fireEvent.click(screen.getByRole('button', { name: '删除分组：宏观研究' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(knowledge.deleteKnowledgeGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除分组：宏观研究' }));
    vi.mocked(knowledge.fetchKnowledgeLibraryItems).mockResolvedValue({ items: [{ ...document, groupCode: null }], total: 1, page: 1, pageSize: 100 });
    vi.mocked(knowledge.fetchKnowledgeGroups).mockResolvedValue([{ code: 'custom-a', name: '季度报告' }]);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(knowledge.deleteKnowledgeGroup).toHaveBeenCalledWith('lib-a', 'macro'));
    await screen.findByText('季度研究报告');
    expect(screen.getByRole('button', { name: '未分组 1' }).className).toContain('active');
    expect(screen.queryByRole('button', { name: '删除分组：宏观研究' })).toBeNull();
  });

  it('保存失败显示错误并保留输入，允许用户重试', async () => {
    vi.mocked(knowledge.saveKnowledgeGroup).mockRejectedValue(new Error('该知识库已存在同名分组'));
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: '添加分组' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '宏观研究' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('宏观研究');
  });
});
