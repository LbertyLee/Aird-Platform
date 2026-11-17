import {
  DownloadOutlined,
  FileOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  fetchDictionaries,
  fetchKnowledgeItemFile,
  fetchKnowledgeItemPreview,
  fetchUserKnowledgeLibraries,
  type DatasetFilePreview,
  type KnowledgeItem,
  type UserKnowledgeLibraryOverview,
} from '../api/admin';
import { DatasetHtmlPreviewFrame } from '../components/DatasetHtmlPreviewFrame';
import { PREVIEW_MODAL_WIDTH } from '../components/form-modal';
import { useTableScrollY } from '../hooks/useTableScrollY';
import { KNOWLEDGE_GROUP_DICT_TYPE } from './kb-library/constants';
import './kb-library/kb-library.css';

const STATUS_COLOR: Record<string, string> = {
  学习完成: 'success',
  学习失败: 'error',
  学习中断: 'warning',
  待审核: 'warning',
  待学习: 'default',
  已退回: 'error',
  学习中: 'processing',
};

const PUBLIC_COLOR: Record<string, string> = {
  已公开: 'success',
  已驳回: 'error',
  待审核: 'warning',
};

const SOURCE_LABEL: Record<string, string> = {
  admin: '管理端创建',
  research_upload: '研究端上传',
};

type DocRow = {
  id: string;
  name: string;
  icon: string;
  size: string;
  group: string;
  time: string;
  author: string;
  status: string;
  publicStatus?: string;
  sourceType: string;
  src: string;
  rejectReason?: string | null;
  tags: string[];
  raw: KnowledgeItem;
};

function fileIcon(name?: string | null): string {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'doc';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv'))
    return 'xls';
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'txt';
  return 'doc';
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 KB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function mapStatus(item: KnowledgeItem): string {
  if (item.auditStatus === 'pending') return '待审核';
  if (item.auditStatus === 'rejected') return '已退回';
  if (item.vectorStatus === 'ready') return '学习完成';
  if (item.vectorStatus === 'failed') return '学习失败';
  if (item.vectorStatus === 'processing') return '学习中';
  if (item.publishStatus === 'published') return '学习中';
  if (item.auditStatus === 'approved') return '待学习';
  return '待审核';
}

function mapPublicStatus(item: KnowledgeItem): string | undefined {
  if (item.visibility !== 'public') return undefined;
  if (item.auditStatus === 'approved') return '已公开';
  if (item.auditStatus === 'rejected') return '已驳回';
  return '待审核';
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

function toDocRow(
  item: KnowledgeItem,
  groupMap: Map<string, string>,
): DocRow {
  const name = item.fileName || item.title;
  return {
    id: item.id,
    name,
    icon: fileIcon(name),
    size: formatBytes(item.fileSize),
    group: (item.groupCode && groupMap.get(item.groupCode)) || item.groupCode || '—',
    time: formatTime(item.updatedAt),
    author:
      item.submitter?.displayName || item.submitter?.username || '—',
    status: mapStatus(item),
    publicStatus: mapPublicStatus(item),
    sourceType: SOURCE_LABEL[item.sourceType] || item.sourceType,
    src: item.summary || '—',
    rejectReason: item.rejectReason,
    tags: (item.tags || []).map((t) => t.name),
    raw: item,
  };
}

/**
 * 用户知识库详情：左侧知识库切换 + 文档表；预览走「在线查看」弹窗。
 */
export function KnowledgeUserLibraryDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const userId = params.get('userId') || '';
  const libraryIdFromUrl = params.get('libraryId') || '';

  const [cachedUserId, setCachedUserId] = useState(userId);
  const [overview, setOverview] =
    useState<UserKnowledgeLibraryOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [groupMap, setGroupMap] = useState<Map<string, string>>(new Map());
  const [activeLibId, setActiveLibId] = useState(libraryIdFromUrl);
  const [activeDoc, setActiveDoc] = useState<DocRow | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<DatasetFilePreview | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY(56);

  const effectiveUserId = userId || cachedUserId;

  useEffect(() => {
    if (userId) {
      setCachedUserId(userId);
      return;
    }
    if (
      cachedUserId &&
      location.pathname.replace(/\/+$/, '') === '/knowledge/user-detail'
    ) {
      navigate(
        `/knowledge/user-detail?userId=${cachedUserId}${
          activeLibId
            ? `&libraryId=${encodeURIComponent(activeLibId)}`
            : ''
        }`,
        { replace: true },
      );
    }
  }, [userId, cachedUserId, activeLibId, location.pathname, navigate]);

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
        const map = new Map<string, string>();
        (res?.items ?? []).forEach((item) => map.set(item.code, item.name));
        setGroupMap(map);
      } catch {
        if (!cancelled) setGroupMap(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOverview = useCallback(async () => {
    if (!effectiveUserId) {
      setOverview(null);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchUserKnowledgeLibraries(effectiveUserId);
      setOverview(data);
      setActiveLibId((prev) => {
        if (prev && data.libraries.some((l) => l.id === prev)) return prev;
        if (
          libraryIdFromUrl &&
          data.libraries.some((l) => l.id === libraryIdFromUrl)
        ) {
          return libraryIdFromUrl;
        }
        return data.libraries[0]?.id || '';
      });
    } catch (e: unknown) {
      setOverview(null);
      const err = e as { message?: string };
      message.error(err?.message || '加载用户知识库失败');
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, libraryIdFromUrl]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const activeLib = useMemo(
    () => overview?.libraries.find((l) => l.id === activeLibId) || null,
    [overview, activeLibId],
  );

  const docs = useMemo(
    () => (activeLib?.items || []).map((item) => toDocRow(item, groupMap)),
    [activeLib, groupMap],
  );

  const closePreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewOpen(false);
  }, [previewUrl]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const download = async (row: DocRow | null) => {
    if (!row) return;
    if (!row.raw.fileName) {
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

  const openPreview = async (row: DocRow) => {
    setActiveDoc(row);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewOpen(true);
    setPreviewLoading(true);

    const item = row.raw;
    if (!item.fileName) {
      const text =
        [item.summary, item.content].filter(Boolean).join('\n\n') || '';
      if (text.trim()) {
        setPreviewData({
          kind: 'document',
          fileName: item.title || row.name,
          text,
          truncated: false,
        });
      }
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

  const displayName =
    overview?.user.displayName || overview?.user.username || '用户';
  const avatarText = displayName.slice(0, 1).toUpperCase();

  const columns: ColumnsType<DocRow> = [
    {
      title: '文档名称',
      ellipsis: true,
      render: (_, row) => (
        <div className="kd-file-cell">
          <div className="kd-file">
            <span className={`kd-file-icon ${row.icon}`}>{row.icon}</span>
            <div className="kd-file-meta">
              <span className="kd-file-name" title={row.name}>
                {row.name}
              </span>
              {row.rejectReason ? (
                <span className="doc-reason">驳回原因：{row.rejectReason}</span>
              ) : null}
            </div>
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
    {
      title: '来源',
      width: 120,
      render: (_, row) => <Tag color="blue">{row.sourceType}</Tag>,
    },
    {
      title: '公开',
      width: 100,
      render: (_, row) =>
        row.publicStatus ? (
          <Tag color={PUBLIC_COLOR[row.publicStatus] || 'default'}>
            {row.publicStatus}
          </Tag>
        ) : (
          <span className="kd-muted">—</span>
        ),
    },
    {
      title: '状态',
      width: 110,
      render: (_, row) => (
        <Tag color={STATUS_COLOR[row.status] || 'processing'}>{row.status}</Tag>
      ),
    },
    { title: '更新时间', dataIndex: 'time', width: 160 },
    {
      title: '操作',
      width: 160,
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" onClick={() => void openPreview(row)}>
            在线查看
          </Button>
          <Button
            type="link"
            loading={downloadingId === row.id}
            onClick={() => void download(row)}
          >
            下载
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="user-kb-detail">
      <div className="user-kb-left">
        <div className="user-kb-owner">
          <div className="owner-avatar" style={{ background: '#e6efff' }}>
            {avatarText}
          </div>
          <div>
            <div className="owner-name">{displayName}</div>
            <div className="owner-meta">
              {overview?.libraryCount || 0} 个知识库 ·{' '}
              {overview?.documentCount || 0} 篇文档
            </div>
          </div>
        </div>

        <div className="user-kb-menu">
          {(overview?.libraries || []).map((lib) => (
            <div
              key={lib.id}
              className={`kb-menu-item${activeLibId === lib.id ? ' active' : ''}`}
              onClick={() => {
                setActiveLibId(lib.id);
                setActiveDoc(null);
                navigate(
                  `/knowledge/user-detail?userId=${encodeURIComponent(effectiveUserId)}&libraryId=${encodeURIComponent(lib.id)}`,
                  { replace: true },
                );
              }}
            >
              <span
                className="kb-menu-icon"
                style={{ background: lib.color }}
              >
                {lib.icon}
              </span>
              <span className="kb-menu-name">{lib.name}</span>
              <span className="kb-menu-count">{lib.fileTotal}</span>
            </div>
          ))}
        </div>

        <div className="user-kb-back">
          <Button
            type="link"
            icon={<LeftOutlined />}
            onClick={() => navigate('/knowledge/user')}
          >
            返回用户知识库
          </Button>
        </div>
      </div>

      <div className="user-kb-right">
        <Spin spinning={loading}>
          <div className="doc-panel doc-panel-full">
            <div className="doc-head">
              <div>
                <div className="doc-title">{activeLib?.name || '知识文档'}</div>
                <div className="doc-sub">
                  {activeLib?.intro || '选择左侧知识库查看文档'}
                </div>
              </div>
              <div className="doc-stats">
                <span>
                  文档 <b>{docs.length}</b>
                </span>
                <span>
                  容量 <b>{formatBytes(activeLib?.fileSize || 0)}</b>
                </span>
              </div>
            </div>

            <div
              ref={tableWrapRef}
              className="user-kb-table-wrap"
              style={{ flex: 1, minHeight: 0 }}
            >
              <Table
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={docs}
                pagination={false}
                tableLayout="fixed"
                locale={{ emptyText: '该知识库暂无文档' }}
                scroll={{ y: scrollY }}
              />
            </div>
          </div>
        </Spin>
      </div>

      <Modal
        title={activeDoc ? `在线预览 · ${activeDoc.name}` : '在线预览'}
        open={previewOpen}
        onCancel={closePreview}
        width={PREVIEW_MODAL_WIDTH}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={closePreview}>关闭</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={!!activeDoc && downloadingId === activeDoc.id}
              onClick={() => void download(activeDoc)}
            >
              下载文档
            </Button>
          </Space>
        }
      >
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
          {!previewLoading && previewData?.kind === 'html' && previewData.html.trim() ? (
            <DatasetHtmlPreviewFrame
              title={previewData.fileName}
              html={previewData.html}
            />
          ) : null}
          {!previewLoading && previewData?.kind === 'document' ? (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>
              {previewData.text || '文档没有可显示的文字内容'}
            </div>
          ) : null}
          {!previewLoading && previewData?.kind === 'spreadsheet' ? (
            <Table
              size="small"
              bordered
              rowKey={(_, index) => String(index)}
              pagination={false}
              scroll={{ x: 'max-content', y: '60vh' }}
              dataSource={previewData.rows}
              columns={[
                {
                  title: '#',
                  width: 56,
                  fixed: 'left' as const,
                  render: (_v, _r, index) => index + 1,
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
          ) : null}
          {!previewLoading && !previewError && !previewData ? (
            <div className="kd-preview-empty">
              <FileOutlined style={{ fontSize: 26, color: '#98a2b3' }} />
              <div style={{ marginTop: 14, fontWeight: 600 }}>
                暂无可预览内容
              </div>
              <Button
                style={{ marginTop: 12 }}
                onClick={() => void download(activeDoc)}
              >
                下载原文件
              </Button>
            </div>
          ) : null}
        </Spin>
      </Modal>
    </div>
  );
}
