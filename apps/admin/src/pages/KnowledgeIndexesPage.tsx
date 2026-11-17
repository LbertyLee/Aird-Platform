import {
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  cleanupKnowledgeIndex,
  fetchKnowledgeIndexFailed,
  fetchKnowledgeIndexOverview,
  incrementalKnowledgeIndex,
  purgeAllKnowledgeVectors,
  rebuildKnowledgeIndex,
  type KnowledgeIndexOverview,
  type KnowledgeItem,
} from '../api/admin';
import { useSessionStore } from '../stores/session';

const VECTOR_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'default' },
  processing: { label: '处理中', color: 'processing' },
  ready: { label: '已就绪', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

/**
 * 知识向量索引维护。
 */
export function KnowledgeIndexesPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [overview, setOverview] = useState<KnowledgeIndexOverview | null>(null);
  const [failed, setFailed] = useState<Awaited<
    ReturnType<typeof fetchKnowledgeIndexFailed>
  > | null>(null);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [ov, fail] = await Promise.all([
      fetchKnowledgeIndexOverview(),
      fetchKnowledgeIndexFailed({
        page: 1,
        pageSize: 50,
        keyword: keyword || undefined,
      }),
    ]);
    setOverview(ov);
    setFailed(fail);
  };

  useEffect(() => {
    void load();
  }, []);

  const runAction = async (
    action: 'rebuild' | 'incremental' | 'cleanup',
  ) => {
    setLoading(true);
    try {
      const res =
        action === 'rebuild'
          ? await rebuildKnowledgeIndex({ limit: 100 })
          : action === 'incremental'
            ? await incrementalKnowledgeIndex({ limit: 100 })
            : await cleanupKnowledgeIndex({ limit: 100 });
      message.success(`已处理 ${res.count} 条`);
      await load();
    } finally {
      setLoading(false);
    }
  };

  const onPurgeAll = (reindex: boolean) => {
    Modal.confirm({
      title: reindex ? '清空全部向量并立即重跑？' : '清空全部向量数据？',
      content: reindex
        ? '将删除 Milvus 知识分块向量、清空本地分块记录并重置状态，随后为已发布知识重新入队向量化。此操作不可撤销。'
        : '将删除 Milvus 知识分块向量、清空本地分块记录并重置向量状态。之后可再点「重建索引」或「清空并重跑」。此操作不可撤销。',
      okType: 'danger',
      okText: reindex ? '清空并重跑' : '确认清空',
      onOk: async () => {
        setLoading(true);
        try {
          const res = await purgeAllKnowledgeVectors({
            reindex,
            reindexLimit: 500,
          });
          message.success(
            reindex
              ? `已清空并入队：知识 ${res.knowledgeRequeued}（重置 ${res.knowledgeReset}）`
              : `已清空：知识重置 ${res.knowledgeReset}、分块删除 ${res.deletedChunks}`,
          );
          await load();
        } catch {
          message.error('清空向量失败，请检查 Milvus / API');
        } finally {
          setLoading(false);
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        {hasPermission('button:knowledge:index:rebuild') ? (
          <>
            <Button
              type="primary"
              loading={loading}
              onClick={() => void runAction('rebuild')}
            >
              重建索引
            </Button>
            <Button
              loading={loading}
              onClick={() => void runAction('incremental')}
            >
              增量更新
            </Button>
          </>
        ) : null}
        {hasPermission('button:knowledge:index:cleanup') ? (
          <>
            <Button
              danger
              loading={loading}
              onClick={() => void runAction('cleanup')}
            >
              脏数据清理
            </Button>
            <Button
              danger
              loading={loading}
              onClick={() => onPurgeAll(false)}
            >
              清空全部向量
            </Button>
            <Button
              danger
              type="primary"
              loading={loading}
              onClick={() => onPurgeAll(true)}
            >
              清空并重跑
            </Button>
          </>
        ) : null}
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <Row gutter={[16, 16]}>
        {[
          ['条目总数', overview?.total],
          ['已审核通过', overview?.approved],
          ['已发布', overview?.published],
          ['向量待处理', overview?.pending],
          ['向量处理中', overview?.processing],
          ['向量已就绪', overview?.ready],
          ['向量失败', overview?.failed],
        ].map(([title, value]) => (
          <Col xs={12} sm={8} md={6} key={String(title)}>
            <Card size="small">
              <Statistic title={title as string} value={value ?? 0} />
            </Card>
          </Col>
        ))}
      </Row>

      <Space wrap>
        <strong>失败列表</strong>
        <Input.Search
          placeholder="关键字"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => void load()}
          style={{ width: 240 }}
        />
      </Space>

      <Table
        rowKey="id"
        dataSource={failed?.items ?? []}
        pagination={{
          total: failed?.total,
          pageSize: failed?.pageSize,
          current: failed?.page,
        }}
        columns={[
          { title: '标题', dataIndex: 'title' },
          { title: '编码', dataIndex: 'code', width: 160 },
          {
            title: '向量状态',
            dataIndex: 'vectorStatus',
            width: 110,
            render: (v: string) => {
              const meta = VECTOR_STATUS[v];
              return (
                <Tag color={meta?.color || 'default'}>
                  {meta?.label || v}
                </Tag>
              );
            },
          },
          {
            title: '错误',
            dataIndex: 'vectorError',
            ellipsis: true,
          },
          {
            title: '分块数',
            dataIndex: 'chunkCount',
            width: 80,
          },
          {
            title: '更新时间',
            dataIndex: 'updatedAt',
            width: 180,
            render: (v: string, _row: KnowledgeItem) =>
              new Date(v).toLocaleString(),
          },
        ]}
        scroll={{ x: 900 }}
      />
    </Space>
  );
}
