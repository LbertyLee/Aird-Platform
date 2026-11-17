import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import './MultiFilterDialog.css';
import type { FilterKey } from './filter-config';
import { filterDefinitions } from './filter-config';
import type { ResearchFilterOption } from '@agent/contracts';

export default function MultiFilterDialog({
  filterKey,
  selected,
  options,
  onClose,
  onApply,
}: {
  filterKey: FilterKey;
  selected: string[];
  options: ResearchFilterOption[];
  onClose: () => void;
  onApply: (values: string[]) => void;
}) {
  const definition = filterDefinitions.find((item) => item.key === filterKey)!;
  const [draft, setDraft] = useState(selected);
  const [keyword, setKeyword] = useState('');
  const visibleOptions = useMemo(
    () => options.filter((option) => option.label.includes(keyword.trim())),
    [options, keyword],
  );

  function toggle(option: string) {
    setDraft((current) =>
      current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option],
    );
  }

  return (
    <div
      className="filter-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="filter-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={definition.label}
      >
        <header>
          <div>
            <span>筛选条件</span>
            <h2>选择{definition.label}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            title="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="filter-dialog-body">
          <label className="filter-search">
            <Search size={16} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索选项"
            />
          </label>
          <div className="filter-option-grid">
            {visibleOptions.map((option) => (
              <label className="filter-option" key={option.value}>
                <input
                  type="checkbox"
                  checked={draft.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                <span>
                  <Check size={13} />
                </span>
                <strong>{option.label}</strong>
                <small>
                  {option.kind === 'dataset'
                    ? '知识库数据集'
                    : option.kind === 'organization'
                      ? '数据来源机构'
                      : `${definition.label}筛选项`}
                </small>
              </label>
            ))}
          </div>
          {visibleOptions.length === 0 && (
            <p className="filter-no-result">没有匹配的筛选项</p>
          )}
        </div>
        <footer>
          <button
            className="text-button"
            type="button"
            onClick={() => setDraft([])}
          >
            清空当前
          </button>
          <div>
            <button
              className="secondary-button"
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              应用筛选
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
