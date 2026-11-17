import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  bindLevelBenefits,
  createLevel,
  disableLevel,
  fetchBenefitDefs,
  fetchLevels,
  updateLevel,
  type LevelItem,
} from '../api/admin';
import { withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

/** 1G = 1024^3 字节 */
const BYTES_PER_G = 1024 ** 3;

const SCOPE_LABEL: Record<string, string> = {
  user: '个人',
};

const BENEFIT_LABEL: Record<string, string> = {
  search_quota: '检索次数',
  export_quota: '导出次数',
  max_agents: 'Agent 数量',
  storage_bytes: '存储容量',
};

/**
 * 字节转 G（保留最多 2 位小数）。
 */
function bytesToG(bytes: number): number {
  if (!bytes) return 0;
  const g = bytes / BYTES_PER_G;
  return Math.round(g * 100) / 100;
}

/**
 * G 转字节。
 */
function gToBytes(g: number): number {
  return Math.round(Number(g || 0) * BYTES_PER_G);
}

/**
 * 格式化权益摘要（存储以 G 展示）。
 */
function formatBenefitsSummary(
  benefits: LevelItem['benefits'],
  defs: Array<{ code: string; name: string; valueType: string }>,
): string {
  if (!benefits?.length) return '-';
  const defMap = new Map(defs.map((d) => [d.code, d]));
  return benefits
    .map((b) => {
      const def = defMap.get(b.benefitCode);
      const label =
        BENEFIT_LABEL[b.benefitCode] || def?.name || b.benefitCode;
      const raw = b.valueJson as { n?: number; bytes?: number };
      if (def?.valueType === 'bytes' || b.benefitCode === 'storage_bytes') {
        return `${label} ${bytesToG(Number(raw.bytes ?? 0))}G`;
      }
      return `${label} ${raw.n ?? 0}`;
    })
    .join(' · ');
}

/**
 * 会员等级管理：状态中文展示，权益摘要与存储容量以 G 为单位。
 */
export function LevelsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchLevels>> | null>(
    null,
  );
  const [defs, setDefs] = useState<
    Awaited<ReturnType<typeof fetchBenefitDefs>>
  >([]);
  const [open, setOpen] = useState(false);
  const [benefitOpen, setBenefitOpen] = useState(false);
  const [editing, setEditing] = useState<LevelItem | null>(null);
  const [current, setCurrent] = useState<LevelItem | null>(null);
  const [form] = Form.useForm();
  const [benefitForm] = Form.useForm();

  const load = async () => {
    const [levels, benefitDefs] = await Promise.all([
      fetchLevels({ page: 1, pageSize: 50 }),
      fetchBenefitDefs(),
    ]);
    setData(levels);
    setDefs(benefitDefs);
  };

  useEffect(() => {
    void load();
  }, []);

  const submitLevel = async () => {
    const values = await form.validateFields();
    if (editing) {
      await updateLevel(editing.id, values);
      message.success('已更新');
    } else {
      await createLevel(values);
      message.success('已创建');
    }
    setOpen(false);
    await load();
  };

  const openBenefits = (row: LevelItem) => {
    setCurrent(row);
    const values: Record<string, number> = {};
    for (const b of row.benefits ?? []) {
      const raw = b.valueJson as { n?: number; bytes?: number };
      const def = defs.find((d) => d.code === b.benefitCode);
      if (def?.valueType === 'bytes' || b.benefitCode === 'storage_bytes') {
        values[b.benefitCode] = bytesToG(Number(raw.bytes ?? 0));
      } else {
        values[b.benefitCode] = Number(raw.n ?? 0);
      }
    }
    benefitForm.setFieldsValue(values);
    setBenefitOpen(true);
  };

  const submitBenefits = async () => {
    if (!current) return;
    const values = await benefitForm.validateFields();
    const items = defs.map((d) => {
      const n = Number(values[d.code] ?? 0);
      if (d.valueType === 'bytes' || d.code === 'storage_bytes') {
        return {
          benefitCode: d.code,
          valueJson: { bytes: gToBytes(n) },
        };
      }
      return {
        benefitCode: d.code,
        valueJson: { n },
      };
    });
    await bindLevelBenefits(current.id, items);
    message.success('权益已保存');
    setBenefitOpen(false);
    await load();
  };

  const benefitFieldLabel = (d: {
    code: string;
    name: string;
    valueType: string;
    unit: string | null;
  }) => {
    const name = BENEFIT_LABEL[d.code] || d.name;
    if (d.valueType === 'bytes' || d.code === 'storage_bytes') {
      return `${name}（单位：G）`;
    }
    if (d.code === 'search_quota' || d.code === 'export_quota') {
      return `${name}（次）`;
    }
    if (d.code === 'max_agents') {
      return `${name}（个）`;
    }
    return name;
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          onClick={() => {
            setEditing(null);
            form.resetFields();
            form.setFieldsValue({ scope: 'user', price: 0 });
            setOpen(true);
          }}
        >
          新建等级
        </Button>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table
        rowKey="id"
        dataSource={data?.items ?? []}
        pagination={false}
        scroll={{ x: 1100 }}
        columns={[
          { title: '编码', dataIndex: 'code', width: 120 },
          { title: '名称', dataIndex: 'name', width: 140 },
          {
            title: '适用范围',
            dataIndex: 'scope',
            width: 120,
            render: (v: string) => SCOPE_LABEL[v] || v,
          },
          {
            title: '价格',
            dataIndex: 'price',
            width: 100,
            render: (v) => `¥${Number(v).toFixed(2)}`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (v: string) => (
              <Tag color={v === 'active' ? 'success' : 'default'}>
                {v === 'active' ? '启用' : '停用'}
              </Tag>
            ),
          },
          {
            title: '权益摘要',
            render: (_, row) => (
              <Typography.Text style={{ fontSize: 13 }}>
                {formatBenefitsSummary(row.benefits, defs)}
              </Typography.Text>
            ),
          },
          {
            title: '操作',
            width: 240,
            render: (_, row) => (
              <Space wrap>
                <Button
                  size="small"
                  onClick={() => {
                    setEditing(row);
                    form.setFieldsValue({
                      name: row.name,
                      scope: row.scope,
                      price: Number(row.price),
                      description: row.description,
                    });
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                {hasPermission('button:membership:bind_benefit') ? (
                  <Button size="small" onClick={() => openBenefits(row)}>
                    权益配置
                  </Button>
                ) : null}
                {row.status === 'active' && row.code !== 'free' ? (
                  <Button
                    size="small"
                    danger
                    onClick={async () => {
                      await disableLevel(row.id);
                      message.success('已下架');
                      await load();
                    }}
                  >
                    下架
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        {...withFormModal({
          title: editing ? '编辑等级' : '新建等级',
          open,
          onOk: () => void submitLevel(),
          onCancel: () => setOpen(false),
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          {!editing ? (
            <Form.Item name="code" label="编码" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item name="name" label="等级名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="scope" label="适用范围" initialValue="user" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="price"
            label="价格（元）"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              step={0.01}
              precision={2}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="说明"
            className="admin-form-span-2"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          title: `权益配置 - ${current?.name ?? ''}`,
          open: benefitOpen,
          onOk: () => void submitBenefits(),
          onCancel: () => setBenefitOpen(false),
        })}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          存储容量请按 G 填写，保存时自动换算为字节入库。
        </Typography.Paragraph>
        <Form form={benefitForm} layout="vertical" className="admin-form-grid">
          {defs.map((d) => (
            <Form.Item
              key={d.code}
              name={d.code}
              label={benefitFieldLabel(d)}
              rules={[{ required: true, message: '请填写' }]}
            >
              <InputNumber
                min={0}
                precision={
                  d.valueType === 'bytes' || d.code === 'storage_bytes' ? 2 : 0
                }
                addonAfter={
                  d.valueType === 'bytes' || d.code === 'storage_bytes'
                    ? 'G'
                    : undefined
                }
                style={{ width: '100%' }}
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </div>
  );
}
