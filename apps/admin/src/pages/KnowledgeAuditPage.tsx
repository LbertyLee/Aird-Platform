import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import { DatasetHtmlPreviewFrame } from '../components/DatasetHtmlPreviewFrame';
import {
  approveKnowledgeItem,
  fetchKnowledgeAuditDetail,
  fetchKnowledgeAuditFile,
  fetchKnowledgeAuditPreview,
  fetchKnowledgeAudits,
  rejectKnowledgeItem,
  type DatasetFilePreview,
  type KnowledgeAuditDetail,
  type KnowledgeItem,
} from '../api/admin';
import {
  FORM_MODAL_WIDTH_LG,
  PREVIEW_MODAL_WIDTH,
  withFormModal,
} from '../components/form-modal';
import { useSessionStore } from '../stores/session';

const AUDIT_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

const AUDIT_COLOR: Record<string, string> = {
  pending: 'processing',
  approved: 'success',
  rejected: 'error',
};

const SOURCE_LABEL: Record<string, string> = {
  admin: '管理端创建',
  research_upload: '研究端上传',
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

/**
 * 知识入库审核。
 */
export function KnowledgeAuditPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [keyword, setKeyword] = useState('');
  const [auditStatus, setAuditStatus] = useState('pending');
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchKnowledgeAudits>
  > | null>(null);
  const [detail, setDetail] = useState<KnowledgeAuditDetail | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<KnowledgeItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<DatasetFilePreview | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    const res = await fetchKnowledgeAudits({
      page: 1,
      pageSize: 50,
      keyword: keyword || undefined,
      auditStatus: auditStatus || undefined,
    });
    setData(res);
  };

  useEffect(() => {
    void load();
  }, [auditStatus]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const openDetail = async (id: string) => {
    const res = await fetchKnowledgeAuditDetail(id);
    setDetail(res);
  };

  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(false);
  };

  const openPreview = async (row: KnowledgeItem) => {
    if (!row.fileName && !row.content && !row.summary) {
      message.warning('该条目没有可预览的文件或正文');
      return;
    }

    // 无文件时直接预览正文/摘要
    if (!row.fileName) {
      setPreview({
        kind: 'document',
        fileName: row.title,
        text: [row.summary, row.content].filter(Boolean).join('\n\n') || '',
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
      const result = await fetchKnowledgeAuditPreview(row.id);
      setPreview(result);
      if (result.kind === 'pdf') {
        const blob = await fetchKnowledgeAuditFile(row.id);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '文件预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const onApprove = async (row: KnowledgeItem) => {
    await approveKnowledgeItem(row.id);
    message.success('已通过审核');
    setDetail(null);
    await load();
  };

  const onReject = async () => {
    const values = await form.validateFields();
    if (!rejectTarget) return;
    await rejectKnowledgeItem(rejectTarget.id, values.reason);
    message.success('已驳回');
    setRejectOpen(false);
    setRejectTarget(null);
    setDetail(null);
    await load();
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 140 }}
          value={auditStatus}
          onChange={setAuditStatus}
          options={[
            { value: 'pending', label: '待审核' },
            { value: 'approved', label: '已通过' },
            { value: 'rejected', label: '已驳回' },
          ]}
        />
        <Input.Search
          placeholder="关键字"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => void load()}
          style={{ width: 240 }}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <Table
        rowKey="id"
        dataSource={data?.items ?? []}
        pagination={{
          total: data?.total,
          pageSize: data?.pageSize,
          current: data?.page,
        }}
        scroll={{ x: 1100 }}
        columns={[
          { title: '标题', dataIndex: 'title' },
          { title: '编码', dataIndex: 'code', width: 180 },
          {
            title: '来源',
            dataIndex: 'sourceType',
            width: 120,
            render: (v: string) => SOURCE_LABEL[v] || v,
          },
          {
            title: '提交人',
            width: 120,
            render: (_: unknown, row: KnowledgeItem) =>
              row.submitter?.displayName || row.submitter?.username || '匿名',
          },
          {
            title: '审核状态',
            dataIndex: 'auditStatus',
            width: 100,
            render: (v: string) => (
              <Tag color={AUDIT_COLOR[v]}>{AUDIT_LABEL[v] || v}</Tag>
            ),
          },
          {
            title: '操作',
            width: 200,
            render: (_: unknown, row: KnowledgeItem) => (
              <Space size={4} wrap>
                <Button type="link" size="small" onClick={() => void openDetail(row.id)}>
                  详情
                </Button>
                <Button type="link" size="small" onClick={() => void openPreview(row)}>
                  预览
                </Button>
                {row.auditStatus === 'pending' &&
                hasPermission('button:knowledge:audit:approve') ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => void onApprove(row)}
                  >
                    通过
                  </Button>
                ) : null}
                {row.auditStatus === 'pending' &&
                hasPermission('button:knowledge:audit:reject') ? (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={() => {
                      setRejectTarget(row);
                      form.resetFields();
                      setRejectOpen(true);
                    }}
                  >
                    驳回
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        {...withFormModal({
          open: !!detail,
          title: '审核详情 / 来源溯源',
          width: FORM_MODAL_WIDTH_LG,
          onCancel: () => setDetail(null),
          footer:
            detail?.auditStatus === 'pending' ? (
              <Space>
                <Button onClick={() => setDetail(null)}>关闭</Button>
                {detail.fileName || detail.content || detail.summary ? (
                  <Button onClick={() => void openPreview(detail)}>
                    预览内容
                  </Button>
                ) : null}
                {hasPermission('button:knowledge:audit:reject') ? (
                  <Button
                    danger
                    onClick={() => {
                      setRejectTarget(detail);
                      form.resetFields();
                      setRejectOpen(true);
                    }}
                  >
                    驳回
                  </Button>
                ) : null}
                {hasPermission('button:knowledge:audit:approve') ? (
                  <Button type="primary" onClick={() => void onApprove(detail)}>
                    通过
                  </Button>
                ) : null}
              </Space>
            ) : (
              <Space>
                <Button onClick={() => setDetail(null)}>关闭</Button>
                {detail?.fileName || detail?.content || detail?.summary ? (
                  <Button onClick={() => void openPreview(detail!)}>
                    预览内容
                  </Button>
                ) : null}
              </Space>
            ),
        })}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="标题">{detail.title}</Descriptions.Item>
              <Descriptions.Item label="编码">{detail.code}</Descriptions.Item>
              <Descriptions.Item label="来源">
                {SOURCE_LABEL[detail.sourceType] || detail.sourceType}
              </Descriptions.Item>
              <Descriptions.Item label="可见性">
                {detail.visibility === 'public' ? '公开' : '私有'}
              </Descriptions.Item>
              <Descriptions.Item label="提交人">
                {detail.submitter?.displayName ||
                  detail.submitter?.username ||
                  '匿名'}
              </Descriptions.Item>
              <Descriptions.Item label="文件">
                {detail.fileName ? (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => void openPreview(detail)}
                  >
                    {detail.fileName}
                  </Button>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="摘要" span={2}>
                {detail.summary || '-'}
              </Descriptions.Item>
              {detail.content ? (
                <Descriptions.Item label="正文" span={2}>
                  <div
                    style={{
                      maxHeight: 160,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {detail.content}
                  </div>
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="来源元数据" span={2}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(detail.sourceMeta ?? {}, null, 2)}
                </pre>
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.auditHistory}
              columns={[
                {
                  title: '动作',
                  dataIndex: 'action',
                  width: 100,
                  render: (v: string) =>
                    (
                      {
                        approve: '通过',
                        reject: '驳回',
                        resubmit: '重提',
                      } as Record<string, string>
                    )[v] || v,
                },
                {
                  title: '操作人',
                  render: (_: unknown, row) =>
                    row.actor?.displayName || row.actor?.username || '-',
                },
                { title: '备注', dataIndex: 'remark' },
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 180,
                  render: (v: string) => new Date(v).toLocaleString(),
                },
              ]}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal
        {...withFormModal({
          title: preview?.fileName || '内容预览',
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

      <Modal
        {...withFormModal({
          open: rejectOpen,
          title: '驳回知识条目',
          onCancel: () => setRejectOpen(false),
          onOk: () => void onReject(),
          okText: '确认驳回',
          okButtonProps: { danger: true },
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="reason"
            label="驳回原因"
            className="admin-form-span-2"
            rules={[{ required: true, message: '请填写驳回原因' }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
