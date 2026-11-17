import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select as AntdSelect } from 'antd';
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  History,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  TableProperties,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  LoginResponse,
  ResearchFilterCatalog,
  ResearchFilters,
  ResearchSearchResponse,
  UploadResponse,
} from '@agent/contracts';
import { apiErrorMessage, getResearchFilterCatalog, getSearchModelOptions, uploadResearchFile, type SearchModelOption } from '../api/research';
import {
  getResearchHistory,
  deleteResearchHistory,
  getRecentAnalysisSessions,
  type ResearchHistoryItem,
} from '../api/data-analysis';
import {
  fetchMembershipStatus,
  isMembershipRequiredError,
} from '../api/membership';
import RecentSearchCharts from '../components/RecentSearchCharts';
import ConfirmDialog from '../components/ConfirmDialog';
import { emptyResearchFilters } from '../filter-config';
import { fetchDepositableLibraries, type UserKnowledgeLibrary } from '../api/knowledge';

const UPLOAD_ACCEPT =
  '.txt,.md,.markdown,.html,.htm,.json,.csv,.xlsx,.xls,.pdf,.doc,.docx';

export default function ResearchPage({
  session,
  onStartSearch,
  onHistorySelect,
}: {
  session: LoginResponse | null;
  onStartSearch: (job: {
    query: string;
    filters: ResearchFilters;
    mode: 'mixed';
    model?: string;
    startedAt: number;
  }) => void;
  onHistorySelect: (result: ResearchSearchResponse) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ResearchFilters>(emptyResearchFilters);
  const [catalog, setCatalog] = useState<ResearchFilterCatalog>();
  const [modelOptions, setModelOptions] = useState<SearchModelOption[]>([]);
  const [model, setModel] = useState('');
  const [catalogError, setCatalogError] = useState(false);
  const [libraries, setLibraries] = useState<UserKnowledgeLibrary[]>([]);
  const [librariesError, setLibrariesError] = useState(false);
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [uploads, setUploads] = useState<UploadResponse[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [analysisHistoryError, setAnalysisHistoryError] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void getResearchFilterCatalog().then((data) => {
      if (active) setCatalog(data);
    }).catch(() => { if (active) setCatalogError(true); });
    void getSearchModelOptions().then((data) => {
      if (active) { setModelOptions(data); setModel((current) => current || data[0]?.value || ''); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!session?.accessToken) {
      setHistory([]);
      setHistoryLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setHistoryLoading(true);
    setHistoryError(false);
    setAnalysisHistoryError(false);
    void getResearchHistory()
      .then(async (next) => {
        const sorted = next
          .filter((item) => Boolean(item.result))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        try {
          const analyses = await getRecentAnalysisSessions(
            sorted.slice(0, 4).map((item) => item.result.runId),
          );
          if (!cancelled)
            setHistory(
              sorted.map((item) => ({
                ...item,
                analysis: analyses.find(
                  (analysis) => analysis.runId === item.result.runId,
                ),
              })),
            );
        } catch {
          if (!cancelled) {
            setHistory(sorted);
            setAnalysisHistoryError(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistory([]);
          setHistoryError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  useEffect(() => {
    let active = true;
    setLibraries([]);
    setLibrariesError(false);
    setFilters((current) => ({ ...current, libraryIds: [] }));
    if (session?.accessToken) {
      void fetchDepositableLibraries().then((data) => {
        if (active) setLibraries(data);
      }).catch(() => { if (active) setLibrariesError(true); });
    }
    return () => { active = false; };
  }, [session?.accessToken]);

  async function search() {
    if (searching) return;
    if (query.trim().length < 2) {
      setError('请输入至少两个字符的研究问题。');
      return;
    }
    if ((startYear && !endYear) || (!startYear && endYear)) {
      setError('请选择完整的开始年份和结束年份。');
      return;
    }
    if (startYear && endYear && Number(startYear) > Number(endYear)) {
      setError('开始年份不能晚于结束年份。');
      return;
    }
    if (!session) {
      navigate('/login');
      return;
    }
    setError('');
    setInfo('');
    setSearching(true);
    try {
      const membership = await Promise.race([
        fetchMembershipStatus(),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new Error('会员状态检查超时，请稍后重试。')),
            10_000,
          ),
        ),
      ]);
      if (!membership.canSearch) {
        navigate('/membership?reason=points_low');
        return;
      }
    } catch (err) {
      if (isMembershipRequiredError(err)) {
        navigate('/membership?reason=points_low');
        return;
      }
      setError(apiErrorMessage(err));
      return;
    } finally {
      setSearching(false);
    }
    onStartSearch({
      query: query.trim(),
      filters: { ...filters, timeRanges: startYear && endYear ? [`${startYear}-${endYear}`] : [] },
      mode: 'mixed',
      model: model || undefined,
      startedAt: Date.now(),
    });
    navigate('/results');
  }

  function handleQueryKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void search();
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    setInfo('');
    try {
      const completed: UploadResponse[] = [];
      for (const file of Array.from(files)) {
        completed.push(await uploadResearchFile(file));
      }
      setUploads((current) => [...completed, ...current].slice(0, 6));
      setInfo(
        completed.length === 1
          ? completed[0].message
          : `已上传 ${completed.length} 个文件到「用户补充数据知识库」，正在学习建索引。`,
      );
    } catch (uploadError) {
      setError(apiErrorMessage(uploadError));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <>
      <main
        className={`research-home${historyCollapsed ? ' history-collapsed' : ''}`}
      >
        <aside className="history-sidebar">
          <div className="history-title">
            <button
              type="button"
              title={historyCollapsed ? '展开历史记录' : '收起历史记录'}
              aria-label={historyCollapsed ? '展开历史记录' : '收起历史记录'}
              onClick={() => setHistoryCollapsed((current) => !current)}
            >
              {historyCollapsed ? '›' : '‹'}
            </button>
            <strong>
              <History size={15} />
              历史记录
            </strong>
          </div>
          {session ? (
            <div className="history-signed">
              {historyLoading ? (
                <>
                  <LoaderCircle className="spin" size={21} />
                  <span>正在加载历史记录…</span>
                </>
              ) : history.length ? (
                <div className="home-history-list">
                  {history.map((item) => (
                    <div className="home-history-item" key={item.id}>
                      <button
                        type="button"
                        title={item.query}
                        onClick={() => {
                          onHistorySelect(item.result);
                          navigate('/results');
                        }}
                      >
                        <strong>{item.query}</strong>
                        <small>
                          {new Date(item.createdAt).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="history-delete-button"
                        title="删除历史记录"
                        aria-label="删除历史记录"
                        disabled={deletingHistoryId === item.id}
                        onClick={() => setPendingDeleteId(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <History size={21} />
                  <strong>暂无历史记录</strong>
                  <span>开始一次检索后，记录会保存在这里</span>
                </>
              )}
            </div>
          ) : (
            <div className="history-gate">
              <div className="gate-icon">
                <LockKeyhole size={20} />
              </div>
              <strong>登录后查看历史记录</strong>
              <p>登录后自动保存并同步你的检索历史，支持搜索与清空</p>
              <div>
                <button
                  className="primary-button"
                  onClick={() => window.location.assign('/login')}
                >
                  立即登录
                </button>
                <button
                  className="secondary-button"
                  onClick={() => window.location.assign('/register')}
                >
                  注册账号
                </button>
              </div>
            </div>
          )}
        </aside>

        <section className="research-main">
          <div className="hero-title">
            <div className="hero-mark">AI</div>
            <h1>一站式数据智能搜索</h1>
            <p>
              输入研究问题，AI
              自动完成多源检索、数据标准化、智能分析与研究成果生成
            </p>
          </div>

          <section className="search-panel">
            <div className="query-row">
              <button
                type="button"
                className="query-icon query-upload-trigger"
                title="上传补充资料（写入用户补充数据知识库）"
                aria-label="上传补充资料"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <LoaderCircle className="spin" size={20} />
                ) : (
                  <Plus size={20} />
                )}
              </button>
              <textarea
                aria-label="研究问题"
                placeholder="问问任何问题..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleQueryKeyDown}
              />
              {query ? (
                <button
                  type="button"
                  className="query-clear"
                  title="清空研究问题"
                  aria-label="清空研究问题"
                  onClick={() => {
                    setQuery('');
                    setError('');
                  }}
                >
                  <X size={16} />
                </button>
              ) : null}
              <button
                type="button"
                className="primary-button search-button"
                disabled={searching}
                onClick={() => void search()}
              >
                {searching ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Search size={16} />
                )}
                {searching ? '检查中…' : '搜索'}
              </button>
            </div>

            <div className="filter-bar search-filter-bar restored-search-filters">
              <Select label="模型" value={model} options={modelOptions} onChange={setModel} />
              <MultiSelect label="国家 / 地区" value={[...filters.countries, ...filters.regions]}
                options={[...(catalog?.countries ?? []), ...(catalog?.regions ?? [])]}
                onChange={(values) => setFilters((current) => ({ ...current,
                  countries: values.filter((value) => catalog?.countries.some((item) => item.value === value)),
                  regions: values.filter((value) => catalog?.regions.some((item) => item.value === value)),
                }))} />
              <MultiSelect label="指定知识库" value={filters.libraryIds ?? []}
                options={libraries.map((library) => ({ value: library.id, label: library.name }))}
                onChange={(values) => setFilters((current) => ({ ...current, libraryIds: values }))} />
              <MultiSelect label="指定数据源" value={filters.sources} options={catalog?.sources ?? []}
                onChange={(values) => setFilters((current) => ({ ...current, sources: values }))} />
              <Select label="开始年份" value={startYear} options={yearOptions} onChange={setStartYear} />
              <Select label="结束年份" value={endYear} options={yearOptions} onChange={setEndYear} />
              <button type="button" className="filter-reset" onClick={() => { setFilters(emptyResearchFilters()); setStartYear(''); setEndYear(''); }}>清空筛选</button>
            </div>
            {librariesError && <p className="filter-load-error" role="alert">知识库选项加载失败，请刷新页面重试。</p>}
            {catalogError && <p className="filter-load-error" role="alert">筛选选项加载失败，请刷新页面重试。</p>}
            <div className="research-prompts" aria-label="快捷预填">
              <span>快捷预填：</span>
              {['主要经济体 2025 年 GDP 排名', '比较 2020-2025 年中美 GDP 增长率', '中国 CPI / PPI 月度走势', '全球主要经济体通胀率对比'].map((prompt) => (
                <button type="button" key={prompt} onClick={() => { setQuery(prompt); setError(''); }}>{prompt}</button>
              ))}
            </div>
          </section>

          {error && (
            <div className="error-banner">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          {info && !error && (
            <div className="info-banner">
              <UploadCloud size={18} />
              <span>{info}</span>
              <button
                type="button"
                className="icon-button"
                title="关闭"
                onClick={() => setInfo('')}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {uploads.length > 0 && (
            <section
              className="upload-strip research-upload-strip"
              aria-label="最近上传"
            >
              <div className="section-title compact">
                <div>
                  <UploadCloud size={18} />
                  <h2>最近上传</h2>
                </div>
                <span>已写入用户补充数据知识库 · {uploads.length} 个来源</span>
              </div>
              <div className="upload-list">
                {uploads.map((upload) => (
                  <div className="upload-row" key={upload.source.id}>
                    {upload.source.storageType === 'structured' ? (
                      <TableProperties size={18} />
                    ) : (
                      <BookOpen size={18} />
                    )}
                    <div>
                      <strong>{upload.source.title}</strong>
                      <span>{upload.message}</span>
                    </div>
                    <span className={`type-badge ${upload.source.storageType}`}>
                      {upload.source.storageType === 'structured'
                        ? '结构化数据'
                        : '知识资料'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <RecentSearchCharts
            history={session ? history : []}
            loading={historyLoading}
            error={historyError}
            analysisError={analysisHistoryError}
            signedIn={Boolean(session)}
            onOpen={(result) => {
              onHistorySelect(result);
              navigate('/results');
            }}
            onOpenAnalysis={(id) =>
              navigate(
                `/analysis?sessionId=${encodeURIComponent(id)}&view=report&saved=1`,
              )
            }
          />
        </section>

        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </main>
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="删除搜索记录？"
        message="删除后将无法恢复该历史记录及其关联的搜索结果。"
        busy={Boolean(deletingHistoryId)}
        onCancel={() => !deletingHistoryId && setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return;
          setDeletingHistoryId(pendingDeleteId);
          void deleteResearchHistory(pendingDeleteId)
            .then(() => setHistory((current) => current.filter((row) => row.id !== pendingDeleteId)))
            .catch(() => undefined)
            .finally(() => {
              setDeletingHistoryId(null);
              setPendingDeleteId(null);
            });
        }}
      />
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="research-filter-select">
      <span className="filter-select-label">{label}</span>
      <AntdSelect
        aria-label={label}
        value={value || undefined}
        showSearch
        optionFilterProp="label"
        placeholder={`请选择${label}`}
        options={options}
        allowClear
        suffixIcon={<ChevronDown size={15} />}
        onChange={(nextValue) => onChange(nextValue ?? '')}
      />
    </label>
  );
}

function MultiSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="research-filter-select">
      <span className="filter-select-label">{label}</span>
      <AntdSelect
        aria-label={label}
        mode="multiple"
        value={value}
        showSearch
        optionFilterProp="label"
        placeholder={`请选择${label}`}
        options={options}
        maxTagCount="responsive"
        allowClear
        suffixIcon={<ChevronDown size={15} />}
        onChange={(nextValue) => onChange(Array.isArray(nextValue) ? nextValue : [])}
      />
    </label>
  );
}

const yearOptions = Array.from({ length: 301 }, (_, index) => { const year = String(1900 + index); return { value: year, label: year }; });
