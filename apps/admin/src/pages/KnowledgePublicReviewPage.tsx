import { SearchOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DatasetHtmlPreviewFrame } from '../components/DatasetHtmlPreviewFrame';
import {
  approveKnowledgeItem,
  fetchDictionaries,
  fetchKnowledgeAuditFile,
  fetchKnowledgeAuditPreview,
  fetchKnowledgeAudits,
  rejectKnowledgeItem,
  type DatasetFilePreview,
  type KnowledgeItem,
} from '../api/admin';
import { PREVIEW_MODAL_WIDTH, withFormModal } from '../components/form-modal';
import { useTableScrollY } from '../hooks/useTableScrollY';
import { useSessionStore } from '../stores/session';
import { KNOWLEDGE_GROUP_DICT_TYPE } from './kb-library/constants';
import './kb-library/kb-library.css';

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

const PUBLIC_COLOR: Record<string, string> = {
  已公开: 'success',
  已驳回: 'error',
  待审核: 'warning',
};

const DOC_COLOR: Record<string, string> = {
  学习完成: 'success',
  学习失败: 'error',
  已退回: 'error',
  待审核: 'warning',
  待学习: 'default',
  学习中: 'processing',
};

const SOURCE_LABEL: Record<string, string> = {
  admin: '管理端创建',
  research_upload: '研究端上传',
};

type ReviewRow = {
  id: string;
  name: string;
  author: string;
  publicConsent: boolean;
  publicStatus: '待审核' | '已公开' | '已驳回';
  status: string;
  group: string;
  time: string;
  rejectReason?: string | null;
  tags: string[];
  icon: string;
  sourceType: string;
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

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toPublicStatus(
  auditStatus: string,
): '待审核' | '已公开' | '已驳回' {
  if (auditStatus === 'approved') return '已公开';
  if (auditStatus === 'rejected') return '已驳回';
  return '待审核';
}

function toInboundStatus(item: KnowledgeItem): string {
  if (item.auditStatus === 'pending') return '待审核';
  if (item.auditStatus === 'rejected') return '已退回';
  if (item.vectorStatus === 'ready') return '学习完成';
  if (item.vectorStatus === 'failed') return '学习失败';
  if (item.vectorStatus === 'processing') return '学习中';
  if (item.publishStatus === 'published') return '学习中';
  return '待学习';
}

function toRow(
  item: KnowledgeItem,
  groupMap: Map<string, string>,
): ReviewRow {
  return {
    id: item.id,
    name: item.title || item.fileName || item.code,
    author:
      item.submitter?.displayName ||
      item.submitter?.username ||
      SOURCE_LABEL[item.sourceType] ||
      '—',
    publicConsent: item.visibility === 'public',
    publicStatus: toPublicStatus(item.auditStatus),
    status: toInboundStatus(item),
    group: (item.groupCode && groupMap.get(item.groupCode)) || item.groupCode || '—',
    time: formatTime(item.createdAt || item.updatedAt),
    rejectReason: item.rejectReason,
    tags: (item.tags || []).map((t) => t.name),
    icon: fileIcon(item.fileName || item.title),
    sourceType: item.sourceType,
  };
}

/**
 * 公开数据审核：仅展示「公用知识库」下的待审/已审文档。
 */
export function KnowledgePublicReviewPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canApprove = hasPermission('button:knowledge:audit:approve');
  const canReject = hasPermission('button:knowledge:audit:reject');

  const [activeTab, setActiveTab] = useState('pending');
  const [searchKey, setSearchKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [groupMap, setGroupMap] = useState<Map<string, string>>(new Map());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ReviewRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<DatasetFilePreview | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('内容预览');
  const [form] = Form.useForm();
  /** 无分页条，仅预留表头高度 */
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY(56);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetchDictionaries({
        page: 1,
        pageSize: 100,
        type: KNOWLEDGE_GROUP_DICT_TYPE,
        status: 'active',
      });
      const map = new Map<string, string>();
      (res?.items ?? []).forEach((item) => map.set(item.code, item.name));
      setGroupMap(map);
    } catch {
      setGroupMap(new Map());
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, approved, rejected] = await Promise.all([
        fetchKnowledgeAudits({
          page: 1,
          pageSize: 100,
          libraryVisibility: 'public',
          auditStatus: 'pending',
        }),
        fetchKnowledgeAudits({
          page: 1,
          pageSize: 100,
          libraryVisibility: 'public',
          auditStatus: 'approved',
        }),
        fetchKnowledgeAudits({
          page: 1,
          pageSize: 100,
          libraryVisibility: 'public',
          auditStatus: 'rejected',
        }),
      ]);
      setItems([
        ...(pending?.items ?? []),
        ...(approved?.items ?? []),
        ...(rejected?.items ?? []),
      ]);
    } catch (e: unknown) {
      setItems([]);
      const err = e as { message?: string };
      message.error(err?.message || '加载公开审核队列失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const docs = useMemo(
    () => [...items]
      .sort((a, b) => {
        const aTime = Date.parse(a.createdAt || a.updatedAt) || 0;
        const bTime = Date.parse(b.createdAt || b.updatedAt) || 0;
        return bTime - aTime || b.id.localeCompare(a.id);
      })
      .map((item) => toRow(item, groupMap)),
    [items, groupMap],
  );

  const pendingRows = useMemo(
    () => docs.filter((row) => row.publicStatus === '待审核'),
    [docs],
  );

  const tabs = [
    { label: `待审核（${pendingRows.length}）`, value: 'pending' },
    { label: `全部（${docs.length}）`, value: 'all' },
  ];

  const statPending = pendingRows.length;
  const statApproved = docs.filter((r) => r.publicStatus === '已公开').length;
  const statRejected = docs.filter((r) => r.publicStatus === '已驳回').length;

  const filteredRows = useMemo(() => {
    const list = activeTab === 'pending' ? pendingRows : docs;
    const key = searchKey.trim().toLowerCase();
    if (!key) return list;
    return list.filter((row) =>
      `${row.name} ${row.author}`.toLowerCase().includes(key),
    );
  }, [activeTab, pendingRows, docs, searchKey]);

  const approve = async (row: ReviewRow) => {
    try {
      await approveKnowledgeItem(row.id);
      message.success(`已通过公开：${row.name}`);
      await loadItems();
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || '通过失败');
    }
  };

  const openReject = (row: ReviewRow) => {
    setRejectTarget(row);
    form.resetFields();
    setRejectOpen(true);
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await rejectKnowledgeItem(rejectTarget.id, values.reason);
      message.success('已驳回公开申请');
      setRejectOpen(false);
      setRejectTarget(null);
      await loadItems();
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || '驳回失败');
    } finally {
      setSubmitting(false);
    }
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(false);
    setPreviewLoading(false);
  };

  const openPreview = async (row: ReviewRow) => {
    const item = items.find((x) => x.id === row.id);
    if (!item) {
      message.warning('未找到该文档');
      return;
    }
    if (!item.fileName && !item.content && !item.summary) {
      message.warning('该条目没有可预览的文件或正文');
      return;
    }

    setPreviewTitle(item.fileName || item.title || row.name || '内容预览');

    if (!item.fileName) {
      setPreview({
        kind: 'document',
        fileName: item.title,
        text: [item.summary, item.content].filter(Boolean).join('\n\n') || '',
        truncated: false,
      });
      setPreviewError(null);
      setPreviewOpen(true);
      setPreviewLoading(false);
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const result = await fetchKnowledgeAuditPreview(item.id);
      setPreview(result);
      if (result.kind === 'pdf') {
        const blob = await fetchKnowledgeAuditFile(item.id);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '文件预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const columns: ColumnsType<ReviewRow> = [
    {
      title: '文档名称',
      width: 280,
      ellipsis: true,
      render: (_, row) => (
        <div className="kd-file-cell">
          <div className="kd-file" onClick={() => void openPreview(row)}>
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
    { title: '提交人', dataIndex: 'author', width: 120 },
    {
      title: '公开申请',
      width: 120,
      render: (_, row) => (
        <Tag color={row.publicConsent ? 'success' : 'default'}>
          {row.publicConsent ? '已授权公开' : '未申请'}
        </Tag>
      ),
    },
    {
      title: '公开状态',
      width: 110,
      render: (_, row) => (
        <Tag color={PUBLIC_COLOR[row.publicStatus] || 'default'}>
          {row.publicStatus}
        </Tag>
      ),
    },
    {
      title: '入库状态',
      width: 110,
      render: (_, row) => (
        <Tag color={DOC_COLOR[row.status] || 'warning'}>{row.status}</Tag>
      ),
    },
    { title: '知识分组', dataIndex: 'group', width: 110 },
    { title: '提交时间', dataIndex: 'time', width: 150 },
    {
      title: '操作',
      width: 168,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0} wrap={false}>
          <Button type="link" size="small" onClick={() => void openPreview(row)}>
            预览
          </Button>
          {row.publicStatus === '待审核' ? (
            <>
              {canApprove ? (
                <Button
                  type="link"
                  size="small"
                  style={{ color: '#12b76a' }}
                  onClick={() => void approve(row)}
                >
                  通过
                </Button>
              ) : null}
              {canReject ? (
                <Button type="link" size="small" danger onClick={() => openReject(row)}>
                  驳回
                </Button>
              ) : null}
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="public-review-page">
      <div className="review-toolbar">
        <div className="kb-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.value}
              className={`kb-tab-item${activeTab === tab.value ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.label}
            </div>
          ))}
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索文档 / 提交人"
          className="kd-search"
          value={searchKey}
          onChange={(e) => setSearchKey(e.target.value)}
        />
      </div>

      <div className="review-stats">
        <div className="review-stat">
          <span className="num pending">{statPending}</span>
          <span>待审核</span>
        </div>
        <div className="review-stat">
          <span className="num approved">{statApproved}</span>
          <span>已公开</span>
        </div>
        <div className="review-stat">
          <span className="num rejected">{statRejected}</span>
          <span>已驳回</span>
        </div>
      </div>

      <div className="review-table" ref={tableWrapRef}>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={filteredRows}
          pagination={false}
          scroll={{ x: 1100, y: scrollY }}
        />
      </div>

      <Modal
        title="驳回公开申请"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => void submitReject()}
        confirmLoading={submitting}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        width={460}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="文档">
            <Input value={rejectTarget?.name || ''} disabled />
          </Form.Item>
          <Form.Item
            name="reason"
            label="驳回原因"
            rules={[{ required: true, message: '请填写驳回原因' }]}
          >
            <Input.TextArea
              rows={3}
              placeholder="必填，用户可在知识库文档详情中查看原因"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          title: preview?.fileName || previewTitle,
          open: previewOpen,
          onCancel: closePreview,
          footer: null,
          width: PREVIEW_MODAL_WIDTH,
          className: 'admin-preview-modal',
          styles: {
            body: {
              minHeight: 360,
              maxHeight: '76vh',
              overflow: 'auto',
              paddingTop: 12,
            },
          },
        })}
      >
        <Spin spinning={previewLoading} tip="正在加载文件">
          {previewError ? (
            <Alert
              type="error"
              showIcon
              message="预览失败"
              description={previewError}
            />
          ) : null}
          {!previewLoading && preview?.kind === 'pdf' && previewUrl ? (
            <iframe
              title={preview.fileName}
              src={previewUrl}
              style={{ width: '100%', height: '68vh', border: 0 }}
            />
          ) : null}
          {!previewLoading && preview?.kind === 'html' && preview.html.trim() ? (
            <>
              {preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="内容较长，仅显示前 20 万个字符"
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <DatasetHtmlPreviewFrame title={preview.fileName} html={preview.html} />
            </>
          ) : null}
          {!previewLoading && preview?.kind === 'document' ? (
            <>
              {preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message="内容较长，仅显示前 20 万个字符"
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>
                {preview.text || '文档没有可显示的文字内容'}
              </div>
            </>
          ) : null}
          {!previewLoading && preview?.kind === 'spreadsheet' ? (
            <>
              {preview.sheetName || preview.truncated ? (
                <Alert
                  type="info"
                  showIcon
                  message={
                    preview.sheetName
                      ? `工作表：${preview.sheetName}`
                      : '表格预览'
                  }
                  description={
                    preview.truncated
                      ? `仅显示前 200 行、50 列（原表共 ${preview.totalRows} 行、${preview.totalColumns} 列）`
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
                dataSource={preview.rows}
                locale={{ emptyText: '工作表为空' }}
                columns={[
                  {
                    title: '#',
                    width: 56,
                    fixed: 'left' as const,
                    render: (_value, _row, index) => index + 1,
                  },
                  ...Array.from(
                    { length: Math.min(preview.totalColumns, 50) },
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
        </Spin>
      </Modal>
    </div>
  );
}
