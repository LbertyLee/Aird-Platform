import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  message,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useEffect, useMemo, useState } from 'react';
import {
  createKnowledgeCategory,
  createKnowledgeTag,
  deleteKnowledgeCategory,
  deleteKnowledgeTag,
  fetchKnowledgeCategoryTree,
  fetchKnowledgeTags,
  updateKnowledgeCategory,
  updateKnowledgeTag,
  type KnowledgeCategoryNode,
  type KnowledgeTagItem,
} from '../api/admin';
import { withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

function flattenCategories(
  nodes: KnowledgeCategoryNode[],
  depth = 0,
): Array<KnowledgeCategoryNode & { depth: number }> {
  const rows: Array<KnowledgeCategoryNode & { depth: number }> = [];
  for (const node of nodes) {
    rows.push({ ...node, depth });
    if (node.children?.length) {
      rows.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return rows;
}

function toTreeData(nodes: KnowledgeCategoryNode[]): DataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    title: `${node.name} (${node.code})`,
    children: node.children?.length ? toTreeData(node.children) : undefined,
  }));
}

/**
 * 知识类目与标签管理。
 */
export function KnowledgeCategoriesPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [tree, setTree] = useState<KnowledgeCategoryNode[]>([]);
  const [tags, setTags] = useState<KnowledgeTagItem[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [editingCat, setEditingCat] =
    useState<(KnowledgeCategoryNode & { depth?: number }) | null>(null);
  const [editingTag, setEditingTag] = useState<KnowledgeTagItem | null>(null);
  const [catForm] = Form.useForm();
  const [tagForm] = Form.useForm();

  const flat = useMemo(() => flattenCategories(tree), [tree]);

  const load = async () => {
    const [categoryTree, tagPage] = await Promise.all([
      fetchKnowledgeCategoryTree(),
      fetchKnowledgeTags({ page: 1, pageSize: 100 }),
    ]);
    setTree(categoryTree);
    setTags(tagPage.items);
  };

  useEffect(() => {
    void load();
  }, []);

  const submitCategory = async () => {
    const values = await catForm.validateFields();
    if (editingCat) {
      await updateKnowledgeCategory(editingCat.id, {
        name: values.name,
        parentId: values.parentId || null,
        sort: values.sort ?? 0,
        status: values.status,
        description: values.description,
      });
      message.success('分类已更新');
    } else {
      await createKnowledgeCategory(values);
      message.success('分类已创建');
    }
    setCatOpen(false);
    await load();
  };

  const submitTag = async () => {
    const values = await tagForm.validateFields();
    if (editingTag) {
      await updateKnowledgeTag(editingTag.id, {
        name: values.name,
        status: values.status,
      });
      message.success('标签已更新');
    } else {
      await createKnowledgeTag(values);
      message.success('标签已创建');
    }
    setTagOpen(false);
    await load();
  };

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <strong>分类树</strong>
          {hasPermission('button:knowledge:category:create') ? (
            <Button
              type="primary"
              onClick={() => {
                setEditingCat(null);
                catForm.resetFields();
                catForm.setFieldsValue({ sort: 0, status: 'active' });
                setCatOpen(true);
              }}
            >
              新建分类
            </Button>
          ) : null}
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
        <Tree treeData={toTreeData(tree)} defaultExpandAll />
        <Table
          rowKey="id"
          size="small"
          dataSource={flat}
          pagination={false}
          scroll={{ x: 800 }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              render: (v: string, row) => (
                <span style={{ paddingLeft: row.depth * 16 }}>{v}</span>
              ),
            },
            { title: '编码', dataIndex: 'code', width: 160 },
            { title: '排序', dataIndex: 'sort', width: 80 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => (
                <Tag color={v === 'active' ? 'success' : 'default'}>{v}</Tag>
              ),
            },
            {
              title: '操作',
              width: 180,
              render: (_: unknown, row) => (
                <Space>
                  {hasPermission('button:knowledge:category:update') ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setEditingCat(row);
                        catForm.setFieldsValue({
                          name: row.name,
                          code: row.code,
                          parentId: row.parentId,
                          sort: row.sort,
                          status: row.status,
                          description: row.description,
                        });
                        setCatOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                  ) : null}
                  {hasPermission('button:knowledge:category:delete') ? (
                    <Button
                      size="small"
                      danger
                      onClick={async () => {
                        await deleteKnowledgeCategory(row.id);
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
      </Space>

      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <strong>标签</strong>
          {hasPermission('button:knowledge:tag:create') ? (
            <Button
              type="primary"
              onClick={() => {
                setEditingTag(null);
                tagForm.resetFields();
                tagForm.setFieldsValue({ status: 'active' });
                setTagOpen(true);
              }}
            >
              新建标签
            </Button>
          ) : null}
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={tags}
          pagination={false}
          scroll={{ x: 720 }}
          columns={[
            { title: '名称', dataIndex: 'name' },
            { title: '编码', dataIndex: 'code', width: 160 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v: string) => (
                <Tag color={v === 'active' ? 'success' : 'default'}>{v}</Tag>
              ),
            },
            {
              title: '操作',
              width: 180,
              render: (_: unknown, row: KnowledgeTagItem) => (
                <Space>
                  {hasPermission('button:knowledge:tag:update') ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setEditingTag(row);
                        tagForm.setFieldsValue(row);
                        setTagOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                  ) : null}
                  {hasPermission('button:knowledge:tag:delete') ? (
                    <Button
                      size="small"
                      danger
                      onClick={async () => {
                        await deleteKnowledgeTag(row.id);
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
      </Space>

      <Modal
        {...withFormModal({
          open: catOpen,
          title: editingCat ? '编辑分类' : '新建分类',
          onCancel: () => setCatOpen(false),
          onOk: () => void submitCategory(),
        })}
      >
        <Form form={catForm} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          {!editingCat ? (
            <Form.Item
              name="code"
              label="编码"
              rules={[{ required: true, message: '请输入编码' }]}
            >
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item name="parentId" label="父分类" className="admin-form-span-2">
            <Select
              allowClear
              options={flat
                .filter((item) => item.id !== editingCat?.id)
                .map((item) => ({
                  value: item.id,
                  label: `${'—'.repeat(item.depth)} ${item.name}`,
                }))}
            />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '禁用' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
            className="admin-form-span-2"
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          open: tagOpen,
          title: editingTag ? '编辑标签' : '新建标签',
          onCancel: () => setTagOpen(false),
          onOk: () => void submitTag(),
        })}
      >
        <Form form={tagForm} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          {!editingTag ? (
            <Form.Item
              name="code"
              label="编码"
              rules={[{ required: true, message: '请输入编码' }]}
            >
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '禁用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
