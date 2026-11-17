import { create } from 'zustand';

/** 知识库文档项（待对接真实 API） */
export interface DocItem {
  id: string;
  name: string;
  icon: string;
  seg: string;
  hit: number;
  hitToday: number;
  status: string;
  parseStatus?: string;
  size: string;
  group: string;
  time: string;
  author: string;
  tags: string[];
  src: string;
  publicConsent?: boolean;
  publicStatus?: '待审核' | '已公开' | '已驳回';
  rejectReason?: string;
  sourceType?: '用户上传' | '联网搜索' | 'AI生成' | '系统采集';
  preview: string;
  history?: string[];
}

interface KbDocsState {
  docs: DocItem[];
  updateDocStatus: (
    name: string,
    status: string,
    seg?: string,
    reason?: string,
  ) => void;
  patchDoc: (id: string, patch: Partial<DocItem>) => void;
}

/** 文档状态（初始为空，审核操作在内存中更新） */
export const useKbDocsStore = create<KbDocsState>((set) => ({
  docs: [],

  updateDocStatus: (name, status, seg, reason) =>
    set((state) => ({
      docs: state.docs.map((doc) => {
        if (doc.name !== name) return doc;
        const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
        const reasonText =
          status === '已退回' && reason ? `：${reason}` : '';
        return {
          ...doc,
          status,
          seg: seg ?? doc.seg,
          rejectReason: status === '已退回' ? reason : '',
          history: [
            ...(doc.history || []),
            `${stamp} ${status}${reasonText}`,
          ],
        };
      }),
    })),

  patchDoc: (id, patch) =>
    set((state) => ({
      docs: state.docs.map((doc) =>
        doc.id === id ? { ...doc, ...patch } : doc,
      ),
    })),
}));
