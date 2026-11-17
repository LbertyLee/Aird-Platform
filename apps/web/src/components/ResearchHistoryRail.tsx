import { useEffect, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import type { ResearchSearchResponse } from '@agent/contracts';
import {
  getResearchHistory,
  type ResearchHistoryItem,
} from '../api/data-analysis';

export default function ResearchHistoryRail({
  query,
  onBack,
  onSelect,
}: {
  query?: string;
  onBack: () => void;
  onSelect?: (result: ResearchSearchResponse) => void;
}) {
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  useEffect(() => {
    let active = true;
    void getResearchHistory()
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return (
    <aside className="workspace-history-rail">
      <button className="workspace-history-back" onClick={onBack}>
        <ArrowLeft size={14} /> 返回搜索结果
      </button>
      <div className="workspace-history-current">
        <Search size={14} />
        <strong>{query || '研究历史'}</strong>
      </div>
      <small>历史检索</small>
      {history.map((item) => (
        <button
          key={item.id}
          disabled={!onSelect}
          title={item.query}
          onClick={() => onSelect?.(item.result)}
        >
          <span>{item.query}</span>
          <time>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>
        </button>
      ))}
    </aside>
  );
}
