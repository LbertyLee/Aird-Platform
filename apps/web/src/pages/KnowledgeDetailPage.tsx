import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type FormEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  Bot,
  Download,
  Eye,
  FileText,
  FolderInput,
  Globe2,
  Info,
  LayoutGrid,
  Link2,
  List,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type { LoginResponse } from '@agent/contracts';
import {
  apiErrorMessage,
  archiveKnowledgeItem,
  createTextKnowledge,
  downloadKnowledgeItem,
  fetchKnowledgeGroups,
  saveKnowledgeGroup,
  deleteKnowledgeGroup,
  fetchKnowledgeItemFileBlob,
  fetchKnowledgeItemPreview,
  fetchKnowledgeLibraryDetail,
  fetchKnowledgeLibraryItems,
  recallTestKnowledgeLibrary,
  updateKnowledgeItem,
  updateKnowledgeLibrary,
  uploadKnowledgeFile,
  type KnowledgeFilePreview,
  type KnowledgeGroupOption,
  type KnowledgeRecallHit,
  type KnowledgeVisibility,
  type UserKnowledgeItem,
  type UserKnowledgeLibrary,
} from '../api/knowledge';
import { renderMarkdown } from '../utils/markdown';

const UPLOAD_ACCEPT =
  '.txt,.md,.markdown,.html,.htm,.json,.csv,.xlsx,.xls,.pdf,.doc,.docx';
const PREVIEW_REQUEST_TIMEOUT_MS = 45_000;
const ALLOWED_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.json',
  '.csv',
  '.xlsx',
  '.xls',
  '.pdf',
  '.doc',
  '.docx',
]);
const MAX_FILES = 20;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DEFAULT_GROUP_CODE = 'default';

type LeftTab = 'docs' | 'config' | 'recall';
type ViewMode = 'list' | 'card';
type DocKind = 'all' | 'ai' | 'data';
type StatusFilter =
  | 'all'
  | '学习完成'
  | '学习失败'
  | '学习中断'
  | '学习中'
  | '待审核';
type GroupFilter = 'all' | 'ungrouped' | string;
type LearnStatus =
  | '待审核'
  | '已驳回'
  | '学习中断'
  | '学习完成'
  | '学习失败'
  | '学习中'
  | '待学习';

function learnStatus(item: UserKnowledgeItem): LearnStatus {
  if (item.auditStatus === 'pending') return '待审核';
  if (item.auditStatus === 'rejected') return '已驳回';
  if (item.publishStatus === 'unpublished') return '学习中断';
  if (item.vectorStatus === 'ready') return '学习完成';
  if (item.vectorStatus === 'failed') return '学习失败';
  if (
    item.vectorStatus === 'processing' ||
    (item.publishStatus === 'published' && item.vectorStatus === 'pending')
  ) {
    return '学习中';
  }
  return '待学习';
}

function statusClass(status: LearnStatus) {
  switch (status) {
    case '学习完成':
      return 'ok';
    case '学习失败':
    case '已驳回':
      return 'fail';
    case '学习中断':
      return 'intr';
    case '学习中':
      return 'ing';
    case '待审核':
      return 'audit';
    default:
      return 'wait';
  }
}

function isDataDoc(item: UserKnowledgeItem) {
  const mime = (item.mimeType || '').toLowerCase();
  const name = (item.fileName || item.title || '').toLowerCase();
  const dataHints = [
    'pdf',
    'csv',
    'excel',
    'spreadsheet',
    'word',
    'msword',
    'officedocument',
    'opendocument',
  ];
  if (dataHints.some((h) => mime.includes(h))) return true;
  return /\.(pdf|csv|xlsx?|docx?|xls|doc)$/i.test(name);
}

function docKind(item: UserKnowledgeItem): 'ai' | 'data' {
  return isDataDoc(item) ? 'data' : 'ai';
}

function docKindLabel(kind: 'ai' | 'data') {
  return kind === 'data' ? '数据文档' : 'AI成果';
}

function formatBytes(bytes?: number | null) {
  if (bytes == null || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extOf(name: string) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isAllowedExt(name: string) {
  return ALLOWED_EXT.has(extOf(name));
}

function buildCodeFromFileName(fileName: string, suffix = '') {
  const base = fileName.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `kb-${slug || 'doc'}${suffix}-${Date.now().toString(36)}`.slice(0, 128);
}

function groupNameOf(
  code: string | null | undefined,
  groups: KnowledgeGroupOption[],
) {
  if (!code) return '未分组';
  return groups.find((g) => g.code === code)?.name || code;
}

export default function KnowledgeDetailPage({
  session,
}: {
  session: LoginResponse | null;
}) {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [lib, setLib] = useState<UserKnowledgeLibrary | null>(null);
  const [items, setItems] = useState<UserKnowledgeItem[]>([]);
  const [groups, setGroups] = useState<KnowledgeGroupOption[]>([]);
  const [groupDialog, setGroupDialog] = useState<{ mode: 'create' | 'rename' | 'delete'; group?: KnowledgeGroupOption } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [leftTab, setLeftTab] = useState<LeftTab>('docs');
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [kindFilter, setKindFilter] = useState<DocKind>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [keyword, setKeyword] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editItem, setEditItem] = useState<UserKnowledgeItem | null>(null);
  const [archiveItem, setArchiveItem] = useState<UserKnowledgeItem | null>(null);
  const [detailItem, setDetailItem] = useState<UserKnowledgeItem | null>(null);
  const [previewItem, setPreviewItem] = useState<UserKnowledgeItem | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  const addMenuRef = useRef<HTMLDivElement>(null);
  const rowMenuRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!session || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [detail, page, groupList] = await Promise.all([
        fetchKnowledgeLibraryDetail(id),
        fetchKnowledgeLibraryItems(id, { page: 1, pageSize: 100 }),
        fetchKnowledgeGroups(id),
      ]);
      setLib(detail);
      setItems(page.items);
      setGroups(groupList);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.accessToken, id]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (addMenuRef.current && !addMenuRef.current.contains(t)) {
        setAddMenuOpen(false);
      }
      if (rowMenuRef.current && !rowMenuRef.current.contains(t)) {
        setMenuItemId(null);
        setMenuPos(null);
      }
    }
    function onScrollOrResize() {
      setMenuItemId(null);
      setMenuPos(null);
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, []);

  function openRowMenu(item: UserKnowledgeItem, e: ReactMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 168;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      window.innerWidth - menuWidth - 8,
    );
    const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
    if (menuItemId === item.id) {
      setMenuItemId(null);
      setMenuPos(null);
      return;
    }
    setMenuItemId(item.id);
    setMenuPos({ top, left });
  }

  function closeRowMenu() {
    setMenuItemId(null);
    setMenuPos(null);
  }

  const menuItem = useMemo(
    () => (menuItemId ? items.find((i) => i.id === menuItemId) ?? null : null),
    [menuItemId, items],
  );

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    let ungrouped = 0;
    for (const item of items) {
      if (!item.groupCode) {
        ungrouped += 1;
        continue;
      }
      map.set(item.groupCode, (map.get(item.groupCode) || 0) + 1);
    }
    return { map, ungrouped, total: items.length };
  }, [items]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (groupFilter === 'ungrouped' && item.groupCode) return false;
      if (
        groupFilter !== 'all' &&
        groupFilter !== 'ungrouped' &&
        item.groupCode !== groupFilter
      ) {
        return false;
      }
      const kind = docKind(item);
      if (kindFilter !== 'all' && kind !== kindFilter) return false;
      const status = learnStatus(item);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.fileName || ''} ${item.code} ${(item.tags || [])
          .map((t) => t.name)
          .join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, groupFilter, kindFilter, statusFilter, keyword]);

  const stats = useMemo(() => {
    let ready = 0;
    let failed = 0;
    let interrupted = 0;
    for (const item of items) {
      const s = learnStatus(item);
      if (s === '学习完成') ready += 1;
      else if (s === '学习失败' || s === '已驳回') failed += 1;
      else if (s === '学习中断') interrupted += 1;
    }
    return { total: items.length, ready, failed, interrupted };
  }, [items]);

  async function handleDownload(item: UserKnowledgeItem) {
    try {
      await downloadKnowledgeItem(item.id, item.fileName || `${item.title}.bin`);
      setInfo(`已开始下载：${item.title}`);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function openSourceMeta(item: UserKnowledgeItem) {
    const meta = item.sourceMeta;
    window.alert(
      meta && Object.keys(meta).length
        ? JSON.stringify(meta, null, 2)
        : `来源类型：${item.sourceType || '未知'}\n暂无更多溯源信息`,
    );
  }

  const mark =
    (lib?.icon && [...lib.icon][0]) || (lib ? [...lib.name][0] : '知') || '知';

  return (
    <>
      {!session ? (
        <main className="kb-page">
          <div className="kb-gate">
            <strong>请先登录</strong>
            <button type="button" className="kb-primary-btn" onClick={() => navigate('/login')}>
              去登录
            </button>
          </div>
        </main>
      ) : loading ? (
        <main className="kbw-workspace">
          <div className="kbw-loading">加载中…</div>
        </main>
      ) : error && !lib ? (
        <main className="kbw-workspace">
          <div className="kb-error" style={{ margin: 24 }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        </main>
      ) : lib ? (
        <div className="kbw-workspace">
          {/* Left sidebar */}
          <aside className="kbw-left">
            <button
              type="button"
              className="kbw-back"
              onClick={() => navigate('/knowledge')}
            >
              ← 返回知识库
            </button>
            <div className="kbw-lib">
              <span
                className="kbw-lib-mark"
                style={{ background: lib.color || '#3b82f6' }}
              >
                {mark}
              </span>
              <div className="kbw-lib-meta">
                <strong title={lib.name}>{lib.name}</strong>
                <em className={lib.visibility === 'public' ? 'pub' : 'pri'}>
                  {lib.visibility === 'public' ? (
                    <>
                      <Globe2 size={11} /> 公共
                    </>
                  ) : (
                    <>
                      <Lock size={11} /> 私有
                    </>
                  )}
                </em>
              </div>
            </div>
            <nav className="kbw-left-nav" aria-label="知识库导航">
              <button
                type="button"
                className={leftTab === 'docs' ? 'active' : ''}
                onClick={() => setLeftTab('docs')}
              >
                <FileText size={15} /> 知识文档
              </button>
              <button
                type="button"
                className={leftTab === 'config' ? 'active' : ''}
                onClick={() => setLeftTab('config')}
              >
                <Settings2 size={15} /> 知识库配置
              </button>
              <button
                type="button"
                className={leftTab === 'recall' ? 'active' : ''}
                onClick={() => setLeftTab('recall')}
              >
                <Search size={15} /> 召回测试
              </button>
            </nav>
          </aside>

          {leftTab === 'docs' ? (
            <>
              {/* Middle group sidebar */}
              <aside className="kbw-mid">
                <header className="kbw-mid-head">
                  <strong>知识分组</strong>
                  <button
                    type="button"
                    className="kbw-icon-btn"
                    aria-label="添加分组"
                    onClick={() => setGroupDialog({ mode: 'create' })}
                  >
                    <Plus size={15} />
                  </button>
                </header>
                <ul className="kbw-group-list">
                  <li>
                    <button
                      type="button"
                      className={groupFilter === 'all' ? 'active' : ''}
                      onClick={() => setGroupFilter('all')}
                    >
                      <span>全部文档</span>
                      <em>{groupCounts.total}</em>
                    </button>
                  </li>
                  {groups.map((g) => (
                    <li key={g.code} className="kbw-group-row">
                      <button
                        type="button"
                        className={groupFilter === g.code ? 'active' : ''}
                        onClick={() => setGroupFilter(g.code)}
                      >
                        <span title={g.name}>{g.name}</span>
                        <em>{groupCounts.map.get(g.code) || 0}</em>
                      </button>
                      <button type="button" className="kbw-group-action" aria-label={`重命名分组：${g.name}`} title="重命名分组" onClick={() => setGroupDialog({ mode: 'rename', group: g })}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="kbw-group-action" aria-label={`删除分组：${g.name}`} title="删除分组" onClick={() => setGroupDialog({ mode: 'delete', group: g })}>
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className={groupFilter === 'ungrouped' ? 'active' : ''}
                      onClick={() => setGroupFilter('ungrouped')}
                    >
                      <span>未分组</span>
                      <em>{groupCounts.ungrouped}</em>
                    </button>
                  </li>
                </ul>
              </aside>

              {/* Main content */}
              <main className="kbw-main">
                <header className="kbw-main-head">
                  <h1>知识库文档</h1>
                  <div className="kbw-stats">
                    <span className="kbw-pill">文档 {stats.total}</span>
                    <span className="kbw-pill ok">学习完成 {stats.ready}</span>
                    <span className="kbw-pill fail">学习失败 {stats.failed}</span>
                    <span className="kbw-pill intr">学习中断 {stats.interrupted}</span>
                  </div>
                </header>

                <div className="kbw-toolbar">
                  <div className="kbw-view-toggle" role="group" aria-label="视图切换">
                    <button
                      type="button"
                      className={viewMode === 'list' ? 'active' : ''}
                      onClick={() => setViewMode('list')}
                    >
                      <List size={14} /> 列表
                    </button>
                    <button
                      type="button"
                      className={viewMode === 'card' ? 'active' : ''}
                      onClick={() => setViewMode('card')}
                    >
                      <LayoutGrid size={14} /> 卡片
                    </button>
                  </div>
                  <select
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value as DocKind)}
                    aria-label="文档类型"
                  >
                    <option value="all">全部类型</option>
                    <option value="ai">AI成果</option>
                    <option value="data">数据文档</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    aria-label="学习状态"
                  >
                    <option value="all">全部状态</option>
                    <option value="学习完成">学习完成</option>
                    <option value="学习失败">学习失败</option>
                    <option value="学习中断">学习中断</option>
                    <option value="学习中">学习中</option>
                    <option value="待审核">待审核</option>
                  </select>
                  <label className="kbw-search">
                    <Search size={14} />
                    <input
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="搜索文档名称 / 标签"
                    />
                  </label>
                  <div className="kbw-add-wrap" ref={addMenuRef}>
                    <button
                      type="button"
                      className="kb-primary-btn"
                      onClick={() => setAddMenuOpen((v) => !v)}
                    >
                      <Plus size={15} /> 添加内容
                    </button>
                    {addMenuOpen ? (
                      <div className="kbw-dropdown" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAddMenuOpen(false);
                            setUploadOpen(true);
                          }}
                        >
                          <UploadCloud size={14} /> 本地文档
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setAddMenuOpen(false);
                            setTextOpen(true);
                          }}
                        >
                          <FileText size={14} /> 自定义文档
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="kbw-tip">
                  <Info size={15} />
                  <span>
                    文档上传后会进入学习流程。状态为「学习完成」后即可被检索召回；失败可在详情中查看原因后重新上传。
                  </span>
                </div>

                {info ? <div className="kb-info">{info}</div> : null}
                {error ? (
                  <div className="kb-error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                  </div>
                ) : null}

                {filtered.length === 0 ? (
                  <div className="kbw-empty">
                    <strong>暂无文档</strong>
                    <p>点击右上角「添加内容」上传本地文件或创建自定义文档。</p>
                  </div>
                ) : viewMode === 'list' ? (
                  <div className="kbw-table-wrap">
                    <table className="kbw-table">
                      <thead>
                        <tr>
                          <th>文档名称</th>
                          <th>类型</th>
                          <th>分组</th>
                          <th>大小</th>
                          <th>分段</th>
                          <th>命中</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => {
                          const kind = docKind(item);
                          const status = learnStatus(item);
                          return (
                            <tr
                              key={item.id}
                              onClick={() => setDetailItem(item)}
                            >
                              <td>
                                <div className="kbw-name-cell">
                                  <span className={`kbw-doc-icon ${kind}`}>
                                    {kind === 'data' ? 'DOC' : <Bot size={14} />}
                                  </span>
                                  <div>
                                    <strong title={item.title}>{item.title}</strong>
                                    {item.tags && item.tags.length > 0 ? (
                                      <div className="kbw-tags">
                                        {item.tags.slice(0, 3).map((t) => (
                                          <span key={t.id}>{t.name}</span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td>{docKindLabel(kind)}</td>
                              <td>{groupNameOf(item.groupCode, groups)}</td>
                              <td>{formatBytes(item.fileSize)}</td>
                              <td>{item.chunkCount ?? 0}</td>
                              <td>{item.hitCount ?? 0}</td>
                              <td>
                                <span className={`kbw-status ${statusClass(status)}`}>
                                  {status}
                                </span>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                <div className="kbw-ops">
                                  <button
                                    type="button"
                                    className="kbw-link"
                                    onClick={() => setDetailItem(item)}
                                  >
                                    详情
                                  </button>
                                  <button
                                    type="button"
                                    className="kbw-icon-btn"
                                    aria-label="更多操作"
                                    aria-expanded={menuItemId === item.id}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onClick={(e) => openRowMenu(item, e)}
                                  >
                                    <MoreHorizontal size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="kbw-cards">
                    {filtered.map((item) => {
                      const kind = docKind(item);
                      const status = learnStatus(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="kbw-card"
                          onClick={() => setDetailItem(item)}
                        >
                          <div className="kbw-card-top">
                            <span className={`kbw-doc-icon ${kind}`}>
                              {kind === 'data' ? 'DOC' : <Bot size={14} />}
                            </span>
                            <span className={`kbw-status ${statusClass(status)}`}>
                              {status}
                            </span>
                          </div>
                          <strong className="kbw-card-title" title={item.title}>
                            {item.title}
                          </strong>
                          <div className="kbw-card-meta">
                            <span>{docKindLabel(kind)}</span>
                            <span>{groupNameOf(item.groupCode, groups)}</span>
                          </div>
                          <div className="kbw-card-foot">
                            <span>{formatBytes(item.fileSize)}</span>
                            <span>分段 {item.chunkCount ?? 0}</span>
                            <span>命中 {item.hitCount ?? 0}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </main>
            </>
          ) : leftTab === 'config' ? (
            <LibraryConfigPanel
              library={lib}
              onSaved={async (next, message) => {
                setLib(next);
                setInfo(message);
                setError('');
              }}
              onError={(message) => {
                setError(message);
                setInfo('');
              }}
            />
          ) : (
            <RecallTestPanel library={lib} />
          )}
        </div>
      ) : null}

      {groupDialog && lib ? (
        <KnowledgeGroupModal
          key={`${groupDialog.mode}-${groupDialog.group?.code ?? ''}`}
          libraryId={lib.id}
          mode={groupDialog.mode}
          group={groupDialog.group}
          onClose={() => setGroupDialog(null)}
          onDone={async (group, message) => {
            setGroupDialog(null);
            setInfo(message);
            if (groupDialog.mode === 'delete' && groupFilter === groupDialog.group?.code) setGroupFilter('ungrouped');
            else if (groupDialog.mode === 'create' && group) setGroupFilter(group.code);
            await load();
          }}
        />
      ) : null}

      {uploadOpen && lib ? (
        <UploadFilesModal
          library={lib}
          groups={groups}
          defaultGroup={groupFilter === 'ungrouped' ? '' : groupFilter !== 'all' ? groupFilter : groups.find((group) => group.code === DEFAULT_GROUP_CODE)?.code ?? ''}
          onClose={() => setUploadOpen(false)}
          onDone={async (message) => {
            setUploadOpen(false);
            setInfo(message);
            setError('');
            await load();
          }}
        />
      ) : null}

      {textOpen && lib ? (
        <CustomTextModal
          libraryId={lib.id}
          groups={groups}
          defaultGroup={groupFilter !== 'all' && groupFilter !== 'ungrouped' ? groupFilter : ''}
          onClose={() => setTextOpen(false)}
          onDone={async (message) => {
            setTextOpen(false);
            setInfo(message);
            setError('');
            await load();
          }}
        />
      ) : null}

      {editItem ? (
        <EditItemModal
          item={editItem}
          groups={groups}
          onClose={() => setEditItem(null)}
          onDone={async (message) => {
            setEditItem(null);
            setInfo(message);
            setError('');
            await load();
          }}
        />
      ) : null}

      {archiveItem ? (
        <ArchiveConfirmModal
          item={archiveItem}
          onClose={() => setArchiveItem(null)}
          onDone={async (message) => {
            setArchiveItem(null);
            setDetailItem(null);
            setInfo(message);
            setError('');
            await load();
          }}
        />
      ) : null}

      {detailItem ? (
        <DetailDrawer
          item={detailItem}
          groups={groups}
          onClose={() => setDetailItem(null)}
          onDownload={() => void handleDownload(detailItem)}
        />
      ) : null}

      {previewItem ? (
        <FilePreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      ) : null}

      {menuItem && menuPos
        ? createPortal(
            <div
              ref={rowMenuRef}
              className="kbw-popover"
              role="menu"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  setPreviewItem(menuItem);
                }}
              >
                <Eye size={14} /> 预览
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  void handleDownload(menuItem);
                }}
              >
                <Download size={14} /> 下载
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  setEditItem(menuItem);
                }}
              >
                <Pencil size={14} /> 编辑
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  setEditItem(menuItem);
                }}
              >
                <FolderInput size={14} /> 移动分组
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  openSourceMeta(menuItem);
                }}
              >
                <Link2 size={14} /> 溯源
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  closeRowMenu();
                  setArchiveItem(menuItem);
                }}
              >
                <Archive size={14} /> 归档
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function KnowledgeGroupModal({ libraryId, mode, group, onClose, onDone }: {
  libraryId: string;
  mode: 'create' | 'rename' | 'delete';
  group?: KnowledgeGroupOption;
  onClose: () => void;
  onDone: (group: KnowledgeGroupOption | null, message: string) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const deleting = mode === 'delete';
  const title = deleting ? '删除分组' : mode === 'create' ? '新增分组' : '重命名分组';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || (!deleting && !name.trim())) return;
    setSaving(true);
    setError('');
    try {
      if (deleting && group) {
        const result = await deleteKnowledgeGroup(libraryId, group.code);
        await onDone(null, `分组已删除，${result.movedCount} 篇文档已移至未分组`);
      } else {
        const saved = await saveKnowledgeGroup(libraryId, name.trim(), group?.code);
        await onDone(saved, mode === 'create' ? '分组已创建' : '分组名称已更新');
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={() => !saving && onClose()}>
      <section className="kb-modal" role="dialog" aria-modal="true" aria-labelledby="kb-group-title" onClick={(event) => event.stopPropagation()}>
        <header className="kb-modal-head">
          <h2 id="kb-group-title">{title}</h2>
          <button type="button" className="kb-modal-close" disabled={saving} onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <form className="kb-modal-body" onSubmit={(event) => void submit(event)}>
          {deleting ? (
            <p className="kbw-group-delete-tip">确定删除“{group?.name}”？该分组中的文档将移至“未分组”，文件和学习结果会保留。</p>
          ) : (
            <label><span>分组名称</span><input autoFocus required maxLength={64} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} placeholder="请输入分组名称" /></label>
          )}
          {error && <div className="kb-error" role="alert">{error}</div>}
          <footer className="kb-modal-foot">
            <button type="button" className="kb-secondary-btn" disabled={saving} onClick={onClose}>取消</button>
            <button type="submit" className="kb-primary-btn" disabled={saving || (!deleting && !name.trim())}>{saving ? '处理中…' : deleting ? '确认删除' : '保存'}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function LibraryConfigPanel({
  library,
  onSaved,
  onError,
}: {
  library: UserKnowledgeLibrary;
  onSaved: (lib: UserKnowledgeLibrary, message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(library.name);
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(
    library.visibility,
  );
  const [intro, setIntro] = useState(library.intro ?? '');
  const [chunkMethod, setChunkMethod] = useState(library.chunkMethod || 'smart');
  const [chunkSize, setChunkSize] = useState(library.chunkSize ?? 800);
  const [chunkOverlap, setChunkOverlap] = useState(library.chunkOverlap ?? 120);
  const [recallTopK, setRecallTopK] = useState(library.recallTopK ?? 8);
  const [similarityThreshold, setSimilarityThreshold] = useState(
    library.similarityThreshold ?? 0.6,
  );
  const [hybridSemantic, setHybridSemantic] = useState(
    library.hybridSemanticWeight ?? 0.7,
  );
  const [hybridKeyword, setHybridKeyword] = useState(
    library.hybridKeywordWeight ?? 0.3,
  );
  const [saving, setSaving] = useState(false);
  const systemEmbeddingModel =
    library.embeddingModel?.trim() || '系统未配置';

  useEffect(() => {
    setName(library.name);
    setVisibility(library.visibility);
    setIntro(library.intro ?? '');
    setChunkMethod(library.chunkMethod || 'smart');
    setChunkSize(library.chunkSize ?? 800);
    setChunkOverlap(library.chunkOverlap ?? 120);
    setRecallTopK(library.recallTopK ?? 8);
    setSimilarityThreshold(library.similarityThreshold ?? 0.6);
    setHybridSemantic(library.hybridSemanticWeight ?? 0.7);
    setHybridKeyword(library.hybridKeywordWeight ?? 0.3);
  }, [library]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onError('请填写知识库名称');
      return;
    }
    setSaving(true);
    try {
      const next = await updateKnowledgeLibrary(library.id, {
        name: name.trim(),
        visibility,
        intro: intro.trim() || null,
        chunkMethod,
        chunkSize: Number(chunkSize),
        chunkOverlap: Number(chunkOverlap),
        recallTopK: Number(recallTopK),
        similarityThreshold: Number(similarityThreshold),
        hybridSemanticWeight: Number(hybridSemantic),
        hybridKeywordWeight: Number(hybridKeyword),
      });
      await onSaved(next, '配置已保存');
    } catch (err) {
      onError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="kbw-main kbw-config">
      <header className="kbw-main-head">
        <h1>知识库配置</h1>
        <p>配置知识库的基础信息、向量化参数与检索策略，保存后立即生效。</p>
      </header>

      <form className="kbw-config-form" onSubmit={(e) => void handleSave(e)}>
        <section className="kbw-cfg-card">
          <h2>
            <Settings2 size={15} /> 基础信息
          </h2>
          <label className="kbw-field">
            <span>知识库名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              required
            />
          </label>
          <div className="kbw-field">
            <span>可见性</span>
            <div className="kbw-radio-row" role="radiogroup" aria-label="可见性">
              <label className={visibility === 'private' ? 'on' : ''}>
                <input
                  type="radio"
                  name="kb-vis"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                私有
              </label>
              <label className={visibility === 'public' ? 'on' : ''}>
                <input
                  type="radio"
                  name="kb-vis"
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                公共
              </label>
            </div>
          </div>
          <label className="kbw-field">
            <span>简介</span>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              maxLength={1024}
              placeholder="简要描述知识库用途"
            />
          </label>
          <button type="submit" className="kb-primary-btn" disabled={saving}>
            {saving ? '保存中…' : '保存配置'}
          </button>
        </section>

        <section className="kbw-cfg-card">
          <h2>
            <Sparkles size={15} /> 向量化设置
          </h2>
          <div className="kbw-cfg-grid">
            <label className="kbw-field">
              <span>分段方式</span>
              <select
                value={chunkMethod}
                onChange={(e) => setChunkMethod(e.target.value)}
              >
                <option value="smart">智能分段</option>
                <option value="fixed">固定长度</option>
              </select>
            </label>
            <label className="kbw-field">
              <span>分段长度</span>
              <input
                type="number"
                min={100}
                max={4000}
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
              />
            </label>
            <label className="kbw-field">
              <span>重叠长度</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={chunkOverlap}
                onChange={(e) => setChunkOverlap(Number(e.target.value))}
              />
            </label>
            <label className="kbw-field">
              <span>向量模型</span>
              <input
                value={systemEmbeddingModel}
                readOnly
                disabled
                title="由系统 EMBEDDING_MODEL 配置决定"
              />
              <em className="kbw-field-hint">由系统配置决定，不可在此修改</em>
            </label>
          </div>
        </section>

        <section className="kbw-cfg-card">
          <h2>
            <Search size={15} /> 检索参数
          </h2>
          <div className="kbw-cfg-grid">
            <label className="kbw-field">
              <span>召回条数 TopK</span>
              <input
                type="number"
                min={1}
                max={50}
                value={recallTopK}
                onChange={(e) => setRecallTopK(Number(e.target.value))}
              />
            </label>
            <label className="kbw-field">
              <span>相似度阈值</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={similarityThreshold}
                onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
              />
            </label>
            <label className="kbw-field kbw-field-span">
              <span>混合检索权重（语义 : 关键词）</span>
              <div className="kbw-hybrid-row">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={hybridSemantic}
                  onChange={(e) => setHybridSemantic(Number(e.target.value))}
                  aria-label="语义权重"
                />
                <em>:</em>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={hybridKeyword}
                  onChange={(e) => setHybridKeyword(Number(e.target.value))}
                  aria-label="关键词权重"
                />
              </div>
            </label>
          </div>
        </section>
      </form>
    </main>
  );
}

function RecallTestPanel({ library }: { library: UserKnowledgeLibrary }) {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hits, setHits] = useState<KnowledgeRecallHit[] | null>(null);

  async function handleTest(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setError('请输入测试问题');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await recallTestKnowledgeLibrary(library.id, {
        query: query.trim(),
        topK,
      });
      setHits(rows);
    } catch (err) {
      setHits(null);
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="kbw-recall">
      <aside className="kbw-recall-form">
        <header className="kbw-main-head">
          <h1>召回测试</h1>
          <p>输入测试问题，验证该知识库的检索召回质量（命中片段与相关性相似度）。</p>
        </header>
        <form onSubmit={(e) => void handleTest(e)}>
          <label className="kbw-field">
            <span>测试问题</span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={8}
              placeholder="如：2025 年中国 GDP 增速是多少？"
            />
          </label>
          <label className="kbw-field">
            <span>召回条数</span>
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
            >
              {[3, 5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="kbw-inline-err">{error}</p> : null}
          <button type="submit" className="kb-primary-btn" disabled={loading}>
            <Search size={15} />
            {loading ? '测试中…' : '开始测试'}
          </button>
        </form>
      </aside>
      <section className="kbw-recall-result" aria-live="polite">
        {hits == null ? (
          <p className="kbw-recall-empty">
            输入测试问题并点击「开始测试」，这里将展示召回片段与相似度。
          </p>
        ) : hits.length === 0 ? (
          <p className="kbw-recall-empty">未召回到符合阈值的片段，可调低相似度阈值或检查文档是否已学习完成。</p>
        ) : (
          <ul className="kbw-recall-list">
            {hits.map((hit, idx) => (
              <li key={`${hit.chunkId}-${idx}`} className="kbw-recall-item">
                <header>
                  <strong>
                    #{idx + 1} {hit.title}
                  </strong>
                  <em>相似度 {(hit.score * 100).toFixed(1)}%</em>
                </header>
                <p>{hit.content}</p>
                <footer>
                  <span>分段 #{hit.chunkIndex + 1}</span>
                  {hit.pageNumber != null ? <span>页 {hit.pageNumber}</span> : null}
                  {hit.section ? <span>{hit.section}</span> : null}
                </footer>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UploadFilesModal({
  library,
  groups,
  defaultGroup,
  onClose,
  onDone,
}: {
  library: UserKnowledgeLibrary;
  groups: KnowledgeGroupOption[];
  defaultGroup: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [groupCode, setGroupCode] = useState(defaultGroup);
  const [summary, setSummary] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const isPublic = library.visibility === 'public';
  const single = files.length <= 1;
  const canSubmit = files.length > 0 && !submitting;

  const propertyLabel = useMemo(
    () => (isPublic ? '公用知识库（需审核）' : '私有知识库（免审核）'),
    [isPublic],
  );

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const next = [...files];
    const messages: string[] = [];
    for (const file of incoming) {
      if (next.length >= MAX_FILES) {
        messages.push(`一次最多上传 ${MAX_FILES} 个文件`);
        break;
      }
      if (!isAllowedExt(file.name)) {
        messages.push(`${file.name} 格式不支持`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        messages.push(`${file.name} 超过 20MB`);
        continue;
      }
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }
    setFiles(next);
    if (next.length === 1) {
      setTitle(next[0]!.name);
      setCode(buildCodeFromFileName(next[0]!.name));
    } else if (next.length > 1) {
      setTitle('');
      setCode('');
    } else {
      setTitle('');
      setCode('');
    }
    if (messages.length) setError(messages[0]!);
    else setError('');
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    if (next.length === 1) {
      setTitle(next[0]!.name);
      setCode(buildCodeFromFileName(next[0]!.name));
    } else if (next.length === 0) {
      setTitle('');
      setCode('');
    } else {
      setTitle('');
      setCode('');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    let ok = 0;
    const failed: string[] = [];
    try {
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        setProgress(`正在上传 ${i + 1}/${files.length}：${file.name}`);
        try {
          await uploadKnowledgeFile({
            libraryId: library.id,
            file,
            groupCode,
            title: single ? title.trim() || file.name : file.name,
            code: single
              ? code.trim() || undefined
              : buildCodeFromFileName(file.name, `-${i.toString(36)}`),
            summary: summary.trim() || undefined,
          });
          ok += 1;
        } catch (err) {
          failed.push(`${file.name}（${apiErrorMessage(err)}）`);
        }
      }
      if (ok === 0) {
        setError(failed[0] || '上传失败');
        return;
      }
      const msg =
        failed.length === 0
          ? isPublic
            ? `已上传 ${ok} 个文件并提交公开审核`
            : `已上传 ${ok} 个文件（私有知识库无需审核）`
          : `成功 ${ok} 个，失败 ${failed.length} 个`;
      await onDone(msg);
    } finally {
      setSubmitting(false);
      setProgress('');
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        className="kb-modal kb-upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-upload-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2 id="kb-upload-title">上传文件</h2>
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

        <form className="kb-modal-body" onSubmit={(e) => void submit(e)}>
          <div className="kb-upload-field">
            <span className="kb-required-label">
              <em>*</em> 知识文件
            </span>
            <div
              className={`kb-dropzone ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud size={28} />
              <strong>点击或拖拽文件到此处上传</strong>
              <p>
                支持同时选择多个文件（最多 {MAX_FILES} 个）；PDF / CSV / XLS / XLSX /
                DOC / DOCX / TXT / MD / HTML / JSON，单个最大 20MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                multiple
                hidden
                disabled={submitting}
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {files.length > 0 ? (
              <ul className="kb-file-chips">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      type="button"
                      disabled={submitting}
                      aria-label={`移除 ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <small className="kb-upload-extra">
              {progress ||
                (isPublic
                  ? '可一次选择多个文件；当前为公用知识库，上传后自动审核并学习'
                  : '可一次选择多个文件；当前为私有知识库，上传后无需审核')}
            </small>
          </div>

          {single ? (
            <div className="kb-upload-grid">
              <label>
                <span>标题</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="默认使用文件名"
                  disabled={submitting}
                />
              </label>
              <label>
                <span>编码</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="可自动生成"
                  disabled={submitting}
                />
              </label>
            </div>
          ) : (
            <label className="kb-upload-full">
              <span>标题 / 编码</span>
              <input
                disabled
                value={`已选 ${files.length} 个文件，将分别使用文件名作为标题并自动生成编码`}
              />
            </label>
          )}

          <div className="kb-upload-grid">
            <label>
              <span>知识分组</span>
              <select
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                disabled={submitting}
              >
                <option value="">请选择分组</option>
                {groups.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>知识库属性</span>
              <input value={propertyLabel} disabled />
            </label>
          </div>

          <label className="kb-upload-full">
            <span>摘要</span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="可选"
              rows={3}
              disabled={submitting}
            />
          </label>

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
            <button type="submit" className="kb-primary-btn" disabled={!canSubmit}>
              {submitting
                ? '上传中…'
                : files.length > 1
                  ? isPublic
                    ? `上传并提交审核（${files.length}）`
                    : `上传（${files.length}）`
                  : isPublic
                    ? '上传并提交审核'
                    : '上传'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function CustomTextModal({
  libraryId,
  groups,
  defaultGroup,
  onClose,
  onDone,
}: {
  libraryId: string;
  groups: KnowledgeGroupOption[];
  defaultGroup: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [groupCode, setGroupCode] = useState(defaultGroup);
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const tagList = tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await createTextKnowledge({
        libraryId,
        title: title.trim(),
        content: content.trim(),
        groupCode,
        tags: tagList.length ? tagList : undefined,
      });
      await onDone('自定义文档已创建');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        className="kb-modal kb-upload-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2>自定义文档</h2>
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
        <form className="kb-modal-body" onSubmit={(e) => void submit(e)}>
          <label className="kb-upload-full">
            <span className="kb-required-label">
              <em>*</em> 标题
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文档标题"
              disabled={submitting}
              required
            />
          </label>
          <label className="kb-upload-full">
            <span className="kb-required-label">
              <em>*</em> 内容
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入文档正文"
              rows={8}
              disabled={submitting}
              required
            />
          </label>
          <div className="kb-upload-grid">
            <label>
              <span>知识分组</span>
              <select
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
                disabled={submitting}
              >
                <option value="">未分组</option>
                {groups.map((g) => (
                  <option key={g.code} value={g.code}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>标签</span>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="逗号分隔"
                disabled={submitting}
              />
            </label>
          </div>
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
              disabled={submitting || !title.trim() || !content.trim()}
            >
              {submitting ? '创建中…' : '创建'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function EditItemModal({
  item,
  groups,
  onClose,
  onDone,
}: {
  item: UserKnowledgeItem;
  groups: KnowledgeGroupOption[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [tags, setTags] = useState((item.tags || []).map((t) => t.name).join(', '));
  const [groupCode, setGroupCode] = useState(item.groupCode || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const tagList = tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await updateKnowledgeItem(item.id, {
        title: title.trim(),
        tags: tagList,
        groupCode: groupCode || null,
      });
      await onDone('文档已更新');
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        className="kb-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2>编辑文档</h2>
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
        <form className="kb-modal-body" onSubmit={(e) => void submit(e)}>
          <label className="kb-upload-full">
            <span>标题</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              required
            />
          </label>
          <label className="kb-upload-full">
            <span>标签（逗号分隔）</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="如：报告, 季度"
              disabled={submitting}
            />
          </label>
          <label className="kb-upload-full">
            <span>知识分组</span>
            <select
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              disabled={submitting}
            >
              <option value="">未分组</option>
              {groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
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
              disabled={submitting || !title.trim()}
            >
              {submitting ? '保存中…' : '保存'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function ArchiveConfirmModal({
  item,
  onClose,
  onDone,
}: {
  item: UserKnowledgeItem;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await archiveKnowledgeItem(item.id);
      await onDone(`已归档：${item.title}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={() => !submitting && onClose()}>
      <div
        className="kb-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2>确认归档</h2>
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
        <div className="kb-modal-body">
          <p style={{ margin: 0, color: '#415777', fontSize: 13, lineHeight: 1.6 }}>
            归档「{item.title}」后将从知识库中删除，无法再被检索，且不可恢复。
          </p>
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
              type="button"
              className="kb-primary-btn"
              disabled={submitting}
              onClick={() => void confirm()}
            >
              {submitting ? '归档中…' : '确认归档'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

function buildVersionHistory(item: UserKnowledgeItem) {
  const rows: { at: string; text: string }[] = [];
  const pending = item.auditStatus === 'pending';
  rows.push({
    at: item.createdAt,
    text: pending ? '提交入库 (待审核)' : '提交入库',
  });
  if (item.auditedAt) {
    const who =
      item.auditor?.displayName ||
      item.auditor?.username ||
      '';
    rows.push({
      at: item.auditedAt,
      text: who ? `管理端审核通过 (${who})` : '管理端审核通过',
    });
  } else if (item.auditStatus === 'rejected') {
    rows.push({
      at: item.updatedAt,
      text: item.rejectReason
        ? `审核驳回：${item.rejectReason}`
        : '审核驳回',
    });
  }
  if (item.vectorStatus === 'ready') {
    rows.push({
      at: item.vectorSyncedAt || item.updatedAt,
      text: '完成向量学习，参与检索',
    });
  } else if (item.vectorStatus === 'failed') {
    rows.push({
      at: item.updatedAt,
      text: item.vectorError
        ? `向量学习失败：${item.vectorError}`
        : '向量学习失败',
    });
  } else if (
    item.vectorStatus === 'processing' ||
    item.vectorStatus === 'pending'
  ) {
    rows.push({
      at: item.updatedAt,
      text: '向量学习中…',
    });
  }
  return rows;
}

function formatSourceBlock(item: UserKnowledgeItem): {
  sources: string;
  task: string;
} {
  const meta = (item.sourceMeta || {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = meta[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (Array.isArray(v) && v.length) {
        return v.map(String).filter(Boolean).join(' · ');
      }
    }
    return '';
  };
  const channelMap: Record<string, string> = {
    user_upload: '本地上传',
    user_custom_text: '自定义文本',
    research_deposit: '研究来源存入',
    research_upload: '研究上传',
  };
  const channel = pick('uploadChannel');
  const sources =
    pick('sources', 'sourceNames', 'sourceLabel', 'sourceName') ||
    (channel ? channelMap[channel] || channel : '') ||
    (item.sourceType === 'research_upload' ? '研究上传' : '用户上传');
  const taskId = pick('taskId', 'taskCode', 'researchRunId', 'runId');
  const author =
    item.submitter?.displayName ||
    item.submitter?.username ||
    pick('author', 'authorName');
  const taskParts = [
    taskId ? `任务：${taskId}` : '',
    author ? `作者：${author}` : '',
  ].filter(Boolean);
  return {
    sources,
    task: taskParts.join(' · ') || '—',
  };
}

function DetailDrawer({
  item,
  groups,
  onClose,
  onDownload,
}: {
  item: UserKnowledgeItem;
  groups: KnowledgeGroupOption[];
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = docKind(item);
  const status = learnStatus(item);
  const source = formatSourceBlock(item);
  const history = buildVersionHistory(item);

  function stop(e: ReactMouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className="kbw-drawer-mask" role="presentation" onClick={onClose}>
      <aside
        className="kbw-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="文档详情"
        onClick={stop}
      >
        <header className="kbw-drawer-head kbw-drawer-head-title">
          <strong>文档详情</strong>
          <button
            type="button"
            className="kb-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <div className="kbw-drawer-body">
          <section className="kbw-drawer-sec">
            <span>文档名称</span>
            <strong className="kbw-drawer-title" title={item.title}>
              {item.title}
            </strong>
          </section>

          <section className="kbw-drawer-sec">
            <span>类型 / 分组</span>
            <div className="kbw-drawer-pills">
              <em className="kind">{docKindLabel(kind)}</em>
              <em className="group">{groupNameOf(item.groupCode, groups)}</em>
            </div>
          </section>

          <section className="kbw-drawer-sec">
            <span>学习状态</span>
            <em className={`kbw-drawer-status ${statusClass(status)}`}>
              {status}
            </em>
          </section>

          <section className="kbw-drawer-sec">
            <span>基本信息</span>
            <p className="kbw-drawer-line">
              大小：{formatBytes(item.fileSize)} · 分段：{item.chunkCount ?? 0}{' '}
              段 · 命中：{item.hitCount ?? 0} 次
            </p>
          </section>

          <section className="kbw-drawer-sec">
            <span>来源 / 检索任务</span>
            <p className="kbw-drawer-line">{source.sources}</p>
            <p className="kbw-drawer-line muted">{source.task}</p>
          </section>

          <section className="kbw-drawer-sec">
            <span>标签</span>
            {item.tags && item.tags.length > 0 ? (
              <div className="kbw-drawer-pills tags">
                {item.tags.map((t) => (
                  <em key={t.id}>{t.name}</em>
                ))}
              </div>
            ) : (
              <em className="kbw-muted">暂无标签</em>
            )}
          </section>

          <section className="kbw-drawer-sec">
            <span>版本历史</span>
            {history.length ? (
              <ul className="kbw-drawer-history">
                {history.map((row) => (
                  <li key={`${row.at}-${row.text}`}>
                    {formatDate(row.at)} {row.text}
                  </li>
                ))}
              </ul>
            ) : (
              <em className="kbw-muted">暂无版本记录</em>
            )}
          </section>
        </div>

        <footer className="kbw-drawer-foot">
          <button type="button" className="kb-secondary-btn" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="kb-primary-btn" onClick={onDownload}>
            下载
          </button>
        </footer>
      </aside>
    </div>
  );
}

function FilePreviewModal({
  item,
  onClose,
}: {
  item: UserKnowledgeItem;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<KnowledgeFilePreview | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PREVIEW_REQUEST_TIMEOUT_MS);

    async function load() {
      setLoading(true);
      setError('');
      setPreview(null);
      setPdfUrl(null);
      try {
        if (!item.fileName && (item.summary || item.content)) {
          if (cancelled) return;
          setPreview({
            kind: 'document',
            fileName: item.title,
            text: [item.summary, item.content].filter(Boolean).join('\n\n'),
            truncated: false,
          });
          return;
        }
        const result = await fetchKnowledgeItemPreview(item.id, controller.signal);
        if (cancelled) return;
        setPreview(result);
        if (result.kind === 'pdf') {
          const blob = await fetchKnowledgeItemFileBlob(item.id, controller.signal);
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPdfUrl(objectUrl);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            timedOut
              ? '加载预览耗时过长，已自动停止。请重新预览。'
              : apiErrorMessage(err),
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item, previewAttempt]);

  function stop(e: ReactMouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className="kbw-drawer-mask" role="presentation" onClick={onClose}>
      <div
        className="kbw-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="文档预览"
        onClick={stop}
      >
        <header>
          <div>
            <strong>文档预览</strong>
            <p title={item.title}>{item.title}</p>
          </div>
          <button
            type="button"
            className="kb-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <div className="kbw-preview-body">
          {loading ? <p className="kbw-muted">正在加载预览…</p> : null}
          {!loading && error ? (
            <div className="kbw-preview-error" role="alert">
              <p className="kbw-inline-err">{error}</p>
              <button
                type="button"
                className="kb-secondary-btn"
                onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
              >
                <RotateCcw size={15} /> 重新预览
              </button>
            </div>
          ) : null}
          {!loading && !error && preview?.kind === 'pdf' && pdfUrl ? (
            <iframe title={item.title} src={pdfUrl} />
          ) : null}
          {!loading && !error && preview?.kind === 'document' ? (
            <article className="kbw-markdown-preview">
              {preview.text.trim()
                ? renderMarkdown(preview.text)
                : <p>暂无可预览内容</p>}
            </article>
          ) : null}
          {!loading && !error && preview?.kind === 'html' && preview.html.trim() ? (
            <iframe
              className="kbw-html-preview"
              title={item.title}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={preview.html}
            />
          ) : null}
          {!loading && !error && preview?.kind === 'html' && !preview.html.trim() ? (
            <p className="kbw-muted">暂无可预览内容</p>
          ) : null}
          {!loading && !error && preview?.kind === 'spreadsheet' ? (
            <div className="kbw-preview-sheet">
              <p>
                工作表：{preview.sheetName || '未命名'} · {preview.totalRows} 行
                × {preview.totalColumns} 列
                {preview.truncated ? ' · 仅展示部分数据' : ''}
              </p>
              <div className="kbw-preview-sheet-scroll">
                <table>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {!loading && !error && !preview ? (
            <p className="kbw-muted">暂无可预览内容</p>
          ) : null}
        </div>
        <footer>
          <button type="button" className="kb-secondary-btn" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
