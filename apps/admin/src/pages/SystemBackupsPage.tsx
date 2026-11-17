import {
  CloudUploadOutlined,
  ReloadOutlined,
  RollbackOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Input,
  Modal,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchBackupJobs,
  fetchBackupStatus,
  restoreSystemBackup,
  runSystemBackup,
  updateBackupSchedule,
  type BackupJobItem,
  type BackupStatus,
} from '../api/admin';
import { useSessionStore } from '../stores/session';

const STATUS_META: Record<
  string,
  { label: string; color: 'processing' | 'success' | 'error' | 'default' }
> = {
  pending: { label: '排队中', color: 'default' },
  running: { label: '备份中', color: 'processing' },
  success: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatBytes(raw: string | null | undefined): string {
  if (!raw) return '-';
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return raw;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 系统数据备份：自动调度、历史、手动备份与一键恢复。
 */
export function SystemBackupsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canRun = hasPermission('button:system:backup:run');
  const canRestore = hasPermission('button:system:backup:restore');

  const [statusLoading, setStatusLoading] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<{
    items: BackupJobItem[];
    total: number;
  } | null>(null);

  const [restoreTarget, setRestoreTarget] = useState<BackupJobItem | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState('');

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await fetchBackupStatus());
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载备份状态失败');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchBackupJobs({ page, pageSize });
      setData({ items: res.items, total: res.total });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载备份列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadJobs()]);
  }, [loadStatus, loadJobs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.isRunning && !status?.isRestoring) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status?.isRunning, status?.isRestoring, refresh]);

  const onRun = async () => {
    setRunning(true);
    try {
      await runSystemBackup();
      message.success('已开始备份，完成后列表会自动刷新');
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '触发备份失败');
    } finally {
      setRunning(false);
    }
  };

  const onToggleAutoBackup = async (enabled: boolean) => {
    setToggling(true);
    try {
      const next = await updateBackupSchedule(enabled);
      setStatus(next);
      message.success(enabled ? '已开启自动备份' : '已关闭自动备份');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '更新自动备份失败');
      await refresh();
    } finally {
      setToggling(false);
    }
  };

  const onConfirmRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const res = await restoreSystemBackup(restoreTarget.id, confirmText);
      message.warning(res.message);
      setRestoreTarget(null);
      setConfirmText('');
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '触发恢复失败');
    } finally {
      setRestoring(false);
    }
  };

  const expectedConfirm = status?.confirmText || '确认恢复';
  const busy = Boolean(status?.isRunning || status?.isRestoring);

  const columns: ColumnsType<BackupJobItem> = [
    {
      title: '触发',
      dataIndex: 'trigger',
      width: 90,
      render: (value: string) => (value === 'manual' ? '手动' : '定时'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => {
        const meta = STATUS_META[value] ?? {
          label: value,
          color: 'default' as const,
        };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '数据库',
      dataIndex: 'dbSizeBytes',
      width: 120,
      render: (value: string | null) => formatBytes(value),
    },
    {
      title: '文件',
      key: 'files',
      width: 160,
      render: (_, row) =>
        `${row.filesCount} 个 / ${formatBytes(row.filesSizeBytes)}`,
    },
    {
      title: '环境配置',
      dataIndex: 'envIncluded',
      width: 100,
      render: (value: boolean) => (value ? '已包含' : '-'),
    },
    {
      title: '开始时间',
      dataIndex: 'startedAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '结束时间',
      dataIndex: 'finishedAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '备份前缀',
      dataIndex: 'prefix',
      ellipsis: true,
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (value: string | null) => value || '-',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 110,
      render: (_, row) =>
        canRestore && row.status === 'success' ? (
          <Button
            danger
            type="link"
            size="small"
            icon={<RollbackOutlined />}
            disabled={busy}
            onClick={() => {
              setConfirmText('');
              setRestoreTarget(row);
            }}
          >
            恢复
          </Button>
        ) : (
          '-'
        ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total: data?.total ?? 0,
    showSizeChanger: true,
    onChange: (nextPage, nextSize) => {
      setPage(nextPage);
      setPageSize(nextSize);
    },
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="自动备份默认每天 02:00 执行；一键恢复会覆盖当前数据库与业务文件"
        description="恢复顺序：MinIO 业务文件 → PostgreSQL → 环境快照落盘。环境变量不会热更新，恢复成功后请重启 API，并按需重建向量索引。"
      />

      {status?.restore ? (
        <Alert
          type={
            status.restore.status === 'failed'
              ? 'error'
              : status.restore.status === 'success'
                ? 'success'
                : 'warning'
          }
          showIcon
          message={`最近恢复：${status.restore.message}`}
          description={`备份 ${status.restore.backupId} · 阶段 ${status.restore.phase} · 文件 ${status.restore.filesRestored} · 数据库 ${status.restore.dbRestored ? '已恢复' : '未完成'}${status.restore.envFilePath ? ` · 环境文件 ${status.restore.envFilePath}` : ''}`}
        />
      ) : null}

      <Spin spinning={statusLoading}>
        <Descriptions title="调度配置" bordered size="small" column={2}>
          <Descriptions.Item label="自动备份">
            {canRun ? (
              <Switch
                checked={Boolean(status?.enabled)}
                loading={toggling}
                checkedChildren="已开启"
                unCheckedChildren="已关闭"
                onChange={(checked) => void onToggleAutoBackup(checked)}
              />
            ) : status?.enabled ? (
              '已开启'
            ) : (
              '已关闭'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Cron">{status?.cron || '-'}</Descriptions.Item>
          <Descriptions.Item label="保留天数">
            {status?.retentionDays ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="当前状态">
            {status?.isRestoring ? (
              <Tag color="warning">恢复进行中</Tag>
            ) : status?.isRunning ? (
              <Tag color="processing">备份进行中</Tag>
            ) : (
              <Tag>空闲</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="MinIO 前缀" span={2}>
            {status?.prefix || '-'}
          </Descriptions.Item>
          <Descriptions.Item label="本机落盘目录" span={2}>
            {status?.localDir || '未启用'}
          </Descriptions.Item>
        </Descriptions>
      </Spin>

      <Space>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          刷新
        </Button>
        {canRun ? (
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={running || busy}
            onClick={() => void onRun()}
          >
            立即备份
          </Button>
        ) : null}
      </Space>

      <Typography.Title level={5} style={{ margin: 0 }}>
        备份历史
      </Typography.Title>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data?.items ?? []}
        pagination={pagination}
        scroll={{ x: 1300 }}
      />

      <Modal
        title="一键恢复确认"
        open={Boolean(restoreTarget)}
        okText="确认覆盖并恢复"
        okButtonProps={{
          danger: true,
          disabled: confirmText.trim() !== expectedConfirm,
          loading: restoring,
        }}
        onOk={() => void onConfirmRestore()}
        onCancel={() => {
          if (restoring) return;
          setRestoreTarget(null);
          setConfirmText('');
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="error"
            showIcon
            message="危险操作：将覆盖当前 PostgreSQL 与 MinIO 业务文件"
            description={`目标备份：${restoreTarget?.id ?? '-'}（${restoreTarget?.prefix ?? ''}）`}
          />
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            请输入确认口令{' '}
            <Typography.Text code>{expectedConfirm}</Typography.Text>{' '}
            后继续：
          </Typography.Paragraph>
          <Input
            value={confirmText}
            placeholder={expectedConfirm}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={restoring}
          />
        </Space>
      </Modal>
    </Space>
  );
}
