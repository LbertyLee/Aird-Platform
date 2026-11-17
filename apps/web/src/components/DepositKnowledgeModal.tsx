import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Globe2, Lock, Plus, Trash2, X } from 'lucide-react';
import type { ResearchSource } from '@agent/contracts';
import {
  apiErrorMessage,
  depositKnowledgeSources,
  fetchDepositableLibraries,
  fetchKnowledgeGroups,
  type KnowledgeGroupOption,
  type KnowledgeVisibility,
  type UserKnowledgeLibrary,
} from '../api/knowledge';
import CreateLibraryModal from './CreateLibraryModal';
import { knowledgeSourceAttribution } from '../utils/knowledge-source';

function hostOf(url?: string | null) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function originLabel(source: ResearchSource) {
  if (source.origin === 'exa') return '网络来源';
  return knowledgeSourceAttribution(source);
}

function libraryVisibilityHint(visibility: KnowledgeVisibility) {
  if (visibility === 'public') {
    return '公共知识库提交后自动审核通过并学习入库，参与智搜优先检索。';
  }
  return '私有知识库无需审核，直接开始知识学习。';
}

function DepositLibraryVisibilityHint({
  visibility,
}: {
  visibility: KnowledgeVisibility;
}) {
  const isPublic = visibility === 'public';
  return (
    <div className="deposit-library-hint">
      <span className={`kb-badge ${isPublic ? 'kb-badge-public' : 'kb-badge-private'}`}>
        {isPublic ? <Globe2 size={12} /> : <Lock size={12} />}
        {isPublic ? '公共' : '私有'}
      </span>
      <p>{libraryVisibilityHint(visibility)}</p>
    </div>
  );
}

export default function DepositKnowledgeModal({
  sources,
  taskId,
  authorName,
  onClose,
  onDone,
  onRemoveSource,
}: {
  sources: ResearchSource[];
  taskId: string;
  authorName?: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onRemoveSource: (sourceId: string) => void;
}) {
  const [libraries, setLibraries] = useState<UserKnowledgeLibrary[]>([]);
  const [groups, setGroups] = useState<KnowledgeGroupOption[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [tags, setTags] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createLibraryOpen, setCreateLibraryOpen] = useState(false);

  const selectedLibrary = useMemo(
    () => libraries.find((lib) => lib.id === libraryId) ?? null,
    [libraries, libraryId],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const libs = await fetchDepositableLibraries();
        if (cancelled) return;
        setLibraries(libs);
        const first = libs[0];
        if (first) setLibraryId(first.id);
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;
    setGroupsLoading(true);
    setGroupsError('');
    setGroups([]);
    setGroupCode('');
    void fetchKnowledgeGroups(libraryId)
      .then((rows) => { if (!cancelled) setGroups(rows); })
      .catch((err) => { if (!cancelled) setGroupsError(apiErrorMessage(err)); })
      .finally(() => { if (!cancelled) setGroupsLoading(false); });
    return () => { cancelled = true; };
  }, [libraryId]);

  const depositVisibility: KnowledgeVisibility =
    selectedLibrary?.visibility ?? 'private';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (groupsLoading || groupsError || submitting) return;
    if (!libraryId) {
      setError('请选择知识库');
      return;
    }
    if (!sources.length) {
      setError('请至少勾选一个来源');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const tagList = tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const result = await depositKnowledgeSources({
        libraryId,
        sourceIds: sources.map((s) => s.id),
        groupCode,
        visibility: depositVisibility,
        tags: tagList.length ? tagList : undefined,
      });
      onDone(result.message);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const nowLabel = new Date().toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="kb-modal-mask"
      role="presentation"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="kb-modal deposit-modal"
        role="dialog"
        aria-modal="true"
        aria-label="存入知识库"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2>存入知识库</h2>
          <button
            type="button"
            className="kb-modal-close"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        {groupsError && <div className="kb-error" role="alert">{groupsError}</div>}
        <form className="kb-modal-body" onSubmit={(e) => void submit(e)}>
          {loading ? (
            <p className="deposit-muted">正在加载知识库…</p>
          ) : (
            <>
              <div className="deposit-library-field">
                <span>存入知识库</span>
                <div className="deposit-library-row">
                  <select
                    value={libraryId}
                    onChange={(e) => { setGroupsLoading(true); setLibraryId(e.target.value); }}
                    required
                  >
                    {libraries.length === 0 ? (
                      <option value="">暂无可存入的知识库</option>
                    ) : null}
                    {libraries.map((lib) => (
                      <option key={lib.id} value={lib.id}>
                        {lib.name}
                        {lib.visibility === 'public' ? '（公共）' : '（私有）'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="deposit-library-new"
                    disabled={submitting}
                    onClick={() => setCreateLibraryOpen(true)}
                  >
                    <Plus size={14} />
                    新建
                  </button>
                </div>
                {selectedLibrary ? (
                  <DepositLibraryVisibilityHint visibility={selectedLibrary.visibility} />
                ) : null}
              </div>

              <label>
                <span>所属分组</span>
                <select
                  value={groupCode}
                  onChange={(e) => setGroupCode(e.target.value)}
                >
                  <option value="">不指定分组</option>
                  {groups.map((g) => (
                    <option key={g.code} value={g.code}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>标签（逗号分隔）</span>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="如：GDP, 中美对比, 宏观"
                />
              </label>

              <section className="deposit-sources">
                <header>
                  本次勾选来源（{sources.length} 条，每个来源将被独立存入知识库并切片）
                </header>
                {sources.length === 0 ? (
                  <p className="deposit-muted">已无可存入的来源，请返回重新勾选。</p>
                ) : (
                  <ul>
                    {sources.map((source) => (
                      <li key={source.id}>
                        <div className="deposit-source-top">
                          <strong title={source.title}>{source.title}</strong>
                          <div className="deposit-source-actions">
                            <em>{originLabel(source)}</em>
                            <button
                              type="button"
                              className="deposit-source-remove"
                              aria-label={`移除 ${source.title}`}
                              disabled={submitting}
                              onClick={() => onRemoveSource(source.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {source.origin === 'exa' && source.sourceUrl ? (
                          <small>{hostOf(source.sourceUrl)}</small>
                        ) : null}
                        <p>
                          {source.excerpt ||
                            (source as ResearchSource & { content?: string })
                              .content ||
                            '暂无摘要'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="deposit-meta">
                <p>
                  检索任务 {taskId} · {nowLabel}
                  {authorName ? ` · 作者：${authorName}` : ''}
                </p>
              </div>
            </>
          )}

          {error ? (
            <div className="kb-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          <footer className="kb-modal-foot">
            <button
              type="button"
              className="kb-secondary-btn"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="kb-primary-btn"
              disabled={submitting || loading || groupsLoading || !!groupsError || !libraryId || !sources.length}
            >
              {submitting ? '提交中…' : '确定'}
            </button>
          </footer>
        </form>
      </div>
      {createLibraryOpen ? (
        <CreateLibraryModal
          maskClassName="deposit-create-mask"
          radioName="deposit-create-visibility"
          onClose={() => setCreateLibraryOpen(false)}
          onCreated={(library) => {
            setLibraries((prev) => {
              if (prev.some((lib) => lib.id === library.id)) return prev;
              return [library, ...prev];
            });
            setGroupsLoading(true);
            setLibraryId(library.id);
            setCreateLibraryOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
