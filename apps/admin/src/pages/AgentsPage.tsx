import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createAgent,
  deleteAgent,
  fetchAgentCategories,
  fetchAgents,
  updateAgent,
  type AgentCategoryOption,
  type AgentItem,
  type AgentPayload,
} from '../api/admin';

type AgentForm = AgentPayload;

export function AgentsPage() {
  const [rows, setRows] = useState<AgentItem[]>([]);
  const [categories, setCategories] = useState<AgentCategoryOption[]>([]);
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<AgentItem | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [form] = Form.useForm<AgentForm>();

  const iconOptions = [
    { value: '🤖', label: '🤖 机器人' },
    { value: '🧠', label: '🧠 智慧' },
    { value: '📚', label: '📚 学习' },
    { value: '✍️', label: '✍️ 写作' },
    { value: '🔍', label: '🔍 检索' },
    { value: '📊', label: '📊 分析' },
    { value: '💡', label: '💡 创意' },
    { value: '⚡', label: '⚡ 效率' },
  ];

  const categoryOptions = useMemo(
    () =>
      categories.map((item) => ({
        value: item.code,
        label: item.name,
      })),
    [categories],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchAgents(keyword || undefined));
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    try {
      setCategories(await fetchAgentCategories());
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      categoryCode: categoryOptions[0]?.value,
      icon: iconOptions[0].value,
      iconColor: '#dbeafe',
    });
    setOpen(true);
  };

  const openEdit = (record: AgentItem) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      categoryCode: record.categoryCode,
      icon: record.icon ?? undefined,
      iconColor: record.iconColor ?? undefined,
      status: record.status,
      sort: record.sort ?? 0,
    });
    setOpen(true);
  };

  const columns: ColumnsType<AgentItem> = [
    {
      title: '智能体名称',
      dataIndex: 'name',
      render: (name, record) => (
        <Space size={6}>
          <span>{name}</span>
          <Tag color={record.isPersonal ? 'purple' : 'blue'}>
            {record.isPersonal ? '个人' : '平台'}
          </Tag>
        </Space>
      ),
    },
    { title: '简介', dataIndex: 'description', ellipsis: true },
    {
      title: '分类',
      dataIndex: 'categoryName',
      render: (value) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '归属',
      render: (_, record) =>
        record.isPersonal
          ? record.owner?.displayName || record.owner?.username || record.author
          : '平台',
    },
    { title: '使用量', dataIndex: 'usageCount' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value) => (
        <Tag color={value === 'active' ? 'success' : 'default'}>
          {value === 'active' ? '上架' : '下架'}
        </Tag>
      ),
    },
    {
      title: '操作',
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除这个智能体？"
            onConfirm={() => void deleteAgent(record.id).then(load)}
          >
            <Button danger type="link" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const submit = async () => {
    const values = await form.validateFields();
    const payload: AgentPayload = {
      ...values,
      sort: Number(values.sort ?? 0),
    };
    if (editing) {
      await updateAgent(editing.id, payload);
    } else {
      await createAgent(payload);
    }
    setOpen(false);
    setEditing(null);
    message.success('保存成功');
    void load();
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 20,
          gap: 12,
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索名称、创建者或分类"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          style={{ maxWidth: 340 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增平台智能体
        </Button>
      </div>
      <Table
        loading={loading}
        rowKey="id"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
      />
      <Modal
        title={editing ? '编辑智能体' : '新增平台智能体'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label="简介">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="categoryCode"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select
              loading={categoriesLoading}
              options={categoryOptions}
              placeholder="请选择后台字典分类"
            />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Select options={iconOptions} placeholder="请选择图标" />
          </Form.Item>
          <Form.Item
            name="iconColor"
            label="图标颜色"
            getValueFromEvent={(color) => color.toHexString()}
          >
            <ColorPicker showText format="hex" />
          </Form.Item>
          {editing ? (
            <>
              <Form.Item name="status" label="状态">
                <Select
                  options={[
                    { value: 'active', label: '上架' },
                    { value: 'disabled', label: '下架' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="sort" label="排序">
                <InputNumber min={0} max={999999} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
