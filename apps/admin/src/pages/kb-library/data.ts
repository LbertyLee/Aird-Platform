/** 知识库列表数据类型（待对接真实 API） */

export interface LibraryItem {
  id: string;
  name: string;
  type: number;
  intro: string;
  /** 对应字典 knowledge_group 的 code */
  group_id: string;
  icon: string;
  color: string;
  file_total: number;
  file_size: string;
  update_by: string;
  update_time: string;
  create_by?: string;
  create_time?: string;
}

export interface GroupItem {
  id: string;
  name: string;
  total: number;
}

/** 平台知识库列表（暂无后端容器模型，保持空列表） */
export const librarySeeds: LibraryItem[] = [];

export const createLibraries = (): LibraryItem[] =>
  librarySeeds.map((l) => ({ ...l }));

export const findLibrary = (id: string): LibraryItem | undefined =>
  librarySeeds.find((l) => l.id === id);

export const typeText = (t: number): string =>
  t === 2 ? '历史问答库' : '普通知识库';
