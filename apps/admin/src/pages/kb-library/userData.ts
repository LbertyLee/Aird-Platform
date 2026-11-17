import type { DocItem } from './docsData';
import { useKbDocsStore } from './docsData';

export interface UserKbLibrary {
  id: string;
  name: string;
  type: number;
  intro: string;
  icon: string;
  color: string;
  group: string;
  docs: DocItem[];
  updateTime: string;
}

export interface UserItem {
  id: string;
  name: string;
  member: string;
  avatar: string;
  color: string;
  totalDocs: number;
  libs: UserKbLibrary[];
}

/** 按文档聚合用户知识库（当前无数据时返回空列表） */
export function buildUsers(_docs: DocItem[]): UserItem[] {
  return [];
}

/** 订阅文档 store 并聚合用户列表 */
export function useKbUsers(): UserItem[] {
  const docs = useKbDocsStore((s) => s.docs);
  return buildUsers(docs);
}

export const totalSizeOf = (docs: DocItem[]): string => {
  let mb = 0;
  docs.forEach((d) => {
    const m = d.size.match(/([\d.]+)\s*MB/);
    if (m) mb += Number(m[1]);
  });
  return `${mb.toFixed(1)} MB`;
};

export const typeText = (t: number): string =>
  t === 2 ? '历史问答库' : '普通知识库';
