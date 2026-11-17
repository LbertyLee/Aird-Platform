import {
  ExperimentOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchSearchTestStatus,
  runSearchTest,
  type SearchTestResult,
  type SearchTestStatus,
} from '../api/admin';

const MODE_OPTIONS = [
  { value: 'knowledge', label: '知识库（验证学习效果）' },
  { value: 'mixed', label: '混合' },
  { value: 'exa', label: '联网' },
] as const;

const STAGE_STATUS: Record<string, { color: string; label: string }> = {
  completed: { color: 'green', label: '完成' },
  skipped: { color: 'default', label: '跳过' },
  failed: { color: 'red', label: '失败' },
  running: { color: 'blue', label: '执行中' },
  pending: { color: 'default', label: '等待' },
};

/**
 * 管理端搜索测试：接入学习成功后验证 Semantic / RAG / Text-to-SQL。
 */
export function SearchTestPage() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'mixed' | 'exa' | 'knowledge'>('knowledge');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<SearchTestStatus | null>(null);
  const [result, setResult] = useState<SearchTestResult | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchSearchTestStatus());
    } catch {
      // 状态非阻断
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onSearch = async () => {
    const q = query.trim();
    if (q.length < 2) {
      message.warning('请输入至少两个字符的测试问题');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await runSearchTest({ query: q, mode });
      setResult(res);
      if (!res.matchedLocally && mode === 'knowledge') {
        message.warning('知识库未命中本地证据，请确认接入任务已成功且分段已向量化');
      } else {
        message.success('搜索测试完成');
      }
    } catch {
      message.error('搜索测试失败，请检查 API / 向量库 / 模型配置');
    } finally {
      setLoading(false);
      void loadStatus();
    }
  };

  const sourceColumns: ColumnsType<SearchTestResult['sources'][number]> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: '来源',
      dataIndex: 'origin',
      width: 100,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'storageType',
      width: 110,
    },
    {
      title: '相关度',
      dataIndex: 'score',
      width: 90,
      render: (v?: number) =>
        typeof v === 'number' ? v.toFixed(3) : '—',
    },
    {
      title: '摘要',
      dataIndex: 'excerpt',
      ellipsis: true,
      render: (v?: string | null) => v || '—',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        知识库「接入任务」成功（学习完成）后，可在此用与研究端相同的 AI Query
        链路做检索验收。建议优先选「知识库」模式，确认向量命中与回答可溯源。
      </Typography.Paragraph>

      {status && (
        <Space wrap>
          <Tag color={status.vectorSearch ? 'success' : 'warning'}>
            向量检索 {status.vectorSearch ? '可用' : '未就绪'}
          </Tag>
          <Tag color={status.externalSearch ? 'success' : 'default'}>
            外部搜索 {status.externalSearch ? '已配置' : '未配置'}
          </Tag>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void loadStatus()}
          >
            刷新状态
          </Button>
        </Space>
      )}

      <Card size="small">
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            rows={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：这份文档讲了什么？ / 中国 2024 年 GDP 增速"
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void onSearch();
              }
            }}
          />
          <Space wrap>
            <Select
              style={{ width: 240 }}
              value={mode}
              onChange={setMode}
              options={[...MODE_OPTIONS]}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={loading}
              onClick={() => void onSearch()}
            >
              开始测试
            </Button>
            <Button
              icon={<ExperimentOutlined />}
              disabled={loading}
              onClick={() =>
                setQuery('这份知识库文档的主要内容是什么？请给出要点。')
              }
            >
              填入知识库样例
            </Button>
          </Space>
        </Space>
      </Card>

      {result && (
        <>
          <Alert
            type={result.matchedLocally ? 'success' : 'warning'}
            showIcon
            message={
              result.matchedLocally
                ? `已命中本地证据 · 模式 ${result.mode}`
                : `未命中本地证据 · 模式 ${result.mode}${result.usedExa ? ' · 已走外部搜索' : ''}`
            }
            description={
              <Space wrap size={4}>
                <span>runId: {result.runId}</span>
                {result.aiQueryId ? (
                  <span>· aiQueryId: {result.aiQueryId}</span>
                ) : null}
              </Space>
            }
          />

          <Card size="small" title="执行阶段">
            <Timeline
              items={result.stages.map((s) => {
                const meta = STAGE_STATUS[s.status] ?? {
                  color: 'gray',
                  label: s.status,
                };
                return {
                  color: meta.color,
                  children: (
                    <div>
                      <Space size={8}>
                        <Typography.Text strong>{s.label}</Typography.Text>
                        <Tag color={meta.color}>{meta.label}</Tag>
                      </Space>
                      {s.detail ? (
                        <Typography.Paragraph
                          type="secondary"
                          style={{ marginBottom: 0, marginTop: 4 }}
                        >
                          {s.detail}
                        </Typography.Paragraph>
                      ) : null}
                    </div>
                  ),
                };
              })}
            />
          </Card>

          <Card size="small" title="语义解析 / 查询计划">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="意图">
                {result.plan.intent}
              </Descriptions.Item>
              <Descriptions.Item label="置信度">
                {(result.plan.confidence * 100).toFixed(0)}%
              </Descriptions.Item>
              <Descriptions.Item label="指标" span={2}>
                {result.plan.indicators.join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="国家/地区" span={2}>
                {[...result.plan.countries, ...result.plan.regions]
                  .filter(Boolean)
                  .join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="实体" span={2}>
                {result.plan.entities.join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="时间" span={2}>
                {result.plan.timeRanges.join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="说明" span={2}>
                {result.plan.explanation || '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card size="small" title="AI 回答">
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {result.answer || '（无回答）'}
            </Typography.Paragraph>
          </Card>

          <Card size="small" title={`证据来源（${result.sources.length}）`}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              columns={sourceColumns}
              dataSource={result.sources}
              scroll={{ x: 900 }}
              locale={{ emptyText: '无证据来源' }}
            />
          </Card>
        </>
      )}
    </div>
  );
}
