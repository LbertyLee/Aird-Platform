import type { ResearchSource } from '@agent/contracts';

export function knowledgeSourceAttribution(source: ResearchSource): string {
  if (source.origin === 'exa') return 'Exa 联网来源';
  if (source.origin === 'local') return '结构化数据';
  if (source.knowledgeScope === 'platform_public') {
    return source.libraryName
      ? `平台公共知识库 · ${source.libraryName}`
      : '平台公共知识库';
  }
  if (source.knowledgeScope === 'user') {
    return source.libraryName
      ? `我的知识库 · ${source.libraryName}`
      : '我的知识库';
  }
  return '知识库';
}
