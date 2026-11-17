import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Globe2,
  Search,
  Upload,
  LoaderCircle,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  LoginResponse,
  ResearchSearchResponse,
  ResearchSource,
  ResearchSearchProgress,
} from '@agent/contracts';
import DepositKnowledgeModal from '../components/DepositKnowledgeModal';
import { knowledgeSourceAttribution } from '../utils/knowledge-source';
import ConfirmDialog from '../components/ConfirmDialog';
import ResearchLayout from '../layouts/ResearchLayout';
import {
  createAnalysisSession,
  getRecentAnalysisSessions,
  getKnowledgeSourcePreview,
  type KnowledgeSourcePreview,
  getResearchHistory,
  deleteResearchHistory,
  SearchClientTimeoutError,
  searchDataAnalysisAsync,
  SEARCH_MAX_WAIT_MS,
  type ResearchHistoryItem,
  type AnalysisSession,
} from '../api/data-analysis';
import { apiErrorMessage } from '../api/research';
import { isMembershipRequiredError } from '../api/membership';
import { type PendingSearchJob } from '../search-progress';
import { renderMarkdown } from '../utils/markdown';
import { browsableExternalUrl } from '../utils/browsable-external-url';
import {
  buildSemanticParseSummary,
  formatSemanticList,
} from '../semantic-parse-summary';
import './SearchResultsPage.css';

type SearchFailureKind = 'client_timeout' | 'cancelled' | 'server' | null;

const ANALYSIS_RECOVERY_WINDOW_MS = 90_000;
const ANALYSIS_RECOVERY_POLL_MS = 3_000;

export default function SearchResultsPage({
  session,
  result,
  pendingSearch,
  selectedIds,
  onSelectionChange,
  onResult,
  onClearPending,
  onHistorySelect,
  onAnalysisPending,
  onAnalysisReady,
  onSearchFailed,
  onLogout,
  onBack,
}: {
  session: LoginResponse | null;
  result: ResearchSearchResponse | null;
  pendingSearch: PendingSearchJob | null;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onResult: (result: ResearchSearchResponse) => void;
  onClearPending: () => void;
  onHistorySelect: (result: ResearchSearchResponse) => void;
  onAnalysisPending: (pending: boolean) => void;
  onAnalysisReady: (id: string) => void;
  onSearchFailed: (failed: boolean) => void;
  onLogout: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'exa' | 'local'>('all');
  const [active, setActive] = useState<ResearchSource | undefined>(undefined);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [knowledgePreview, setKnowledgePreview] =
    useState<KnowledgeSourcePreview>();
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositInfo, setDepositInfo] = useState('');
  const [progressStatus, setProgressStatus] = useState<
    'running' | 'done' | 'error'
  >(pendingSearch ? 'running' : 'done');
  const [searchError, setSearchError] = useState('');
  const [searchFailureKind, setSearchFailureKind] =
    useState<SearchFailureKind>(null);
  const [jobStartedAt, setJobStartedAt] = useState(
    pendingSearch?.startedAt ?? Date.now(),
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveProgress, setLiveProgress] =
    useState('正在理解问题并规划检索来源');
  const [liveStage, setLiveStage] =
    useState<ResearchSearchProgress['stage']>('planning');
  const [creatingAnalysis, setCreatingAnalysis] = useState(false);
  const [savedAnalysis, setSavedAnalysis] = useState<AnalysisSession>();
  const [savedAnalysisLoading, setSavedAnalysisLoading] = useState(false);
  const [savedAnalysisError, setSavedAnalysisError] = useState(false);
  const [savedAnalysisAttempt, setSavedAnalysisAttempt] = useState(0);
  const [actionError, setActionError] = useState('');
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  /** Auto-open first Exa preview once per completed run (user may close manually). */
  const autoPreviewRunIdRef = useRef<string | null>(null);

  const displayQuery = pendingSearch?.query || result?.query || '';
  useEffect(() => {
    setSavedAnalysis(undefined);
    setSavedAnalysisError(false);
    if (!result?.runId || !session?.accessToken || pendingSearch) {
      setSavedAnalysisLoading(false);
      return;
    }
    const controller = new AbortController();
    setSavedAnalysisLoading(true);
    void getRecentAnalysisSessions([result.runId], controller.signal)
      .then((sessions) => {
        if (!controller.signal.aborted)
          setSavedAnalysis(sessions.find((item) => item.runId === result.runId));
      })
      .catch(() => {
        if (!controller.signal.aborted) setSavedAnalysisError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSavedAnalysisLoading(false);
      });
    return () => controller.abort();
  }, [result?.runId, session?.accessToken, pendingSearch, savedAnalysisAttempt]);
  useEffect(() => {
    if (!pendingSearch) {
      setProgressStatus('done');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setJobStartedAt(pendingSearch.startedAt);
    setProgressStatus('running');
    setLiveProgress('正在理解问题并规划检索来源');
    setLiveStage('planning');
    onSearchFailed(false);
    setSearchError('');
    setSearchFailureKind(null);
    setDepositInfo('');
    setActive(undefined);
    autoPreviewRunIdRef.current = null;

    void (async () => {
      try {
        const next = await searchDataAnalysisAsync(
          pendingSearch.query,
          pendingSearch.filters,
          pendingSearch.mode,
          controller.signal,
          undefined,
          (snapshot) => {
            if (!cancelled && snapshot.progress) {
              const { round, message } = snapshot.progress;
              setLiveStage(snapshot.progress.stage);
              setLiveProgress(`${round ? `第 ${round} 轮 · ` : ''}${message}`);
            }
          },
          `${pendingSearch.startedAt}:${searchAttempt}`,
          pendingSearch.model,
        );
        if (cancelled) return;
        setProgressStatus('done');
        onResult(next);
      } catch (err) {
        if (cancelled) return;
        if (isMembershipRequiredError(err)) {
          onClearPending();
          navigate('/membership?reason=points_low', { replace: true });
          return;
        }
        setProgressStatus('error');
        onSearchFailed(true);
        if (err instanceof SearchClientTimeoutError) {
          setSearchFailureKind('client_timeout');
          setSearchError(
            `已等待 ${Math.round(SEARCH_MAX_WAIT_MS / 1000 / 60)} 分钟，页面已停止等待。服务端可能仍在检索，请稍后从历史记录查看结果。`,
          );
        } else if (isRequestCancelled(err)) {
          setSearchFailureKind('cancelled');
          setSearchError('本次检索已取消。');
        } else {
          setSearchFailureKind('server');
          setSearchError(apiErrorMessage(err));
        }
      } finally {
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when a new job starts
  }, [pendingSearch?.startedAt, pendingSearch?.query, searchAttempt]);

  useEffect(() => {
    setPreviewFailed(false);
    setKnowledgePreview(undefined);
    if (!active || active.storageType === 'structured') return;
    let cancelled = false;
    void getKnowledgeSourcePreview(active.id)
      .then((preview) => {
        if (!cancelled) setKnowledgePreview(preview);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, previewAttempt]);

  function retryPreview() {
    setPreviewFailed(false);
    setKnowledgePreview(undefined);
    setPreviewAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    if (!result) return;
    if (session) {
      void getResearchHistory()
        .then(setHistory)
        .catch(() => undefined);
      return;
    }
    try {
      const key = 'research:history';
      const current = JSON.parse(
        window.localStorage.getItem(key) || '[]',
      ) as ResearchHistoryItem[];
      const next = [
        {
          id: result.runId,
          result,
          query: result.query,
          createdAt: new Date().toISOString(),
        },
        ...current.filter((item) => item.result.runId !== result.runId),
      ].slice(0, 20);
      window.localStorage.setItem(key, JSON.stringify(next));
      setHistory(next);
    } catch {
      setHistory([]);
    }
  }, [result, session]);

  const sources = useMemo(() => {
    const list = result?.sources ?? [];
    return list.filter(
      (source) =>
        tab === 'all' ||
        (tab === 'exa' ? source.origin === 'exa' : source.origin !== 'exa'),
    );
  }, [result?.sources, tab]);
  const selectedSources = useMemo(
    () => (result?.sources ?? []).filter((s) => selectedIds.includes(s.id)),
    [result?.sources, selectedIds],
  );
  const allSources = result?.sources ?? [];
  const exaCount = allSources.filter((s) => s.origin === 'exa').length;
  const localCount = allSources.length - exaCount;
  const running = progressStatus === 'running';

  useEffect(() => {
    if (running || !result) return;
    if (autoPreviewRunIdRef.current === result.runId) return;
    const firstExa = result.sources.find((source) => source.origin === 'exa');
    autoPreviewRunIdRef.current = result.runId;
    if (firstExa) setActive(firstExa);
  }, [result, running]);

  useEffect(() => {
    if (!running) return;
    const update = () =>
      setElapsedSec(Math.max(0, (Date.now() - jobStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [running, jobStartedAt]);

  const progressStages = useMemo(() => {
    if (progressStatus === 'error') {
      if (searchFailureKind === 'client_timeout') {
        return [
          { label: '语义解析', state: 'done' as const },
          { label: '知识库检索', state: 'interrupted' as const },
          { label: '外部来源检索', state: 'interrupted' as const },
        ];
      }
      if (searchFailureKind === 'cancelled') {
        return [
          { label: '语义解析', state: 'active' as const },
          { label: '知识库检索', state: 'pending' as const },
          { label: '外部来源检索', state: 'pending' as const },
        ];
      }
      return [
        { label: '语义解析', state: 'done' as const },
        { label: '知识库检索', state: 'interrupted' as const },
        { label: '外部来源检索', state: 'interrupted' as const },
      ];
    }
    if (!running && result) {
      const byKey = new Map(result.stages.map((stage) => [stage.key, stage]));
      const knowledgeStage =
        byKey.get('vector')?.status === 'completed'
          ? byKey.get('vector')
          : byKey.get('database')?.status === 'completed'
            ? byKey.get('database')
            : (byKey.get('vector') ?? byKey.get('database'));
      const exaStage = byKey.get('exa');
      const toUi = (
        status: string | undefined,
      ): 'done' | 'failed' | 'skipped' =>
        status === 'completed'
          ? 'done'
          : status === 'failed'
            ? 'failed'
            : 'skipped';
      return [
        {
          label: '语义解析',
          state: 'done' as const,
          detail: byKey.get('plan')?.detail,
        },
        {
          label: '知识库检索',
          state: toUi(knowledgeStage?.status),
          detail: knowledgeStage?.detail,
        },
        {
          label: '外部来源检索',
          state: toUi(exaStage?.status),
          detail: exaStage?.detail,
        },
      ];
    }
    const semanticDone = liveStage !== 'planning' && liveStage !== 'replanning';
    const retrievalActive =
      liveStage === 'searching' ||
      liveStage === 'discovering' ||
      liveStage === 'evaluating' ||
      liveStage === 'writing';
    return [
      { label: '语义解析', state: semanticDone ? 'done' : 'active' },
      {
        label: '知识库检索',
        state: retrievalActive ? 'active' : 'pending',
      },
      {
        label: liveStage === 'discovering' ? '站内数据发现' : '外部来源检索',
        state: retrievalActive ? 'active' : 'pending',
      },
    ];
  }, [liveStage, progressStatus, result, running, searchFailureKind]);

  const semanticSummary = useMemo(
    () => buildSemanticParseSummary(result),
    [result],
  );

  const showSemanticPending =
    running && !semanticSummary && progressStages[0]?.state === 'done';

  function retrySearch() {
    if (!pendingSearch || running) return;
    setSearchAttempt((attempt) => attempt + 1);
  }

  function cancelSearch() {
    searchAbortRef.current?.abort();
    onClearPending();
    navigate('/research', { replace: true });
  }

  function openDeposit() {
    if (!selectedIds.length || !result) return;
    if (!session) {
      navigate('/login');
      return;
    }
    setDepositOpen(true);
  }

  async function enterAnalysis() {
    if (!selectedIds.length || creatingAnalysis || !result || running) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setCreatingAnalysis(true);
    onAnalysisPending(true);
    setActionError('');
    try {
      const analysis = await createAnalysisSession(
        {
          runId: result.runId,
          query: result.query,
          sourceIds: selectedIds,
        },
        controller.signal,
      );
      if (analysisAbortRef.current !== controller) return;
      setSavedAnalysis(analysis);
      setSavedAnalysisAttempt((value) => value + 1);
      onAnalysisReady(analysis.id);
    } catch (error) {
      if (analysisAbortRef.current !== controller) return;
      if (isGatewayTimeout(error)) {
        setActionError('服务响应超时，正在确认分析结果是否已保存...');
        const recovered = await recoverAnalysisSession(
          result.runId,
          selectedIds,
          controller,
        );
        if (analysisAbortRef.current !== controller) return;
        if (recovered) {
          setSavedAnalysis(recovered);
          setSavedAnalysisAttempt((value) => value + 1);
          onAnalysisReady(recovered.id);
          return;
        }
      }
      setActionError(
        controller.signal.aborted
          ? '已停止等待，后台分析仍会继续。再次进入分析可继续读取结果。'
          : isGatewayTimeout(error)
            ? '分析服务返回 504 超时，未能确认结果。请稍后重试；已完成的分析会话会自动复用。'
            : apiErrorMessage(error),
      );
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
        setCreatingAnalysis(false);
        onAnalysisPending(false);
      }
    }
  }

  function cancelAnalysis() {
    const controller = analysisAbortRef.current;
    analysisAbortRef.current = null;
    controller?.abort();
    setCreatingAnalysis(false);
    onAnalysisPending(false);
    setActionError(
      '已停止等待，后台分析仍会继续。再次进入分析可继续读取结果。',
    );
  }

  return (
    <ResearchLayout session={session} onLogout={onLogout} hasResult>
      <main className="results-page">
        <aside className="results-history">
          <button className="back-history" onClick={onBack}>
            <ArrowLeft size={15} /> 返回搜索
          </button>
          <div className="history-query">
            <Search size={15} />
            <span>{displayQuery}</span>
          </div>
          <div className="history-caption">
            本次检索 ·{' '}
            {new Date(jobStartedAt).toLocaleString('zh-CN', { hour12: false })}
          </div>
          <div className="history-list">
            {history.map((item) => (
              <div className="results-history-item" key={item.id}>
                <button
                  className={
                    result && item.result.runId === result.runId
                      ? 'current'
                      : ''
                  }
                  title={item.query}
                  onClick={() => onHistorySelect(item.result)}
                  disabled={running}
                >
                  <span>{item.query}</span>
                  <small>
                    {new Date(item.createdAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </button>
                {session ? (
                  <button
                    type="button"
                    className="results-history-delete"
                    title="删除历史记录"
                    aria-label="删除历史记录"
                    disabled={running || deletingHistoryId === item.id}
                    onClick={() => setPendingDeleteId(item.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <section className="results-center">
          <div className="result-query-card">
            <h1>{displayQuery}</h1>
            <p>
              {running
                ? liveProgress
                : result
                  ? `检索任务 ${result.runId} · 已完成多源搜索与内容整理`
                  : searchError || '暂无结果'}
            </p>
          </div>

          <div
            className={`search-progress exec-progress ${progressStatus}`}
            role="status"
            aria-live="polite"
          >
            <div className="search-progress-head">
              <div className="exec-progress-title">
                {running ? (
                  <LoaderCircle className="spin" size={16} />
                ) : progressStatus === 'error' ? (
                  <AlertCircle size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>
                  {running
                    ? '搜索仍在进行中'
                    : progressStatus === 'error'
                      ? searchFailureKind === 'client_timeout'
                        ? '等待超时 · 已停止轮询'
                        : searchFailureKind === 'cancelled'
                          ? '检索已取消'
                          : '检索失败'
                      : '检索完成 · 已生成结果'}
                </span>
              </div>
              {running ? (
                <div className="search-progress-head-actions">
                  <small>已用时 {elapsedSec.toFixed(0)} 秒</small>
                  <button
                    type="button"
                    className="results-cancel-search"
                    onClick={cancelSearch}
                  >
                    <X size={13} /> 取消搜索
                  </button>
                </div>
              ) : null}
            </div>
            <ol className="exec-progress-steps search-progress-steps">
              {progressStages.map((stage, index) => {
                const stateLabel =
                  stage.state === 'active'
                    ? '进行中'
                    : stage.state === 'interrupted'
                      ? '已中断'
                      : stage.state === 'failed'
                        ? '失败'
                        : stage.state === 'skipped'
                          ? '未执行'
                          : stage.state === 'pending'
                            ? '等待中'
                            : '已完成';
                const detail =
                  'detail' in stage &&
                  stage.detail &&
                  (stage.state === 'skipped' || stage.state === 'failed')
                    ? stage.detail
                    : undefined;
                return (
                  <li key={stage.label} className={stage.state} title={detail}>
                    <i aria-hidden />
                    <em>
                      {stage.label}（{stateLabel}）
                    </em>
                    {index < progressStages.length - 1 ? (
                      <span className="exec-progress-connector" aria-hidden />
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {semanticSummary ? (
              <div className="semantic-parse-panel" aria-label="语义解析结果">
                <p className="semantic-parse-panel-title">语义解析结果</p>
                <dl className="semantic-parse-grid">
                  <div>
                    <dt>实体</dt>
                    <dd>{formatSemanticList(semanticSummary.entities)}</dd>
                  </div>
                  <div>
                    <dt>维度</dt>
                    <dd>{formatSemanticList(semanticSummary.dimensions)}</dd>
                  </div>
                  <div>
                    <dt>指标</dt>
                    <dd>{formatSemanticList(semanticSummary.metrics)}</dd>
                  </div>
                </dl>
                {semanticSummary.explanation ? (
                  <p className="semantic-parse-explanation">
                    {semanticSummary.explanation}
                  </p>
                ) : null}
              </div>
            ) : showSemanticPending ? (
              <p className="semantic-parse-pending">
                语义层正在整理实体、维度与指标，完成后将显示在此处…
              </p>
            ) : null}
          </div>

          {depositInfo ? (
            <div className="deposit-toast">
              <CheckCircle2 size={15} />
              <span>{depositInfo}</span>
              <button type="button" onClick={() => setDepositInfo('')}>
                关闭
              </button>
            </div>
          ) : null}

          {progressStatus === 'error' ? (
            <section className="search-error-state" role="alert">
              <strong>
                {searchFailureKind === 'client_timeout'
                  ? '客户端等待超时'
                  : searchFailureKind === 'cancelled'
                    ? '检索已取消'
                    : searchFailureKind === 'server'
                      ? '服务端检索失败'
                      : '检索未完成'}
              </strong>
              <p>{searchError || '请求未能完成，请稍后重试。'}</p>
              <div>
                <button
                  type="button"
                  className="generate-analysis-action"
                  onClick={retrySearch}
                >
                  <RotateCcw size={15} /> 重新搜索
                </button>
                <button
                  type="button"
                  className="reserve-action"
                  onClick={cancelSearch}
                >
                  返回搜索
                </button>
              </div>
            </section>
          ) : null}

          {running ? (
            <div className="empty-source-preview">
              <FileText size={28} />
              <p>正在检索与整理来源，请稍候…</p>
            </div>
          ) : active ? (
            <Preview
              source={active}
              knowledgePreview={knowledgePreview}
              failed={previewFailed}
              onFailed={() => setPreviewFailed(true)}
              onRetry={retryPreview}
              onClose={() => setActive(undefined)}
            />
          ) : (
            <div className="empty-source-preview">
              <FileText size={28} />
              <p>
                {progressStatus === 'error'
                  ? '检索失败，请返回重新搜索'
                  : '点击右侧来源卡片查看内容'}
              </p>
            </div>
          )}
          {!running && result ? (
            <footer className="results-actions">
              <div>
                <strong>已选择 {selectedIds.length} 个来源</strong>
                <span>
                  {actionError ||
                    (savedAnalysisLoading ? '正在查找已保存的分析…' : savedAnalysisError ? '历史分析查找失败，请重试' : '生成后直接进入数据分析工作台，可切换指标、查看图表或分析结果')}
                </span>
              </div>
              <div>
                <button
                  type="button"
                  className="reserve-action"
                  disabled={!selectedIds.length}
                  onClick={openDeposit}
                >
                  <Upload size={14} /> 存入知识库
                </button>
                {savedAnalysis?.runId === result.runId && !creatingAnalysis && (
                  <button
                    type="button"
                    className="reserve-action"
                    onClick={() => navigate(`/analysis?sessionId=${encodeURIComponent(savedAnalysis.id)}&view=matrix&saved=1`)}
                  >
                    <Eye size={14} /> 查看已生成的分析表
                  </button>
                )}
                {savedAnalysisError && (
                  <button type="button" className="reserve-action" onClick={() => setSavedAnalysisAttempt((value) => value + 1)}>
                    重试查找历史分析
                  </button>
                )}
                <button
                  type="button"
                  className="generate-analysis-action"
                  disabled={!selectedIds.length || creatingAnalysis}
                  onClick={() => void enterAnalysis()}
                >
                  {creatingAnalysis ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Database size={16} />
                  )}
                  {creatingAnalysis
                    ? '正在生成数据分析表...'
                    : '生成数据分析表'}
                </button>
                {creatingAnalysis && (
                  <button
                    type="button"
                    className="reserve-action"
                    onClick={cancelAnalysis}
                  >
                    <X size={14} /> 取消
                  </button>
                )}
              </div>
            </footer>
          ) : null}
        </section>

        <aside className="results-sources">
          <div className="source-heading">
            <strong>全部来源</strong>
            <span>{allSources.length}</span>
            <button
              type="button"
              disabled={running || !allSources.length}
              onClick={() =>
                onSelectionChange(
                  selectedIds.length === allSources.length
                    ? []
                    : allSources.map((s) => s.id),
                )
              }
            >
              {selectedIds.length === allSources.length ? '清空' : '全选'}
            </button>
          </div>
          <div className="source-tabs">
            <button
              type="button"
              className={tab === 'all' ? 'active' : ''}
              onClick={() => setTab('all')}
            >
              全部 <em>{allSources.length}</em>
            </button>
            {exaCount > 0 ? (
              <button
                type="button"
                className={tab === 'exa' ? 'active' : ''}
                onClick={() => setTab('exa')}
              >
                <Globe2 size={13} />{' '}
                {result.mode === 'ai-search' ? 'AI 搜索' : '联网'}{' '}
                <em>{exaCount}</em>
              </button>
            ) : null}
            {localCount > 0 ? (
              <button
                type="button"
                className={tab === 'local' ? 'active' : ''}
                onClick={() => setTab('local')}
              >
                <Database size={13} /> 知识库 <em>{localCount}</em>
              </button>
            ) : null}
          </div>
          <div className="source-list">
            {running ? (
              <div className="source-loading">来源列表生成中…</div>
            ) : (
              sources.map((source, index) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  index={index + 1}
                  active={active?.id === source.id}
                  selected={selectedIds.includes(source.id)}
                  onActivate={() => setActive(source)}
                  onSelect={() =>
                    onSelectionChange(
                      selectedIds.includes(source.id)
                        ? selectedIds.filter((id) => id !== source.id)
                        : [...selectedIds, source.id],
                    )
                  }
                />
              ))
            )}
          </div>
        </aside>
      </main>

      {depositOpen && result ? (
        <DepositKnowledgeModal
          sources={selectedSources}
          taskId={result.runId}
          authorName={
            session?.profile?.displayName || session?.profile?.username || null
          }
          onClose={() => setDepositOpen(false)}
          onRemoveSource={(sourceId) => {
            onSelectionChange(selectedIds.filter((id) => id !== sourceId));
          }}
          onDone={(message) => {
            setDepositOpen(false);
            setDepositInfo(message);
          }}
        />
      ) : null}
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
            .then(() =>
              setHistory((current) =>
                current.filter((row) => row.id !== pendingDeleteId),
              ),
            )
            .catch(() => undefined)
            .finally(() => {
              setDeletingHistoryId(null);
              setPendingDeleteId(null);
            });
        }}
      />
    </ResearchLayout>
  );
}

function SourceCard({
  source,
  index,
  active,
  selected,
  onActivate,
  onSelect,
}: {
  source: ResearchSource;
  index: number;
  active: boolean;
  selected: boolean;
  onActivate: () => void;
  onSelect: () => void;
}) {
  return (
    <article
      className={`source-card ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      <div className="source-index">
        {source.origin === 'exa' ? index : <FileText size={16} />}
      </div>
      <div className="source-card-body">
        <div className="source-title">
          {source.title}{' '}
          {source.origin === 'exa' ? <ExternalLink size={12} /> : null}
        </div>
        <p>
          {source.excerpt ||
            (source as ResearchSource & { content?: string }).content ||
            '暂无摘要'}
        </p>
        <small>
          {knowledgeSourceAttribution(source)} · {source.recordCount || 1}{' '}
          个内容片段
        </small>
        {source.origin === 'exa' && source.sourceUrl ? (
          <a
            className="source-site"
            href={browsableExternalUrl(source.sourceUrl)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            title={browsableExternalUrl(source.sourceUrl)}
          >
            来源网站：
            {sourceWebsiteHost(browsableExternalUrl(source.sourceUrl))}
          </a>
        ) : null}
        <label onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onSelect} />{' '}
          勾选纳入数据分析
        </label>
      </div>
    </article>
  );
}

function sourceWebsiteHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return value;
  }
}

function Preview({
  source,
  knowledgePreview,
  failed,
  onFailed,
  onRetry,
  onClose,
}: {
  source: ResearchSource;
  knowledgePreview?: KnowledgeSourcePreview;
  failed: boolean;
  onFailed: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const isExa = source.origin === 'exa';
  return (
    <div className="inline-preview">
      <div className="preview-toolbar">
        <strong>{isExa ? '网页源文档' : '知识库文件预览'}</strong>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      {isExa ? (
        <ExaSourcePreview
          source={source}
          preview={knowledgePreview}
          failed={failed}
          onRetry={onRetry}
        />
      ) : (
        <KnowledgePreview
          preview={knowledgePreview}
          source={source}
          failed={failed}
          onFailed={onFailed}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}

/**
 * Exa pages usually cannot be iframe-embedded (X-Frame-Options / CSP).
 * Preview the hydrated article text from the API instead, and keep a link
 * to open the original URL in a new tab.
 */
function ExaSourcePreview({
  source,
  preview,
  failed,
  onRetry,
}: {
  source: ResearchSource;
  preview?: KnowledgeSourcePreview;
  failed: boolean;
  onRetry: () => void;
}) {
  const url = source.sourceUrl
    ? browsableExternalUrl(source.sourceUrl)
    : preview && 'sourceUrl' in preview && preview.sourceUrl
      ? browsableExternalUrl(preview.sourceUrl)
      : '';
  const host = url ? sourceWebsiteHost(url) : '';
  const text =
    preview?.kind === 'document'
      ? preview.text
      : source.content || source.excerpt || '';

  if (!url && !text.trim()) {
    return (
      <div className="file-preview exa-source-preview">
        <Globe2 size={30} />
        <h3>{source.title}</h3>
        <p>该来源没有可打开的网页链接。</p>
      </div>
    );
  }

  if (!preview && !failed && !text.trim()) {
    return (
      <div className="file-preview exa-source-preview">
        <Globe2 size={30} />
        <h3>{source.title}</h3>
        {host ? <small className="exa-source-host">{host}</small> : null}
        <p>正在获取网页正文预览…</p>
      </div>
    );
  }

  if (failed && !text.trim()) {
    return (
      <div className="file-preview exa-source-preview">
        <Globe2 size={30} />
        <h3>{source.title}</h3>
        {host ? <small className="exa-source-host">{host}</small> : null}
        <p className="exa-source-hint">
          未能在应用内加载该网页正文。请使用下方链接在新窗口查看原文。
        </p>
        {url ? (
          <a
            className="exa-open-original"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} />
            在新窗口打开原文
          </a>
        ) : null}
        <button type="button" className="preview-retry" onClick={onRetry}>
          重试预览
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="document-preview">
        <article className="markdown-preview">
          {text.trim() ? renderMarkdown(text) : <p>暂无可预览内容</p>}
        </article>
        {preview?.kind === 'document' && preview.truncated ? (
          <p>仅展示文件前 200,000 个字符。</p>
        ) : null}
      </div>
      <div className="preview-link exa-preview-link">
        <span>{host || 'Exa 联网来源'}</span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} />
            在新窗口打开原文
          </a>
        ) : null}
      </div>
    </>
  );
}

function KnowledgePreview({
  preview,
  source,
  failed,
  onFailed,
  onRetry,
}: {
  preview?: KnowledgeSourcePreview;
  source: ResearchSource;
  failed: boolean;
  onFailed: () => void;
  onRetry: () => void;
}) {
  if (source.storageType === 'structured') {
    return <StructuredSourcePreview source={source} />;
  }
  if (!preview) {
    return (
      <div className="file-preview">
        <FileText size={30} />
        <h3>{source.title}</h3>
        <p>
          {failed ? '文件预览加载失败，请稍后重试。' : '正在获取文件预览。'}
        </p>
        {failed && source.sourceUrl ? (
          <a href={source.sourceUrl} target="_blank" rel="noreferrer">
            打开原始文件
          </a>
        ) : null}
        {failed ? (
          <button type="button" className="preview-retry" onClick={onRetry}>
            重试预览
          </button>
        ) : null}
      </div>
    );
  }
  if (preview.kind === 'pdf') {
    return (
      <>
        <iframe title={source.title} src={preview.sourceUrl} />
        <div className="preview-link">
          <a href={preview.sourceUrl} target="_blank" rel="noreferrer">
            在新窗口打开 PDF
          </a>
        </div>
      </>
    );
  }
  if (preview.kind === 'document') {
    return (
      <div className="document-preview">
        <article className="markdown-preview">
          {preview.text.trim() ? (
            renderMarkdown(preview.text)
          ) : (
            <p>暂无可预览内容</p>
          )}
        </article>
        {preview.truncated ? <p>仅展示文件前 200,000 个字符。</p> : null}
      </div>
    );
  }
  if (preview.kind === 'html') {
    if (!preview.html.trim()) {
      return (
        <div className="file-preview">
          <FileText size={30} />
          <h3>{source.title}</h3>
          <p>该 HTML 文件没有可展示的内容。</p>
        </div>
      );
    }
    return (
      <>
        <iframe
          title={source.title}
          srcDoc={preview.html}
          sandbox=""
          referrerPolicy="no-referrer"
          onError={onFailed}
        />
        {preview.truncated ? (
          <p className="preview-truncated">仅展示文件前 200,000 个字符。</p>
        ) : null}
      </>
    );
  }
  return (
    <div className="spreadsheet-preview">
      <div className="spreadsheet-meta">
        工作表：{preview.sheetName || '未命名'} · {preview.totalRows} 行 ×{' '}
        {preview.totalColumns} 列
        {preview.truncated ? ' · 仅展示前 200 行、50 列' : ''}
      </div>
      <div className="spreadsheet-scroll">
        <table>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StructuredSourcePreview({ source }: { source: ResearchSource }) {
  const rows = structuredPreviewRows(source.structuredData);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(
    0,
    25,
  );
  if (!rows.length || !columns.length) {
    return (
      <div className="file-preview">
        <FileText size={30} />
        <h3>{source.title}</h3>
        <p>{source.excerpt || '该结构化来源暂未包含可展示的记录。'}</p>
      </div>
    );
  }
  return (
    <div className="spreadsheet-preview structured-source-preview">
      <div className="spreadsheet-meta">
        结构化查询结果 · {rows.length} 条记录
        {rows.length > 50 ? ' · 仅展示前 50 条' : ''}
      </div>
      <div className="spreadsheet-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 50).map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column}>{formatStructuredCell(row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function structuredPreviewRows(value: unknown): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  );
}

function formatStructuredCell(value: unknown) {
  if (value == null) return '-';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function isRequestCancelled(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === 'ERR_CANCELED' || candidate.name === 'CanceledError'
  );
}

function isGatewayTimeout(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { status?: unknown } }).response;
  return response?.status === 504;
}

async function recoverAnalysisSession(
  runId: string,
  sourceIds: string[],
  controller: AbortController,
) {
  const deadline = Date.now() + ANALYSIS_RECOVERY_WINDOW_MS;
  const expected = [...sourceIds].sort();
  while (!controller.signal.aborted && Date.now() < deadline) {
    try {
      const sessions = await getRecentAnalysisSessions(
        [runId],
        controller.signal,
      );
      const match = sessions.find(
        (item) =>
          item.selectedSourceIds.length === expected.length &&
          [...item.selectedSourceIds]
            .sort()
            .every((id, index) => id === expected[index]),
      );
      if (match) return match;
    } catch {
      if (controller.signal.aborted) return null;
    }
    await new Promise((resolve) =>
      window.setTimeout(resolve, ANALYSIS_RECOVERY_POLL_MS),
    );
  }
  return null;
}
