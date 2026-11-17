import {
  EditOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button, Form, Input, Modal, Pagination, Select, Spin, message } from 'antd';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createKnowledgeLibrary,
  fetchDictionaries,
  fetchKnowledgeLibraries,
  fetchKnowledgeLibraryStatistics,
  type KnowledgeLibraryBucket,
  updateKnowledgeLibrary,
  type KnowledgeLibraryItem,
} from '../api/admin';
import { FORM_MODAL_WIDTH, withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';
import { KNOWLEDGE_GROUP_DICT_TYPE } from './kb-library/constants';
import { type GroupItem } from './kb-library/data';
import './kb-library/kb-library.css';

const LIBRARY_TYPE_OPTIONS = [
  { value: 'normal', label: '普通知识库' },
  { value: 'qa', label: '历史问答库' },
];

const LIBRARY_VISIBILITY_OPTIONS = [
  { value: 'public', label: '公用知识库' },
  { value: 'private', label: '私有知识库' },
];

const ICON_OPTIONS = [
  { value: '📚', label: '📚 文档' },
  { value: '📊', label: '📊 数据' },
  { value: '💬', label: '💬 问答' },
  { value: '🏭', label: '🏭 行业' },
  { value: '🗺️', label: '🗺️ 专题' },
  { value: '🏢', label: '🏢 企业' },
  { value: '📈', label: '📈 宏观' },
];

const COLOR_OPTIONS = [
  { value: '#e6efff', label: '蓝' },
  { value: '#e8f7ee', label: '绿' },
  { value: '#fdf3e7', label: '橙' },
  { value: '#f0ecff', label: '紫' },
  { value: '#e6f6fb', label: '青' },
  { value: '#fdeef1', label: '粉' },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function typeText(type: string): string {
  return type === 'qa' ? '历史问答库' : '普通知识库';
}

function visibilityText(visibility?: string): string {
  return visibility === 'public' ? '公用' : '私有';
}

function matchType(lib: KnowledgeLibraryBucket, typeTab: string): boolean {
  if (typeTab === 'all') return true;
  if (typeTab === 'normal') return lib.type === 'normal';
  if (typeTab === 'qa') return lib.type === 'qa';
  return true;
}

function matchVisibility(
  lib: KnowledgeLibraryBucket,
  visibilityTab: string,
): boolean {
  if (visibilityTab === 'all') return true;
  const vis = lib.visibility || 'private';
  return vis === visibilityTab;
}

function matchGroup(lib: KnowledgeLibraryBucket, groupId: string): boolean {
  if (groupId === 'all') return true;
  return lib.groupCode === groupId;
}

/**
 * 知识库管理：分组侧栏（字典维护）+ 知识库卡片列表 + 新增入口。
 */
export function KnowledgeLibraryPage() {
  const navigate = useNavigate();
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate =
    hasPermission('button:knowledge:library:create') ||
    hasPermission('button:knowledge:item:create');
  const canUpdate =
    hasPermission('button:knowledge:library:update') ||
    hasPermission('button:knowledge:item:update');

  const [libraries, setLibraries] = useState<KnowledgeLibraryItem[]>([]);
  const [buckets, setBuckets] = useState<KnowledgeLibraryBucket[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const requestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [dictGroups, setDictGroups] = useState<GroupItem[]>([]);
  const [groupCollapsed, setGroupCollapsed] = useState(false);
  const [activeGroup, setActiveGroup] = useState('all');
  const [activeTab, setActiveTab] = useState<'all' | 'normal' | 'qa'>('all');
  const [activeVisibility, setActiveVisibility] = useState<
    'all' | 'public' | 'private'
  >('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeLibraryItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const loadLibraries = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const params = {
        page,
        pageSize,
        status: 'active',
        keyword: keyword.trim() || undefined,
        groupCode: activeGroup === 'all' ? undefined : activeGroup,
        type: activeTab === 'all' ? undefined : activeTab,
        visibility: activeVisibility === 'all' ? undefined : activeVisibility,
      };
      const [res, counts] = await Promise.all([
        fetchKnowledgeLibraries(params),
        fetchKnowledgeLibraryStatistics(params),
      ]);
      if (currentRequest !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(res.total / pageSize));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }
      setLibraries(res.items);
      setBuckets(counts);
      setTotal(res.total);
    } catch {
      if (currentRequest !== requestId.current) return;
      setLibraries([]);
      setBuckets([]);
      setTotal(0);
      message.error('加载知识库失败');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [page, pageSize, keyword, activeGroup, activeTab, activeVisibility]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDictionaries({
          page: 1,
          pageSize: 100,
          type: KNOWLEDGE_GROUP_DICT_TYPE,
          status: 'active',
        });
        if (cancelled) return;
        const list = (res?.items ?? [])
          .slice()
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map((item) => ({
            id: item.code,
            name: item.name,
            total: 0,
          }));
        setDictGroups(list);
      } catch {
        if (!cancelled) {
          setDictGroups([]);
          message.error('加载知识分组失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadLibraries();
    return () => {
      requestId.current += 1;
    };
  }, [loadLibraries]);

  const filteredLibraries = libraries;
  const count = (rows: KnowledgeLibraryBucket[]) =>
    rows.reduce((sum, row) => sum + row.count, 0);

  const tabs = useMemo(() => {
    const byGroup = buckets.filter((l) => matchGroup(l, activeGroup));
    const byGroupAndVis = byGroup.filter((l) =>
      matchVisibility(l, activeVisibility),
    );
    const byGroupAndType = byGroup.filter((l) => matchType(l, activeTab));

    return {
      type: [
        {
          label: `全部（${count(byGroupAndVis)}）`,
          value: 'all' as const,
        },
        {
          label: `普通知识库（${count(byGroupAndVis.filter((l) => l.type === 'normal'))}）`,
          value: 'normal' as const,
        },
        {
          label: `历史问答库（${count(byGroupAndVis.filter((l) => l.type === 'qa'))}）`,
          value: 'qa' as const,
        },
      ],
      visibility: [
        {
          label: `全部可见性（${count(byGroupAndType)}）`,
          value: 'all' as const,
        },
        {
          label: `公用（${count(byGroupAndType.filter((l) => l.visibility === 'public'))}）`,
          value: 'public' as const,
        },
        {
          label: `私有（${count(byGroupAndType.filter((l) => (l.visibility || 'private') === 'private'))}）`,
          value: 'private' as const,
        },
      ],
    };
  }, [buckets, activeGroup, activeTab, activeVisibility]);

  const groups = useMemo<GroupItem[]>(() => {
    const base = buckets.filter(
      (l) => matchType(l, activeTab) && matchVisibility(l, activeVisibility),
    );
    const list: GroupItem[] = [
      { id: 'all', name: '全部知识库', total: count(base) },
    ];
    dictGroups.forEach((g) => {
      list.push({
        ...g,
        total: count(base.filter((l) => l.groupCode === g.id)),
      });
    });
    return list;
  }, [buckets, dictGroups, activeTab, activeVisibility]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      name: '',
      type: 'normal',
      visibility: 'private',
      groupCode: activeGroup !== 'all' ? activeGroup : undefined,
      intro: '',
      icon: '📚',
      color: '#e6efff',
    });
    setFormOpen(true);
  };

  const openEdit = (lib: KnowledgeLibraryItem, e?: MouseEvent) => {
    e?.stopPropagation();
    setEditing(lib);
    form.setFieldsValue({
      name: lib.name,
      type: lib.type || 'normal',
      visibility: lib.visibility || 'private',
      groupCode: lib.groupCode || undefined,
      intro: lib.intro || '',
      icon: lib.icon || '📚',
      color: lib.color || '#e6efff',
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        type: values.type,
        visibility: values.visibility,
        groupCode: values.groupCode || null,
        intro: values.intro || null,
        icon: values.icon,
        color: values.color,
      };
      if (editing) {
        await updateKnowledgeLibrary(editing.id, payload);
        message.success('知识库已更新');
        closeForm();
        await loadLibraries();
      } else {
        const created = await createKnowledgeLibrary({
          ...payload,
          groupCode: values.groupCode || undefined,
          intro: values.intro || undefined,
        });
        message.success('知识库已创建');
        closeForm();
        await loadLibraries();
        navigate(`/knowledge/library-detail?id=${created.id}`);
      }
    } catch (e: unknown) {
      const err = e as {
        message?: string;
        response?: { data?: { message?: string | string[] } };
      };
      const raw = err?.response?.data?.message ?? err?.message;
      const msg = Array.isArray(raw) ? raw.join('; ') : raw;
      message.error(msg || (editing ? '更新失败' : '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = (lib: KnowledgeLibraryItem) => {
    navigate(`/knowledge/library-detail?id=${lib.id}`);
  };

  return (
    <div className="kb-page">
      <div className="kb-list-body">
        <div className={`kb-group-panel${groupCollapsed ? ' collapsed' : ''}`}>
          <div className="kb-group-head">
            <div className="kb-group-title">知识分组</div>
          </div>
          <div className="kb-group-list">
            {groups.map((g) => (
              <div
                key={g.id}
                className={`kb-group-item${activeGroup === g.id ? ' active' : ''}`}
                onClick={() => {
                  setPage(1);
                  setActiveGroup(g.id);
                }}
              >
                <div className="kb-group-name">{g.name}</div>
                <span className="kb-group-num">{g.total}</span>
              </div>
            ))}
          </div>
          <div
            className="kb-group-collapse"
            onClick={() => setGroupCollapsed((v) => !v)}
          >
            {groupCollapsed ? <RightOutlined /> : <LeftOutlined />}
          </div>
        </div>

        <div className="kb-list-main">
          <div className="kb-list-toolbar">
            <div className="kb-tabs-stack">
              <div className="kb-tabs">
                {tabs.type.map((tab) => (
                  <div
                    key={`type-${tab.value}`}
                    className={`kb-tab-item${activeTab === tab.value ? ' active' : ''}`}
                    onClick={() => {
                      setPage(1);
                      setActiveTab(tab.value);
                    }}
                  >
                    {tab.label}
                  </div>
                ))}
              </div>
              <div className="kb-tabs">
                {tabs.visibility.map((tab) => (
                  <div
                    key={`vis-${tab.value}`}
                    className={`kb-tab-item${activeVisibility === tab.value ? ' active' : ''}`}
                    onClick={() => {
                      setPage(1);
                      setActiveVisibility(tab.value);
                    }}
                  >
                    {tab.label}
                  </div>
                ))}
              </div>
            </div>
            {canCreate ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增知识库
              </Button>
            ) : null}
          </div>

          <Input.Search
            allowClear
            placeholder="搜索知识库名称 / 编码 / 简介"
            style={{ marginBottom: 12, maxWidth: 360 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
          <Spin spinning={loading} wrapperClassName="kb-list-loading">
            <div className="kb-cards">
            {filteredLibraries.map((lib) => (
              <div
                key={lib.id}
                className="kb-card"
                onClick={() => openDetail(lib)}
              >
                <div className="kb-card-badges">
                  <span className="kb-card-type">{typeText(lib.type)}</span>
                  <span
                    className={`kb-card-visibility${
                      lib.visibility === 'public' ? ' is-public' : ''
                    }`}
                  >
                    {visibilityText(lib.visibility)}
                  </span>
                </div>
                {canUpdate ? (
                  <button
                    type="button"
                    className="kb-card-edit"
                    title="编辑知识库"
                    onClick={(e) => openEdit(lib, e)}
                  >
                    <EditOutlined />
                    编辑
                  </button>
                ) : null}
                <div className="kb-card-info">
                  <div
                    className="kb-card-icon"
                    style={{ background: lib.color }}
                  >
                    {lib.icon}
                  </div>
                  <div className="kb-card-name" title={lib.name}>
                    {lib.name}
                  </div>
                </div>
                <div className="kb-card-desc">{lib.intro || '暂无简介'}</div>
                <div className="kb-card-foot">
                  <div className="kb-card-stats">
                    <span className="kb-stat" title="文档数">
                      <FileOutlined />
                      {lib.fileTotal}
                    </span>
                    <span className="kb-stat" title="存储大小">
                      <FolderOpenOutlined />
                      {formatBytes(lib.fileSize)}
                    </span>
                  </div>
                </div>
                <div className="kb-card-meta">
                  <span>更新人：{lib.updaterName || lib.creatorName || '—'}</span>
                  <span>{formatTime(lib.updatedAt)}</span>
                </div>
              </div>
            ))}
            {!loading && !filteredLibraries.length ? (
              <div className="kb-empty">
                <FolderOpenOutlined style={{ fontSize: 40, color: '#c4c9d4' }} />
                <div>
                  {libraries.length
                    ? '当前筛选条件下暂无知识库，请调整类型 / 可见性 / 分组'
                    : '暂无知识库'}
                </div>
                {canCreate ? (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    style={{ marginTop: 12 }}
                    onClick={openCreate}
                  >
                    新增知识库
                  </Button>
                ) : null}
              </div>
            ) : null}
            </div>
          </Spin>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[12, 24, 48, 96]}
            showTotal={(value) => `共 ${value} 个知识库`}
            onChange={(next, size) => {
              setPage(size === pageSize ? next : 1);
              setPageSize(size);
            }}
            style={{ marginTop: 16 }}
          />
        </div>
      </div>

      <Modal
        {...withFormModal({
          title: editing ? '编辑知识库' : '新增知识库',
          open: formOpen,
          onCancel: closeForm,
          onOk: () => void submitForm(),
          confirmLoading: submitting,
          okText: editing ? '保存' : '创建',
          width: FORM_MODAL_WIDTH,
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="name"
            label="知识库名称"
            rules={[{ required: true, message: '请输入知识库名称' }]}
            className="admin-form-span-2"
          >
            <Input placeholder="如：平台研究成果知识库" maxLength={256} />
          </Form.Item>
          <Form.Item
            name="type"
            label="知识库类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select options={LIBRARY_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="是否公用"
            rules={[{ required: true, message: '请选择是否公用' }]}
          >
            <Select options={LIBRARY_VISIBILITY_OPTIONS} />
          </Form.Item>
          <Form.Item name="groupCode" label="知识分组">
            <Select
              allowClear
              placeholder="请选择分组"
              options={dictGroups.map((g) => ({
                value: g.id,
                label: g.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Select options={ICON_OPTIONS} />
          </Form.Item>
          <Form.Item name="color" label="图标底色">
            <Select
              options={COLOR_OPTIONS.map((c) => ({
                value: c.value,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: c.value,
                        border: '1px solid #e4e6eb',
                      }}
                    />
                    {c.label}
                  </span>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item name="intro" label="简介" className="admin-form-span-2">
            <Input.TextArea
              rows={3}
              maxLength={1024}
              placeholder="简要描述知识库用途与覆盖范围"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
