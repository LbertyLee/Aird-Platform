import {
  AppstoreOutlined,
  DownloadOutlined,
  FileOutlined,
  LeftOutlined,
  MoreOutlined,
  RightOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Breadcrumb,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
  message,
  type MenuProps,
  type UploadFile,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  fetchDictionaries,
  fetchKnowledgeItemFile,
  fetchKnowledgeItemChunks,
  fetchKnowledgeItemPreview,
  fetchKnowledgeItems,
  fetchKnowledgeItemStatistics,
  fetchKnowledgeLibraryDetail,
  relearnKnowledgeItem,
  uploadKnowledgeFile,
  type DatasetFilePreview,
  type KnowledgeItem,
  type KnowledgeItemBucket,
  type KnowledgeLibraryItem,
  type KnowledgeChunk,
} from '../api/admin';
import { DatasetHtmlPreviewFrame } from '../components/DatasetHtmlPreviewFrame';
import {
  FORM_MODAL_WIDTH_LG,
  PREVIEW_MODAL_WIDTH,
  withFormModal,
} from '../components/form-modal';
import { useSessionStore } from '../stores/session';
import { useTableScrollY } from '../hooks/useTableScrollY';
import { KNOWLEDGE_GROUP_DICT_TYPE, DEFAULT_KNOWLEDGE_GROUP_CODE } from './kb-library/constants';
import './kb-library/kb-library.css';

const KNOWLEDGE_FILE_ACCEPT = '.pdf,.csv,.xls,.xlsx,.doc,.docx,.txt,.md,.markdown,.html,.htm,.json';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const STATUS_COLOR: Record<string, string> = {
  学习完成: 'success',
  学习失败: 'error',
  学习中断: 'warning',
  待审核: 'warning',
  待学习: 'default',
  学习中: 'processing',
};

const SOURCE_COLOR: Record<string, string> = {
  用户上传: 'warning',
  AI生成: 'success',
  联网搜索: 'blue',
  系统采集: 'default',
  管理端创建: 'default',
  研究端上传: 'warning',
};

function excelColumnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type DocRow = {
  id: string;
  name: string;
  icon: string;
  seg: string;
  hit: number;
  hitToday: number;
  status: string;
  size: string;
  group: string;
  groupCode?: string | null;
  time: string;
  author: string;
  tags: string[];
  src: string;
  sourceType: string;
  preview: string;
  history: string[];
  raw: KnowledgeItem;
};

function buildCodeFromFileName(fileName: string, salt = ''): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const normalized = base
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const stamp = `${Date.now().toString(36)}${salt}`;
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `kb-${normalized || 'doc'}-${stamp}-${random}`;
}

function isKnowledgeCodeExistsError(error: unknown): boolean {
  const response = (error as { response?: { data?: { code?: string } } })?.response;
  return response?.data?.code === 'KNOWLEDGE_CODE_EXISTS';
}

function fileIcon(name?: string | null): string {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'PDF';
  if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv')) return 'XLS';
  if (n.endsWith('.doc') || n.endsWith('.docx')) return 'DOC';
  return 'DOC';
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapStatus(
  item: Pick<
    KnowledgeItem,
    'auditStatus' | 'vectorStatus' | 'publishStatus'
  >,
  libraryVisibility?: string | null,
): string {
  const isPrivateLibrary = libraryVisibility === 'private';
  // 公用库未过审：明确「待审核」，勿显示成学习中
  if (item.auditStatus === 'pending') {
    return isPrivateLibrary ? '待学习' : '待审核';
  }
  if (item.auditStatus === 'rejected') return '学习失败';
  if (item.vectorStatus === 'failed') return '学习失败';
  if (item.vectorStatus === 'ready') return '学习完成';
  if (item.vectorStatus === 'processing') return '学习中';
  // 已发布但尚未向量化完成
  if (item.publishStatus === 'published') return '学习中';
  // 已过审未发布 / 未入队
  if (item.auditStatus === 'approved') return '待学习';
  return isPrivateLibrary ? '待学习' : '待审核';
}

function mapSource(item: KnowledgeItem): string {
  if (item.sourceType === 'research_upload') return '用户上传';
  if (item.sourceType === 'admin') return '管理端创建';
  return '系统采集';
}

function docTypeLabel(row: DocRow): string {
  const name = row.name.toLowerCase();
  if (name.includes('.pdf')) return 'PDF 文档';
  if (name.includes('.xls') || name.includes('.csv')) return 'Excel 数据';
  if (name.includes('.doc')) return 'Word 文档';
  return '文档';
}

function resolveItemGroupCode(item: KnowledgeItem): string | null {
  if (item.groupCode) return item.groupCode;
  if (item.sourceType === 'research_upload') return DEFAULT_KNOWLEDGE_GROUP_CODE;
  return null;
}

function toDocRow(
  item: KnowledgeItem,
  groupNameMap: Map<string, string>,
  libraryVisibility?: string | null,
): DocRow {
  const name = item.fileName || item.title;
  const groupCode = resolveItemGroupCode(item);
  return {
    id: item.id,
    name,
    icon: fileIcon(name),
    seg: item.chunkCount > 0 ? `${item.chunkCount} 段` : '待分段',
    hit: item.hitCount ?? 0,
    hitToday: 0,
    status: mapStatus(item, libraryVisibility),
    size: formatBytes(item.fileSize),
    group: groupCode
      ? groupNameMap.get(groupCode) || groupCode
      : '未分组',
    groupCode,
    time: formatTime(item.updatedAt),
    author:
      item.submitter?.displayName || item.submitter?.username || '—',
    tags: (item.tags || []).map((t) => t.name),
    src: item.summary || '—',
    sourceType: mapSource(item),
    preview: item.content || item.summary || '',
    history: [],
    raw: item,
  };
}

/**
 * 知识库详情：文档列表、上传入口、预览。
 */
export function KnowledgeLibraryDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const idFromUrl =
    location.pathname.replace(/\/+$/, '') === '/knowledge/library-detail'
      ? params.get('id') || ''
      : '';
  /** KeepAlive 切页签时 URL 可能短暂丢 query，用上次有效 id 兜底 */
  const [cachedLibraryId, setCachedLibraryId] = useState(idFromUrl);
  const libraryId = idFromUrl || cachedLibraryId;
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:knowledge:item:create');
  const canUpload = hasPermission('button:knowledge:item:upload');
  const canDelete = hasPermission('button:knowledge:item:delete');
  const canRelearn = hasPermission('button:knowledge:item:publish');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [relearningId, setRelearningId] = useState<string | null>(null);

  const [lib, setLib] = useState<KnowledgeLibraryItem | null>(null);
  const [buckets, setBuckets] = useState<KnowledgeItemBucket[]>([]);
  const [paging, setPaging] = useState({ scope: '', page: 1, pageSize: 20 });
  const [total, setTotal] = useState(0);
  const requestId = useRef(0);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupDefs, setGroupDefs] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [groupCollapsed, setGroupCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1440,
  );
  const [activeGroup, setActiveGroup] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [searchKey, setSearchKey] = useState('');
  const [keyword, setKeyword] = useState('');
  const scope = JSON.stringify([libraryId, keyword, activeGroup]);
  const page = paging.scope === scope ? paging.page : 1;
  const pageSize = paging.pageSize;
  const [detailRow, setDetailRow] = useState<DocRow | null>(null);
  const [detailChunks, setDetailChunks] = useState<KnowledgeChunk[]>([]);
  const [detailChunksLoading, setDetailChunksLoading] = useState(false);
  const [previewRow, setPreviewRow] = useState<DocRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<DatasetFilePreview | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY(56);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Prevent duplicate create requests when Modal onOk is triggered rapidly.
  const uploadInFlightRef = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploadForm] = Form.useForm();
  const [uploadProgress, setUploadProgress] = useState('');

  useEffect(() => {
    if (idFromUrl) {
      setCachedLibraryId(idFromUrl);
      return;
    }
    // 仅在本页激活时回写 query；KeepAlive 隐藏态不要抢路由，否则无法返回列表
    if (
      cachedLibraryId &&
      location.pathname.replace(/\/+$/, '') === '/knowledge/library-detail'
    ) {
      navigate(`/knowledge/library-detail?id=${cachedLibraryId}`, {
        replace: true,
      });
    }
  }, [idFromUrl, cachedLibraryId, location.pathname, navigate]);

  const groupNameMap = useMemo(() => {
    const map = new Map<string, string>();
    groupDefs.forEach((g) => map.set(g.id, g.name));
    return map;
  }, [groupDefs]);

  const docs = useMemo(
    () => items.map((item) => toDocRow(item, groupNameMap, lib?.visibility)),
    [items, groupNameMap, lib?.visibility],
  );

  useEffect(() => {
    let cancelled = false;
    if (!detailRow) {
      setDetailChunks([]);
      return;
    }
    setDetailChunksLoading(true);
    void fetchKnowledgeItemChunks(detailRow.id)
      .then((result) => {
        if (!cancelled) setDetailChunks(result.chunks || []);
      })
      .catch(() => {
        if (!cancelled) setDetailChunks([]);
      })
      .finally(() => {
        if (!cancelled) setDetailChunksLoading(false);
      });
    return () => { cancelled = true; };
  }, [detailRow]);

  const loadLibrary = useCallback(async () => {
    if (!libraryId) {
      setLib(null);
      return;
    }
    try {
      setLib(await fetchKnowledgeLibraryDetail(libraryId));
    } catch {
      setLib(null);
      message.error('加载知识库详情失败');
    }
  }, [libraryId]);

  const loadItems = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!libraryId) {
      setItems([]);
      setBuckets([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      const params = {
        page,
        pageSize,
        libraryId,
        keyword: keyword.trim() || undefined,
        groupCode: activeGroup === 'all' ? undefined : activeGroup,
      };
      const [res, counts] = await Promise.all([
        fetchKnowledgeItems(params),
        fetchKnowledgeItemStatistics(params),
      ]);
      if (currentRequest !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(res.total / pageSize));
      if (page > lastPage) {
        setPaging({ scope, page: lastPage, pageSize });
        return;
      }
      setItems(res.items);
      setBuckets(counts);
      setTotal(res.total);
    } catch {
      if (currentRequest !== requestId.current) return;
      setItems([]);
      setBuckets([]);
      setTotal(0);
      message.error('加载知识文档失败');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [libraryId, keyword, activeGroup, page, pageSize, scope]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    void loadItems();
    return () => {
      requestId.current += 1;
    };
  }, [loadItems]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDictionaries({
          page: 1,
          pageSize: 100,
          type: KNOWLEDGE_GROUP_DICT_TYPE,
          status: 'active',
        });
        if (cancelled) return;
        setGroupDefs(
          (res?.items ?? [])
            .slice()
            .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
            .map((item) => ({ id: item.code, name: item.name })),
        );
      } catch {
        if (!cancelled) {
          setGroupDefs([]);
          message.error('加载知识分组失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const count = (rows: KnowledgeItemBucket[]) =>
      rows.reduce((sum, row) => sum + row.count, 0);
    return [
      { id: 'all', name: '全部文档', total: count(buckets) },
      ...groupDefs.map((group) => ({
        ...group,
        total: count(buckets.filter((row) => row.groupCode === group.id)),
      })),
    ];
  }, [buckets, groupDefs]);

  const filteredDocs = docs;
  const stats = useMemo(() => {
    const count = (status: string) =>
      buckets
        .filter((row) => mapStatus(row, lib?.visibility) === status)
        .reduce((sum, row) => sum + row.count, 0);
    return {
      learn: count('学习完成'),
      ing: count('学习中'),
      wait: count('待学习'),
      fail: count('学习失败'),
      intr: count('学习中断'),
      pending: count('待审核'),
    };
  }, [buckets, lib?.visibility]);

  const currentGroupName =
    groupDefs.find((x) => x.id === activeGroup)?.name || '';

  const openUpload = () => {
    setPendingFiles([]);
    setFileList([]);
    setUploadProgress('');
    uploadForm.resetFields();
    uploadForm.setFieldsValue({
      groupCode: activeGroup !== 'all' ? activeGroup : undefined,
    });
    setUploadOpen(true);
  };

  const validateFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name} 超过 20 MB，已跳过`);
      return false;
    }
    return true;
  };

  const resetUploadState = () => {
    setUploadOpen(false);
    setPendingFiles([]);
    setFileList([]);
    setUploadProgress('');
  };

  const submitUpload = async () => {
    if (uploadInFlightRef.current) return;
    const targetLibraryId = libraryId || lib?.id || '';
    if (!targetLibraryId) {
      message.error('缺少知识库 ID，请从知识库列表重新进入后再上传');
      return;
    }
    if (!pendingFiles.length) {
      message.warning('请先选择要上传的文件');
      return;
    }
    const values = await uploadForm.validateFields();
    uploadInFlightRef.current = true;
    const isPublicLibrary = lib?.visibility === 'public';
    setSubmitting(true);
    let successCount = 0;
    const failedNames: string[] = [];
    try {
      const single = pendingFiles.length === 1;
      for (let i = 0; i < pendingFiles.length; i += 1) {
        const file = pendingFiles[i]!;
        setUploadProgress(`正在上传 ${i + 1}/${pendingFiles.length}：${file.name}`);
        try {
          const title =
            (single && (values.title as string)?.trim()) || file.name;
          const code =
            (single && (values.code as string)?.trim()) ||
            buildCodeFromFileName(file.name, `-${i.toString(36)}`);
          const payload = {
            title,
            code,
            summary: values.summary,
            // 条目可见性跟随知识库；私有库自动过审，公用库进入待审
            visibility: isPublicLibrary ? 'public' : 'private',
            libraryId: targetLibraryId,
            groupCode: values.groupCode || undefined,
          };
          let created;
          try {
            created = await createKnowledgeItem(payload);
          } catch (error) {
            // Retry only generated codes so stale form values cannot block upload.
            if (!code.startsWith('kb-') || !isKnowledgeCodeExistsError(error)) {
              throw error;
            }
            created = await createKnowledgeItem({
              ...payload,
              code: buildCodeFromFileName(file.name, `-${i.toString(36)}`),
            });
          }
          await uploadKnowledgeFile(created.id, file);
          successCount += 1;
        } catch (e: unknown) {
          const err = e as {
            message?: string;
            response?: { data?: { message?: string | string[] } };
          };
          const raw = err?.response?.data?.message ?? err?.message;
          const msg = Array.isArray(raw) ? raw.join('; ') : raw;
          failedNames.push(`${file.name}${msg ? `（${msg}）` : ''}`);
        }
      }
      if (successCount > 0) {
        const okHint = isPublicLibrary
          ? `已上传 ${successCount} 个文件并提交公开审核`
          : `已上传 ${successCount} 个文件（私有知识库无需审核）`;
        message.success(
          failedNames.length
            ? `成功上传 ${successCount} 个，失败 ${failedNames.length} 个`
            : okHint,
        );
      }
      if (failedNames.length) {
        message.error(`上传失败：${failedNames.slice(0, 3).join('；')}${failedNames.length > 3 ? '…' : ''}`);
      }
      if (successCount > 0 && failedNames.length === 0) {
        resetUploadState();
      } else if (successCount > 0) {
        // 部分成功：清掉已成功的，保留失败列表不便再追；直接关闭并刷新
        resetUploadState();
      }
      if (successCount > 0) {
        await Promise.all([loadItems(), loadLibrary()]);
      }
    } finally {
      setSubmitting(false);
      setUploadProgress('');
      uploadInFlightRef.current = false;
    }
  };

  const closePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewRow(null);
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const download = async (row: DocRow | null) => {
    if (!row) return;
    if (!row.raw.fileName && !row.raw.fileSize) {
      message.warning('该文档尚未上传源文件');
      return;
    }
    setDownloadingId(row.id);
    try {
      const blob = await fetchKnowledgeItemFile(row.id);
      triggerBlobDownload(blob, row.raw.fileName || row.name);
      message.success(`已开始下载：${row.name}`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || '下载失败');
    } finally {
      setDownloadingId(null);
    }
  };

  const removeDoc = (row: DocRow) => {
    Modal.confirm({
      title: '删除文档',
      content: `确定删除「${row.name}」吗？删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingId(row.id);
        try {
          await deleteKnowledgeItem(row.id);
          message.success('文档已删除');
          if (detailRow?.id === row.id) setDetailRow(null);
          if (previewRow?.id === row.id) closePreview();
          await Promise.all([loadItems(), loadLibrary()]);
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err?.message || '删除失败');
          throw e;
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const relearnDoc = (row: DocRow) => {
    const isPublicPending =
      lib?.visibility === 'public' && row.raw.auditStatus === 'pending';
    if (isPublicPending) {
      message.warning('公用库文档需先在「公开数据审核」通过后再学习');
      return;
    }
    if (!row.raw.fileName) {
      message.warning('该文档尚未上传文件，无法学习');
      return;
    }
    Modal.confirm({
      title: '重新学习',
      content: `将对「${row.name}」重新跑解析 / 分段 / 向量化。可在「数据资源 → 接入任务」查看进度。`,
      okText: '开始学习',
      cancelText: '取消',
      onOk: async () => {
        setRelearningId(row.id);
        try {
          const updated = await relearnKnowledgeItem(row.id);
          message.success('已触发重新学习');
          await loadItems();
          if (detailRow?.id === row.id) {
            setDetailRow(
              toDocRow(updated, groupNameMap, lib?.visibility),
            );
          }
        } catch (e: unknown) {
          const err = e as { message?: string };
          message.error(err?.message || '触发学习失败');
          throw e;
        } finally {
          setRelearningId(null);
        }
      },
    });
  };

  const openPreview = async (row: DocRow) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewRow(row);
    setPreviewLoading(true);

    const item = row.raw;
    if (!item.fileName) {
      const text =
        [item.summary, item.content].filter(Boolean).join('\n\n') || '';
      if (!text.trim()) {
        setPreviewError(null);
        setPreviewData(null);
        setPreviewLoading(false);
        return;
      }
      setPreviewData({
        kind: 'document',
        fileName: item.title || row.name,
        text,
        truncated: false,
      });
      setPreviewLoading(false);
      return;
    }

    try {
      const result = await fetchKnowledgeItemPreview(item.id);
      setPreviewData(result);
      if (result.kind === 'pdf') {
        const blob = await fetchKnowledgeItemFile(item.id);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      setPreviewError(err?.message || '文件预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderDocOps = (row: DocRow) => {
    const moreItems: MenuProps['items'] = [
      {
        key: 'preview',
        label: '在线预览',
        onClick: () => void openPreview(row),
      },
      {
        key: 'download',
        label: '下载',
        disabled: downloadingId === row.id,
        onClick: () => void download(row),
      },
    ];
    if (
      canRelearn &&
      !(lib?.visibility === 'public' && row.raw.auditStatus === 'pending')
    ) {
      moreItems.push({
        key: 'relearn',
        label: '重新学习',
        disabled: row.status === '学习中' || relearningId === row.id,
        onClick: () => relearnDoc(row),
      });
    }
    if (canDelete) {
      moreItems.push({
        key: 'delete',
        danger: true,
        label: '删除',
        disabled: deletingId === row.id,
        onClick: () => removeDoc(row),
      });
    }
    return (
      <div className="kd-ops">
        <Button type="link" size="small" onClick={() => setDetailRow(row)}>
          详情
        </Button>
        <Dropdown menu={{ items: moreItems }} trigger={['click']}>
          <Button type="link" size="small" icon={<MoreOutlined />}>
            更多
          </Button>
        </Dropdown>
      </div>
    );
  };

  const columns: ColumnsType<DocRow> = [
    {
      title: '文档名称',
      dataIndex: 'name',
      width: 280,
      ellipsis: true,
      render: (_, row) => (
        <div className="kd-file-cell">
          <div className="kd-file" onClick={() => setDetailRow(row)}>
            <span className={`kd-file-icon ${row.icon}`}>{row.icon}</span>
            <span className="kd-file-name" title={row.name}>
              {row.name}
            </span>
          </div>
          {row.tags?.length ? (
            <div className="kd-file-tags">
              {row.tags.map((t) => (
                <span key={t} className="kd-tag">
                  #{t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    { title: '分组', dataIndex: 'group', width: 100, ellipsis: true },
    {
      title: '来源',
      dataIndex: 'sourceType',
      width: 100,
      render: (v: string) => (
        <Tag color={SOURCE_COLOR[v] || 'default'}>{v}</Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 80,
      render: (v) => <span className="kd-muted">{v}</span>,
    },
    {
      title: '分段',
      dataIndex: 'seg',
      width: 80,
      render: (v) => <span className="kd-muted">{v}</span>,
    },
    {
      title: '命中',
      width: 72,
      render: (_, row) => <span className="kd-hit">{row.hit}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (v: string) => (
        <Tag color={STATUS_COLOR[v] || 'processing'}>{v}</Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'time',
      width: 150,
      ellipsis: true,
      render: (v) => <span className="kd-muted">{v}</span>,
    },
    {
      title: '操作',
      width: 168,
      fixed: 'right',
      render: (_, row) => renderDocOps(row),
    },
  ];

  const docCount = lib?.fileTotal ?? docs.length;

  return (
    <div className="kb-detail-page">
      <div className="kb-detail-left">
        <div className="kb-detail-lib">
          <div
            className="kb-detail-avatar"
            style={{ background: lib?.color || '#e6efff' }}
          >
            {lib?.icon || '📚'}
          </div>
          <div className="kb-detail-name" title={lib?.name || '知识库'}>
            {lib?.name || '知识库'}
            {lib ? (
              <Tag
                color={lib.visibility === 'public' ? 'success' : 'default'}
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
              >
                {lib.visibility === 'public' ? '公用' : '私有'}
              </Tag>
            ) : null}
          </div>
        </div>
        <div className="kb-detail-menu">
          <div className="kb-detail-menu-item active">
            <FileOutlined />
            <span>知识文档</span>
            <span className="kb-menu-doc-num">{docCount}</span>
          </div>
        </div>
        <div className="kb-detail-back">
          <Button
            type="link"
            icon={<LeftOutlined />}
            onClick={() => navigate('/knowledge/library')}
          >
            返回知识库列表
          </Button>
        </div>
      </div>

      <div className="kb-detail-right">
        <div className="kd-section">
          <div className={`kd-groups${groupCollapsed ? ' collapsed' : ''}`}>
            <div className="kd-groups-head">
              <span>知识分组</span>
            </div>
            <div className="kd-groups-list">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className={`kd-group-item${activeGroup === g.id ? ' active' : ''}`}
                  onClick={() => {
                    setPaging({ scope, page: 1, pageSize });
                    setActiveGroup(g.id);
                  }}
                >
                  <span className="kd-group-name">{g.name}</span>
                  <span className="kd-group-num">{g.total}</span>
                </div>
              ))}
            </div>
            <div
              className="kd-groups-collapse"
              onClick={() => setGroupCollapsed((v) => !v)}
            >
              {groupCollapsed ? <RightOutlined /> : <LeftOutlined />}
            </div>
          </div>

          <div className="kd-main">
            <div className="kd-header">
              <div className="kd-title">
                {activeGroup !== 'all' ? (
                  <Breadcrumb
                    items={[
                      {
                        title: (
                          <a
                            onClick={() => {
                              setPaging({ scope, page: 1, pageSize });
                              setActiveGroup('all');
                            }}
                          >
                            知识库文档
                          </a>
                        ),
                      },
                      { title: currentGroupName },
                    ]}
                  />
                ) : (
                  <span className="kd-title-text">知识库文档</span>
                )}
              </div>
              <div className="kd-stats">
                <span className="kd-stat-learn">
                  学习完成 <b>{stats.learn}</b>
                </span>
                <span className="kd-stat-ing">
                  学习中 <b>{stats.ing}</b>
                </span>
                <span className="kd-stat-wait">
                  待学习 <b>{stats.wait}</b>
                </span>
                <span className="kd-stat-fail">
                  学习失败 <b>{stats.fail}</b>
                </span>
                <span className="kd-stat-intr">
                  学习中断 <b>{stats.intr}</b>
                </span>
                {lib?.visibility === 'public' ? (
                  <span className="kd-stat-pending">
                    待审核 <b>{stats.pending}</b>
                  </span>
                ) : null}
              </div>
            </div>

            <div className="kd-toolbar">
              <div className="kd-view-toggle">
                <div
                  className={`kd-view-btn${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => setViewMode('list')}
                >
                  <UnorderedListOutlined /> 列表
                </div>
                <div
                  className={`kd-view-btn${viewMode === 'card' ? ' active' : ''}`}
                  onClick={() => setViewMode('card')}
                >
                  <AppstoreOutlined /> 卡片
                </div>
              </div>
              <Input.Search
                allowClear
                className="kd-search"
                prefix={<SearchOutlined />}
                placeholder="搜索文档名称 / 编码 / 摘要"
                value={searchKey}
                onChange={(e) => setSearchKey(e.target.value)}
                onSearch={(value) => {
                  if (value === keyword && page === 1) {
                    void loadItems();
                    return;
                  }
                  setPaging({ scope, page: 1, pageSize });
                  setKeyword(value);
                }}
              />
              <span className="spacer" />
              {canCreate && canUpload ? (
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={openUpload}
                >
                  上传文件
                </Button>
              ) : null}
            </div>

            {viewMode === 'list' ? (
              <div className="kd-table-wrap" ref={tableWrapRef}>
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  columns={columns}
                  dataSource={filteredDocs}
                  pagination={false}
                  scroll={{ x: 1120, y: scrollY }}
                />
              </div>
            ) : (
              <div className="kd-doc-cards">
                {filteredDocs.map((row) => (
                  <div key={row.id} className="kd-doc-card">
                    <div className="kd-doc-card-head">
                      <span className={`kd-file-icon ${row.icon}`}>
                        {row.icon}
                      </span>
                      <Tag color={STATUS_COLOR[row.status] || 'processing'}>
                        {row.status}
                      </Tag>
                    </div>
                    <div
                      className="kd-doc-card-title"
                      onClick={() => setDetailRow(row)}
                    >
                      {row.name}
                    </div>
                    <div className="kd-doc-card-meta">
                      {row.group} · {row.size}
                      <br />
                      <Tag color={SOURCE_COLOR[row.sourceType] || 'default'}>
                        {row.sourceType}
                      </Tag>
                      <span> 命中 {row.hit} 次</span>
                    </div>
                    <div className="kd-doc-card-foot">
                      <span
                        className="kd-doc-card-author"
                        title={`${row.author} · ${row.time}`}
                      >
                        {row.author} · {row.time}
                      </span>
                      {renderDocOps(row)}
                    </div>
                  </div>
                ))}
                {!loading && !filteredDocs.length ? (
                  <div className="kb-empty">
                    <div>当前分组下暂无匹配文档</div>
                    {canCreate && canUpload ? (
                      <Button
                        type="primary"
                        icon={<UploadOutlined />}
                        style={{ marginTop: 12 }}
                        onClick={openUpload}
                      >
                        上传文件
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[20, 50, 100]}
              showTotal={(value) => `共 ${value} 篇文档`}
              onChange={(next, size) => {
                setPaging({
                  scope,
                  page: size === pageSize ? next : 1,
                  pageSize: size,
                });
              }}
              style={{ padding: '12px 0', flexShrink: 0 }}
            />
          </div>
        </div>
      </div>

      <Drawer
        title="文档详情"
        width={480}
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setDetailRow(null)}>关闭</Button>
            {canDelete && detailRow ? (
              <Button
                danger
                loading={deletingId === detailRow.id}
                onClick={() => removeDoc(detailRow)}
              >
                删除
              </Button>
            ) : null}
            {canRelearn &&
            detailRow &&
            !(
              lib?.visibility === 'public' &&
              detailRow.raw.auditStatus === 'pending'
            ) ? (
              <Button
                loading={relearningId === detailRow.id}
                disabled={detailRow.status === '学习中'}
                onClick={() => relearnDoc(detailRow)}
              >
                重新学习
              </Button>
            ) : null}
            <Button
              onClick={() => {
                if (detailRow) void openPreview(detailRow);
              }}
            >
              在线预览
            </Button>
            <Button
              type="primary"
              loading={!!detailRow && downloadingId === detailRow.id}
              onClick={() => void download(detailRow)}
            >
              下载
            </Button>
          </Space>
        }
      >
        {detailRow ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="文档名称">
              <strong>{detailRow.name}</strong>
            </Descriptions.Item>
            <Descriptions.Item label="类型 / 分组">
              <Tag color="blue">{docTypeLabel(detailRow)}</Tag>
              <Tag style={{ marginLeft: 6 }}>{detailRow.group}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="来源标签">
              <Tag color={SOURCE_COLOR[detailRow.sourceType] || 'default'}>
                {detailRow.sourceType}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="学习状态">
              <Tag color={STATUS_COLOR[detailRow.status] || 'processing'}>
                {detailRow.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="基本信息">
              大小：{detailRow.size} · 分段：{detailRow.seg} · 命中：
              {detailRow.hit} 次
            </Descriptions.Item>
            <Descriptions.Item label="分段详情">
              {detailChunksLoading ? (
                <Spin size="small" tip="正在加载分段" />
              ) : detailChunks.length ? (
                <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                  {detailChunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        padding: '8px 10px',
                        background: '#fafafa',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong>分段 {chunk.chunkIndex + 1}</strong>
                        <span className="kd-muted">约 {chunk.tokenCount} tokens</span>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#374151' }}>
                        {chunk.content}
                      </div>
                      {chunk.pageNumber || chunk.section || chunk.sheetName ? (
                        <div className="kd-muted" style={{ marginTop: 5 }}>
                          {[chunk.pageNumber ? `第 ${chunk.pageNumber} 页` : '', chunk.section, chunk.sheetName]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="kd-muted">暂无分段内容，文档学习完成后会显示。</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="来源 / 作者">
              {detailRow.src}
              <div className="kd-muted" style={{ marginTop: 4 }}>
                作者：{detailRow.author} · 更新时间：{detailRow.time}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="标签">
              <div className="kd-file-tags">
                {(detailRow.tags || []).map((t) => (
                  <span key={t} className="kd-tag">
                    #{t}
                  </span>
                ))}
              </div>
            </Descriptions.Item>
            <Descriptions.Item label="内容预览">
              {detailRow.preview?.trim() ? (
                <div style={{ color: '#595959', lineHeight: 1.8 }}>
                  {detailRow.preview}
                </div>
              ) : (
                <span className="kd-muted">暂无可预览内容</span>
              )}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>

      <Modal
        title={previewRow ? `在线预览 · ${previewRow.name}` : '在线预览'}
        open={!!previewRow}
        onCancel={closePreview}
        width={PREVIEW_MODAL_WIDTH}
        destroyOnClose
        className="admin-preview-modal"
        styles={{
          body: {
            minHeight: 360,
            maxHeight: '76vh',
            overflow: 'auto',
            paddingTop: 12,
          },
        }}
        footer={
          <Space>
            <Button onClick={closePreview}>关闭</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={!!previewRow && downloadingId === previewRow.id}
              onClick={() => void download(previewRow)}
            >
              下载文档
            </Button>
          </Space>
        }
      >
        {previewRow ? (
          <>
            <div className="kd-preview-meta">
              <div className="kd-preview-file">
                <span className={`kd-file-icon ${previewRow.icon}`}>
                  {previewRow.icon}
                </span>
                <div>
                  <div className="kd-preview-name">{previewRow.name}</div>
                  <div className="kd-muted">
                    {previewRow.size} · {previewRow.author} · 更新于{' '}
                    {previewRow.time}
                  </div>
                </div>
              </div>
              <div className="kd-preview-tags">
                <Tag color={STATUS_COLOR[previewRow.status] || 'processing'}>
                  {previewRow.status}
                </Tag>
                <Tag color={SOURCE_COLOR[previewRow.sourceType] || 'default'}>
                  {previewRow.sourceType}
                </Tag>
              </div>
            </div>

            <Spin spinning={previewLoading} tip="正在加载预览">
              {previewError ? (
                <Alert
                  type="error"
                  showIcon
                  message="预览失败"
                  description={previewError}
                  style={{ marginBottom: 12 }}
                />
              ) : null}

              {!previewLoading && previewData?.kind === 'pdf' && previewUrl ? (
                <iframe
                  title={previewData.fileName}
                  src={previewUrl}
                  style={{ width: '100%', height: '68vh', border: 0 }}
                />
              ) : null}

              {!previewLoading &&
              previewData?.kind === 'html' &&
              previewData.html.trim() ? (
                <>
                  {previewData.truncated ? (
                    <Alert
                      type="info"
                      showIcon
                      message="内容较长，仅显示前 20 万个字符"
                      style={{ marginBottom: 12 }}
                    />
                  ) : null}
                  <DatasetHtmlPreviewFrame
                    title={previewData.fileName}
                    html={previewData.html}
                  />
                </>
              ) : null}

              {!previewLoading && previewData?.kind === 'document' ? (
                <>
                  {previewData.truncated ? (
                    <Alert
                      type="info"
                      showIcon
                      message="内容较长，仅显示前 20 万个字符"
                      style={{ marginBottom: 12 }}
                    />
                  ) : null}
                  {previewData.text?.trim() ? (
                    <div className="kd-preview-paper">
                      <div className="kd-preview-paper-head">
                        <div>
                          <div className="kd-preview-kicker">解析内容预览</div>
                          <h2>{previewRow.name.replace(/\.[^.]+$/, '')}</h2>
                        </div>
                        <Tag>
                          {previewRow.seg} · {previewRow.group}
                        </Tag>
                      </div>
                      <div
                        className="kd-preview-paper-body"
                        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}
                      >
                        {previewData.text}
                      </div>
                    </div>
                  ) : (
                    <div className="kd-preview-empty">
                      <FileOutlined style={{ fontSize: 26, color: '#98a2b3' }} />
                      <div style={{ marginTop: 14, fontWeight: 600 }}>
                        暂无可预览内容
                      </div>
                      <div className="kd-muted" style={{ margin: '7px 0 18px' }}>
                        文档没有可显示的文字内容，可下载原文件查看。
                      </div>
                      <Button
                        loading={downloadingId === previewRow.id}
                        onClick={() => void download(previewRow)}
                      >
                        下载原文件
                      </Button>
                    </div>
                  )}
                </>
              ) : null}

              {!previewLoading && previewData?.kind === 'spreadsheet' ? (
                <>
                  {previewData.sheetName || previewData.truncated ? (
                    <Alert
                      type="info"
                      showIcon
                      message={
                        previewData.sheetName
                          ? `工作表：${previewData.sheetName}`
                          : '表格预览'
                      }
                      description={
                        previewData.truncated
                          ? `仅显示前 200 行、50 列（原表共 ${previewData.totalRows} 行、${previewData.totalColumns} 列）`
                          : undefined
                      }
                      style={{ marginBottom: 12 }}
                    />
                  ) : null}
                  <Table
                    size="small"
                    bordered
                    rowKey={(_, index) => String(index)}
                    pagination={false}
                    scroll={{ x: 'max-content', y: '60vh' }}
                    dataSource={previewData.rows}
                    locale={{ emptyText: '工作表为空' }}
                    columns={[
                      {
                        title: '#',
                        width: 56,
                        fixed: 'left' as const,
                        render: (_value, _row, index) => index + 1,
                      },
                      ...Array.from(
                        { length: Math.min(previewData.totalColumns, 50) },
                        (_, index) => ({
                          title: excelColumnName(index),
                          width: 160,
                          render: (_value: unknown, row: string[]) =>
                            row[index] || '',
                        }),
                      ),
                    ]}
                  />
                </>
              ) : null}

              {!previewLoading && !previewError && !previewData ? (
                <div className="kd-preview-empty">
                  <FileOutlined style={{ fontSize: 26, color: '#98a2b3' }} />
                  <div style={{ marginTop: 14, fontWeight: 600 }}>
                    暂无可预览内容
                  </div>
                  <div className="kd-muted" style={{ margin: '7px 0 18px' }}>
                    该文档尚未解析出可在线阅读的内容。
                  </div>
                  <Button
                    loading={downloadingId === previewRow.id}
                    onClick={() => void download(previewRow)}
                  >
                    下载原文件
                  </Button>
                </div>
              ) : null}
            </Spin>
          </>
        ) : null}
      </Modal>

      <Modal
        {...withFormModal({
          open: uploadOpen,
          title: '上传文件',
          onCancel: () => {
            if (!submitting) resetUploadState();
          },
          onOk: () => void submitUpload(),
          confirmLoading: submitting,
          okText:
            pendingFiles.length > 1
              ? lib?.visibility === 'public'
                ? `上传并提交审核（${pendingFiles.length}）`
                : `上传（${pendingFiles.length}）`
              : lib?.visibility === 'public'
                ? '上传并提交审核'
                : '上传',
          width: FORM_MODAL_WIDTH_LG,
        })}
      >
        <Form form={uploadForm} layout="vertical" className="admin-form-grid">
          <Form.Item
            label="知识文件"
            required
            className="admin-form-span-2"
            extra={
              uploadProgress ||
              (lib?.visibility === 'public'
                ? '可一次选择多个文件；当前为公用知识库，上传后进入「公开数据审核」待审队列'
                : '可一次选择多个文件；当前为私有知识库，上传后无需审核')
            }
          >
            <Upload.Dragger
              accept={KNOWLEDGE_FILE_ACCEPT}
              multiple
              maxCount={20}
              fileList={fileList}
              disabled={submitting}
              beforeUpload={(file) => {
                if (!validateFile(file)) return Upload.LIST_IGNORE;

                setPendingFiles((prev) => {
                  const exists = prev.some(
                    (p) => p.name === file.name && p.size === file.size,
                  );
                  if (exists) return prev;
                  if (prev.length >= 20) {
                    message.warning('一次最多上传 20 个文件');
                    return prev;
                  }
                  const next = [...prev, file];
                  if (next.length === 1) {
                    uploadForm.setFieldsValue({
                      title: file.name,
                      code: buildCodeFromFileName(file.name),
                    });
                  } else {
                    uploadForm.setFieldsValue({
                      title: undefined,
                      code: undefined,
                    });
                  }
                  return next;
                });
                setFileList((prev) => {
                  if (prev.some((f) => f.uid === file.uid)) return prev;
                  if (prev.length >= 20) return prev;
                  return [
                    ...prev,
                    {
                      uid: file.uid,
                      name: file.name,
                      status: 'done',
                      size: file.size,
                    },
                  ];
                });
                return false;
              }}
              onRemove={(file) => {
                setPendingFiles((prev) => {
                  const next = prev.filter(
                    (p) =>
                      !(
                        p.name === file.name &&
                        (file.size == null || p.size === file.size)
                      ),
                  );
                  if (next.length === 1) {
                    uploadForm.setFieldsValue({
                      title: next[0]!.name,
                      code: buildCodeFromFileName(next[0]!.name),
                    });
                  } else if (next.length === 0) {
                    uploadForm.setFieldsValue({
                      title: undefined,
                      code: undefined,
                    });
                  }
                  return next;
                });
                setFileList((prev) => prev.filter((f) => f.uid !== file.uid));
              }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint">
                支持同时选择多个文件（最多 20 个）；PDF / CSV / XLS / XLSX / DOC / DOCX / TXT /
                MD / HTML / JSON，单个最大 20MB
              </p>
            </Upload.Dragger>
          </Form.Item>
          {pendingFiles.length <= 1 ? (
            <>
              <Form.Item name="title" label="标题">
                <Input placeholder="默认使用文件名" />
              </Form.Item>
              <Form.Item name="code" label="编码">
                <Input placeholder="可自动生成" />
              </Form.Item>
            </>
          ) : (
            <Form.Item className="admin-form-span-2" label="标题 / 编码">
              <Input
                disabled
                value={`已选 ${pendingFiles.length} 个文件，将分别使用文件名作为标题并自动生成编码`}
              />
            </Form.Item>
          )}
          <Form.Item name="groupCode" label="知识分组">
            <Select
              allowClear
              placeholder="请选择分组"
              options={groupDefs.map((g) => ({
                value: g.id,
                label: g.name,
              }))}
            />
          </Form.Item>
          <Form.Item label="知识库属性">
            <Input
              disabled
              value={
                lib?.visibility === 'public'
                  ? '公用知识库（需审核）'
                  : '私有知识库（免审核）'
              }
            />
          </Form.Item>
          <Form.Item name="summary" label="摘要" className="admin-form-span-2">
            <Input.TextArea
              rows={2}
              placeholder={
                pendingFiles.length > 1
                  ? '可选，将应用到本次全部文件'
                  : '可选'
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
