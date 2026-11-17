import { UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Upload,
  message,
  type UploadFile,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DatasetHtmlPreviewFrame } from '../components/DatasetHtmlPreviewFrame';
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  fetchKnowledgeCategoryTree,
  fetchKnowledgeItemFile,
  fetchKnowledgeItemPreview,
  fetchKnowledgeItems,
  fetchKnowledgeTags,
  publishKnowledgeItem,
  unpublishKnowledgeItem,
  updateKnowledgeItem,
  uploadKnowledgeFile,
  type DatasetFilePreview,
  type KnowledgeCategoryNode,
  type KnowledgeItem,
  type KnowledgeTagItem,
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

const PUBLISH_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  unpublished: '已下架',
};

const KNOWLEDGE_FILE_ACCEPT = '.pdf,.csv,.xls,.xlsx,.doc,.docx,.txt,.md,.markdown,.html,.htm,.json';
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function flattenCategories(
  nodes: KnowledgeCategoryNode[],
): Array<{ id: string; name: string }> {
  const rows: Array<{ id: string; name: string }> = [];
  for (const node of nodes) {
    rows.push({ id: node.id, name: node.name });
    if (node.children?.length) {
      rows.push(...flattenCategories(node.children));
    }
  }
  return rows;
}

function buildCodeFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const normalized = base
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const stamp = Date.now().toString(36);
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8) ||
    Math.random().toString(36).slice(2, 10);
  return `kb-${normalized || 'doc'}-${stamp}-${random}`;
}

function isKnowledgeCodeExistsError(error: unknown): boolean {
  const response = (error as { response?: { data?: { code?: string } } })?.response;
  return response?.data?.code === 'KNOWLEDGE_CODE_EXISTS';
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

/**
 * 知识权限配置：可见性、发布，以及条目创建/上传入口。
 */
export function KnowledgePermissionsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:knowledge:item:create');
  const canUpload = hasPermission('button:knowledge:item:upload');
  const [keyword, setKeyword] = useState('');
  const [visibility, setVisibility] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchKnowledgeItems>
  > | null>(null);
  const [categories, setCategories] = useState<KnowledgeCategoryNode[]>([]);
  const [tags, setTags] = useState<KnowledgeTagItem[]>([]);
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Modal onOk can fire twice before React commits the submitting state.
  // Keep a synchronous guard so one click sequence creates only one item.
  const submitInFlightRef = useRef(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<DatasetFilePreview | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [uploadForm] = Form.useForm();

  const categoryOptions = useMemo(
    () => flattenCategories(categories),
    [categories],
  );

  const load = async () => {
    const [items, tree, tagPage] = await Promise.all([
      fetchKnowledgeItems({
        page: 1,
        pageSize: 50,
        keyword: keyword || undefined,
        visibility,
      }),
      fetchKnowledgeCategoryTree(),
      fetchKnowledgeTags({ page: 1, pageSize: 100 }),
    ]);
    setData(items);
    setCategories(tree);
    setTags(tagPage.items);
  };

  useEffect(() => {
    void load();
  }, [visibility]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

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
      const result = await fetchKnowledgeItemPreview(row.id);
      setPreview(result);
      if (result.kind === 'pdf') {
        const blob = await fetchKnowledgeItemFile(row.id);
        setPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '文件预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setPendingFile(null);
    setFileList([]);
    form.resetFields();
    form.setFieldsValue({ visibility: 'private' });
    setOpen(true);
  };

  const openUploadEntry = () => {
    setPendingFile(null);
    setFileList([]);
    uploadForm.resetFields();
    uploadForm.setFieldsValue({ visibility: 'private' });
    setUploadOpen(true);
  };

  const validateFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件大小不能超过 20 MB');
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (submitInFlightRef.current) return;
    const values = await form.validateFields();
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      if (editing) {
        await updateKnowledgeItem(editing.id, values);
        if (pendingFile && canUpload) {
          await uploadKnowledgeFile(editing.id, pendingFile);
          message.success('已更新并上传文件，需重新审核');
        } else {
          message.success('已更新，公开内容自动审核通过');
        }
      } else {
        const created = await createKnowledgeItem(values);
        if (pendingFile && canUpload) {
          await uploadKnowledgeFile(created.id, pendingFile);
          message.success('已创建并上传文件，自动审核通过');
        } else {
          message.success('已创建，自动审核通过');
        }
      }
      setOpen(false);
      setPendingFile(null);
      setFileList([]);
      await load();
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  const submitUpload = async () => {
    if (submitInFlightRef.current) return;
    if (!pendingFile) {
      message.warning('请先选择要上传的文件');
      return;
    }
    const values = await uploadForm.validateFields();
    submitInFlightRef.current = true;
    setSubmitting(true);
    try {
      const title = (values.title as string)?.trim() || pendingFile.name;
      const code =
        (values.code as string)?.trim() ||
        buildCodeFromFileName(pendingFile.name);
      const payload = {
        title,
        code,
        summary: values.summary,
        visibility: values.visibility,
        categoryId: values.categoryId,
        tagIds: values.tagIds,
      };
      let created;
      try {
        created = await createKnowledgeItem(payload);
      } catch (error) {
        // An old tab may retain an auto-generated code from a prior upload.
        // Regenerate only auto-generated codes; preserve an explicitly entered code.
        if (!code.startsWith('kb-') || !isKnowledgeCodeExistsError(error)) {
          throw error;
        }
        created = await createKnowledgeItem({
          ...payload,
          code: buildCodeFromFileName(pendingFile.name),
        });
      }
      await uploadKnowledgeFile(created.id, pendingFile);
      message.success('已上传并提交审核');
      setUploadOpen(false);
      setPendingFile(null);
      setFileList([]);
      await load();
    } finally {
      setSubmitting(false);
      submitInFlightRef.current = false;
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          allowClear
          placeholder="可见性"
          style={{ width: 140 }}
          value={visibility}
          onChange={setVisibility}
          options={[
            { value: 'public', label: '公开' },
            { value: 'private', label: '私有' },
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
        {canCreate && canUpload ? (
          <Button type="primary" icon={<UploadOutlined />} onClick={openUploadEntry}>
            上传知识文件
          </Button>
        ) : null}
        {canCreate ? (
          <Button onClick={openCreate}>新建知识条目</Button>
        ) : null}
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
        scroll={{ x: 1200 }}
        columns={[
          { title: '标题', dataIndex: 'title' },
          { title: '编码', dataIndex: 'code', width: 160 },
          {
            title: '文件',
            dataIndex: 'fileName',
            width: 180,
            ellipsis: true,
            render: (v: string | null, row: KnowledgeItem) =>
              v ? (
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => void openPreview(row)}
                >
                  {v}
                </Button>
              ) : (
                '-'
              ),
          },
          {
            title: '可见性',
            dataIndex: 'visibility',
            width: 90,
            render: (v: string) => (v === 'public' ? '公开' : '私有'),
          },
          {
            title: '审核',
            dataIndex: 'auditStatus',
            width: 90,
            render: (v: string) => <Tag>{AUDIT_LABEL[v] || v}</Tag>,
          },
          {
            title: '发布',
            dataIndex: 'publishStatus',
            width: 90,
            render: (v: string) => <Tag>{PUBLISH_LABEL[v] || v}</Tag>,
          },
          {
            title: '分类',
            width: 120,
            render: (_: unknown, row: KnowledgeItem) =>
              row.category?.name || '-',
          },
          {
            title: '操作',
            width: 240,
            fixed: 'right' as const,
            render: (_: unknown, row: KnowledgeItem) => (
              <Space size={0} wrap>
                <Button type="link" size="small" onClick={() => void openPreview(row)}>
                  预览
                </Button>
                {hasPermission('button:knowledge:item:update') ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setEditing(row);
                      setPendingFile(null);
                      setFileList([]);
                      form.setFieldsValue({
                        title: row.title,
                        summary: row.summary,
                        content: row.content,
                        visibility: row.visibility,
                        categoryId: row.categoryId,
                        tagIds: row.tags.map((t) => t.id),
                      });
                      setOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                ) : null}
                {canUpload ? (
                  <Upload
                    showUploadList={false}
                    accept={KNOWLEDGE_FILE_ACCEPT}
                    beforeUpload={async (file) => {
                      if (!validateFile(file)) return false;
                      setUploadingId(row.id);
                      try {
                        await uploadKnowledgeFile(row.id, file);
                        message.success('上传成功，需重新审核');
                        await load();
                      } finally {
                        setUploadingId(null);
                      }
                      return false;
                    }}
                  >
                    <Button type="link" size="small" loading={uploadingId === row.id}>
                      {row.fileName ? '替换' : '上传'}
                    </Button>
                  </Upload>
                ) : null}
                {hasPermission('button:knowledge:item:publish') &&
                row.auditStatus === 'approved' &&
                row.publishStatus !== 'published' ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={async () => {
                      await publishKnowledgeItem(row.id);
                      message.success('已发布并入队向量化');
                      await load();
                    }}
                  >
                    发布
                  </Button>
                ) : null}
                {hasPermission('button:knowledge:item:publish') &&
                row.publishStatus === 'published' ? (
                  <Button
                    type="link"
                    size="small"
                    onClick={async () => {
                      await unpublishKnowledgeItem(row.id);
                      message.success('已下架');
                      await load();
                    }}
                  >
                    下架
                  </Button>
                ) : null}
                {hasPermission('button:knowledge:item:delete') ? (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={async () => {
                      await deleteKnowledgeItem(row.id);
                      message.success('已删除');
                      await load();
                    }}
                  >
                    删除
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        {...withFormModal({
          open,
          title: editing ? '编辑知识条目' : '新建知识条目',
          onCancel: () => {
            setOpen(false);
            setPendingFile(null);
            setFileList([]);
          },
          onOk: () => void submit(),
          confirmLoading: submitting,
          width: FORM_MODAL_WIDTH_LG,
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input />
          </Form.Item>
          {!editing ? (
            <Form.Item
              name="code"
              label="编码"
              rules={[{ required: true, message: '请输入编码' }]}
            >
              <Input placeholder="字母数字下划线等" />
            </Form.Item>
          ) : null}
          <Form.Item
            name="visibility"
            label="可见性"
            rules={[{ required: true, message: '请选择可见性' }]}
          >
            <Select
              options={[
                { value: 'public', label: '公开' },
                { value: 'private', label: '私有' },
              ]}
            />
          </Form.Item>
          <Form.Item name="categoryId" label="分类">
            <Select
              allowClear
              options={categoryOptions.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="tagIds" label="标签" className="admin-form-span-2">
            <Select
              mode="multiple"
              allowClear
              options={tags.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
          <Form.Item name="summary" label="摘要" className="admin-form-span-2">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="content" label="正文" className="admin-form-span-2">
            <Input.TextArea rows={5} />
          </Form.Item>
          {canUpload ? (
            <Form.Item
              label={editing?.fileName ? `附件（当前：${editing.fileName}）` : '附件'}
              className="admin-form-span-2"
              extra="支持 PDF / CSV / XLS / XLSX / DOC / DOCX / TXT / MD / HTML / JSON，最大 20MB"
            >
              <Upload.Dragger
                accept={KNOWLEDGE_FILE_ACCEPT}
                maxCount={1}
                fileList={fileList}
                beforeUpload={(file) => {
                  if (!validateFile(file)) return Upload.LIST_IGNORE;
                  setPendingFile(file);
                  setFileList([
                    {
                      uid: file.uid,
                      name: file.name,
                      status: 'done',
                    },
                  ]);
                  if (!editing && !form.getFieldValue('title')) {
                    form.setFieldsValue({ title: file.name });
                  }
                  if (!editing) {
                    form.setFieldsValue({
                      code: buildCodeFromFileName(file.name),
                    });
                  }
                  return false;
                }}
                onRemove={() => {
                  setPendingFile(null);
                  setFileList([]);
                }}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此处</p>
              </Upload.Dragger>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          open: uploadOpen,
          title: '上传知识文件',
          onCancel: () => {
            setUploadOpen(false);
            setPendingFile(null);
            setFileList([]);
          },
          onOk: () => void submitUpload(),
          confirmLoading: submitting,
          okText: '上传并提交审核',
          width: FORM_MODAL_WIDTH_LG,
        })}
      >
        <Form form={uploadForm} layout="vertical" className="admin-form-grid">
          <Form.Item
            label="知识文件"
            required
            className="admin-form-span-2"
            extra="上传后将自动创建知识条目并通过审核"
          >
            <Upload.Dragger
              accept={KNOWLEDGE_FILE_ACCEPT}
              maxCount={1}
              fileList={fileList}
              beforeUpload={(file) => {
                if (!validateFile(file)) return Upload.LIST_IGNORE;
                setPendingFile(file);
                setFileList([
                  {
                    uid: file.uid,
                    name: file.name,
                    status: 'done',
                  },
                ]);
                if (!uploadForm.getFieldValue('title')) {
                  uploadForm.setFieldsValue({ title: file.name });
                }
                if (!uploadForm.getFieldValue('code')) {
                  uploadForm.setFieldsValue({
                    code: buildCodeFromFileName(file.name),
                  });
                }
                return false;
              }}
              onRemove={() => {
                setPendingFile(null);
                setFileList([]);
              }}
            >
              <p className="ant-upload-drag-icon">
                <UploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint">
                支持 PDF / CSV / XLS / XLSX / DOC / DOCX / TXT / MD / HTML / JSON，最大 20MB
              </p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input placeholder="默认使用文件名" />
          </Form.Item>
          <Form.Item name="code" label="编码">
            <Input placeholder="可自动生成" />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="可见性"
            rules={[{ required: true, message: '请选择可见性' }]}
          >
            <Select
              options={[
                { value: 'public', label: '公开' },
                { value: 'private', label: '私有' },
              ]}
            />
          </Form.Item>
          <Form.Item name="categoryId" label="分类">
            <Select
              allowClear
              options={categoryOptions.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="tagIds" label="标签" className="admin-form-span-2">
            <Select
              mode="multiple"
              allowClear
              options={tags.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
          <Form.Item name="summary" label="摘要" className="admin-form-span-2">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
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
    </Space>
  );
}
