import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import { createSearchModel, deleteSearchModel, fetchSearchModels, updateSearchModel, type SearchModelItem } from '../api/admin';
import { useSessionStore } from '../stores/session';

export function SearchModelsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:system:search-model:create');
  const canUpdate = hasPermission('button:system:search-model:update');
  const canDelete = hasPermission('button:system:search-model:delete');
  const [items, setItems] = useState<SearchModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SearchModelItem | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => { setLoading(true); void fetchSearchModels().then(setItems).catch(() => message.error('模型配置加载失败')).finally(() => setLoading(false)); };
  useEffect(load, []);
  const submit = async () => {
    const values = await form.validateFields();
    if (editing) await updateSearchModel(editing.id, values); else await createSearchModel(values);
    message.success('保存成功'); setOpen(false); load();
  };
  return <div style={{ padding: 24 }}>
    <Space style={{ marginBottom: 16 }}><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>{canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setOpen(true); }}>新增模型</Button>}</Space>
    <Table rowKey="id" loading={loading} dataSource={items} columns={[
      { title: '显示名称', dataIndex: 'label' }, { title: '模型标识', dataIndex: 'value' }, { title: '排序', dataIndex: 'sort' },
      { title: '状态', dataIndex: 'status', render: (status: SearchModelItem['status']) => <Tag color={status === 'active' ? 'success' : 'default'}>{status === 'active' ? '启用' : '停用'}</Tag> },
      { title: '操作', render: (_: unknown, record: SearchModelItem) => <Space>{canUpdate && <Button type="link" onClick={() => { setEditing(record); form.setFieldsValue(record); setOpen(true); }}>编辑</Button>}{canDelete && <Button type="link" danger onClick={() => void Modal.confirm({ title: '删除模型配置？', onOk: async () => { await deleteSearchModel(record.id); load(); } })}>删除</Button>}</Space> },
    ]} />
    <Modal title={editing ? '编辑模型' : '新增模型'} open={open} onCancel={() => setOpen(false)} onOk={() => void submit()}>
      <Form form={form} layout="vertical"><Form.Item name="label" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="value" label="模型标识" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="sort" label="排序" initialValue={0}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>{editing && <Form.Item name="status" label="状态"><Select options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]} /></Form.Item>}</Form>
    </Modal>
  </div>;
}
