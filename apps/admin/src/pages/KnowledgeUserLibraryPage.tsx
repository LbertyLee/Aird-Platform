import {
  ArrowRightOutlined,
  FileOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { Empty, Select, Spin, Tag, message } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchUserKnowledgeLibraries,
  fetchUsers,
  type UserItem as AdminUser,
  type UserKnowledgeLibraryOverview,
} from '../api/admin';
import './kb-library/kb-library.css';

const AVATAR_COLORS = [
  '#2475fc',
  '#12b76a',
  '#7c3aed',
  '#f79009',
  '#fb363f',
  '#0ea5e9',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * 17) % AVATAR_COLORS.length;
  }
  return AVATAR_COLORS[hash] ?? AVATAR_COLORS[0];
}

function displayName(u: AdminUser): string {
  return u.displayName?.trim() || u.username;
}

function avatarText(u: AdminUser): string {
  return displayName(u).slice(0, 1).toUpperCase();
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
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

/**
 * 用户知识库管理：选择用户，展示其创建/提交的知识库与文档。
 */
export function KnowledgeUserLibraryPage() {
  const navigate = useNavigate();

  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [overview, setOverview] = useState<UserKnowledgeLibraryOverview | null>(
    null,
  );
  const [loadingOverview, setLoadingOverview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingUsers(true);
      try {
        const res = await fetchUsers({
          page: 1,
          pageSize: 100,
          status: 'active',
        });
        if (cancelled) return;
        setAllUsers(res?.items ?? []);
      } catch {
        if (!cancelled) {
          setAllUsers([]);
          message.error('加载用户列表失败');
        }
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const userMap = useMemo(() => {
    const map = new Map<string, AdminUser>();
    allUsers.forEach((u) => map.set(u.id, u));
    return map;
  }, [allUsers]);

  const selectedUsers = useMemo(
    () =>
      selectedIds
        .map((id) => userMap.get(id))
        .filter((u): u is AdminUser => Boolean(u)),
    [selectedIds, userMap],
  );

  useEffect(() => {
    if (!selectedIds.length) {
      setActiveUserId(null);
      return;
    }
    if (!activeUserId || !selectedIds.includes(activeUserId)) {
      setActiveUserId(selectedIds[0] ?? null);
    }
  }, [selectedIds, activeUserId]);

  const loadOverview = useCallback(async (userId: string) => {
    setLoadingOverview(true);
    try {
      setOverview(await fetchUserKnowledgeLibraries(userId));
    } catch (e: unknown) {
      setOverview(null);
      const err = e as { message?: string };
      message.error(err?.message || '加载用户知识库失败');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    if (!activeUserId) {
      setOverview(null);
      return;
    }
    void loadOverview(activeUserId);
  }, [activeUserId, loadOverview]);

  const activeAdmin = activeUserId ? userMap.get(activeUserId) : undefined;

  const openDetail = (libraryId: string) => {
    if (!activeUserId) return;
    navigate(
      `/knowledge/user-detail?userId=${encodeURIComponent(activeUserId)}&libraryId=${encodeURIComponent(libraryId)}`,
    );
  };

  const selectOptions = useMemo(
    () =>
      allUsers.map((u) => ({
        value: u.id,
        label: `${displayName(u)}${u.username !== displayName(u) ? `（${u.username}）` : ''}`,
        searchText: `${displayName(u)} ${u.username} ${u.email || ''} ${u.phone || ''}`,
      })),
    [allUsers],
  );

  const memberLabel =
    overview?.user.membershipLevelName ||
    activeAdmin?.membership?.levelName ||
    '普通用户';
  const titleName =
    overview?.user.displayName ||
    overview?.user.username ||
    (activeAdmin ? displayName(activeAdmin) : '');

  return (
    <div className="uk-page">
      <div className="uk-body">
        <div className="uk-users">
          <div className="uk-users-head uk-users-head--stack">
            <span>用户列表</span>
            <Select
              mode="multiple"
              allowClear
              showSearch
              loading={loadingUsers}
              placeholder="搜索并选择用户（可多选）"
              style={{ width: '100%' }}
              value={selectedIds}
              options={selectOptions}
              optionFilterProp="searchText"
              filterOption={(input, option) =>
                String(option?.searchText || option?.label || '')
                  .toLowerCase()
                  .includes(input.trim().toLowerCase())
              }
              maxTagCount="responsive"
              onChange={(ids: string[]) => setSelectedIds(ids)}
            />
          </div>
          <div className="uk-users-list">
            {selectedUsers.map((u) => (
              <div
                key={u.id}
                className={`uk-user-item${activeUserId === u.id ? ' active' : ''}`}
                onClick={() => setActiveUserId(u.id)}
              >
                <div
                  className="uk-avatar"
                  style={{ background: avatarColor(u.id) }}
                >
                  {avatarText(u)}
                </div>
                <div className="uk-user-info">
                  <div className="uk-user-name">{displayName(u)}</div>
                  <div className="uk-user-meta">{u.username}</div>
                </div>
                {u.membership?.levelName ? (
                  <span className="uk-member-tag">{u.membership.levelName}</span>
                ) : null}
              </div>
            ))}
            {!selectedUsers.length ? (
              <div className="uk-users-empty">请先在上方下拉框中选择用户</div>
            ) : null}
          </div>
        </div>

        <div className="uk-main">
          {activeUserId ? (
            <Spin spinning={loadingOverview}>
              <div className="uk-main-head">
                <div>
                  <div className="uk-main-title">
                    {titleName} 的知识库
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {memberLabel}
                    </Tag>
                  </div>
                  <div className="uk-main-sub">
                    共 {overview?.libraryCount ?? 0} 个知识库 ·{' '}
                    {overview?.documentCount ?? 0} 篇文档
                  </div>
                </div>
                <div className="uk-stats">
                  <div className="uk-stat">
                    <span className="uk-stat-num">
                      {overview?.libraryCount ?? 0}
                    </span>
                    <span className="uk-stat-label">知识库</span>
                  </div>
                  <div className="uk-stat">
                    <span className="uk-stat-num">
                      {overview?.documentCount ?? 0}
                    </span>
                    <span className="uk-stat-label">文档</span>
                  </div>
                  <div className="uk-stat">
                    <span className="uk-stat-num">
                      {formatBytes(overview?.totalSize ?? 0)}
                    </span>
                    <span className="uk-stat-label">容量</span>
                  </div>
                </div>
              </div>

              {overview?.libraries?.length ? (
                <div className="uk-cards">
                  {overview.libraries.map((lib) => (
                    <div
                      key={lib.id}
                      className="uk-card"
                      onClick={() => openDetail(lib.id)}
                    >
                      <div className="uk-card-type">{typeText(lib.type)}</div>
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
                      <div className="kb-card-desc">
                        {lib.intro || '暂无简介'}
                      </div>
                      <div className="kb-card-foot">
                        <div className="kb-card-stats">
                          <span className="kb-stat">
                            <FileOutlined />
                            {lib.fileTotal}
                          </span>
                          <span className="kb-stat">
                            <FolderOpenOutlined />
                            {formatBytes(lib.fileSize)}
                          </span>
                        </div>
                      </div>
                      <div className="kb-card-meta">
                        <span>最近更新 {formatTime(lib.updatedAt)}</span>
                        <span className="uk-card-more">
                          <ArrowRightOutlined /> 查看文档
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !loadingOverview ? (
                <Empty
                  description="该用户暂无知识库（以其创建的知识库或提交的文档为准）"
                  style={{ marginTop: 60 }}
                />
              ) : null}
            </Spin>
          ) : (
            <Empty
              description="请选择左侧用户查看其知识库"
              style={{ marginTop: 60 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
