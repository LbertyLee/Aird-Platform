import { Edit2, Flame, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse } from '@agent/contracts';
import './AgentCenterPage.css';
import {
  createAgent,
  deleteAgent,
  fetchAgentCategories,
  fetchAgents,
  updateAgent,
  type AgentCategory,
  type AgentItem,
} from '../api/agents';

const usage = (value: number) =>
  value >= 10000
    ? `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}w`
    : String(value);

const agentIconOptions = [
  ['🤖', '机器人'],
  ['🧠', '智慧'],
  ['📚', '学习'],
  ['✍️', '写作'],
  ['🔍', '检索'],
  ['📊', '分析'],
  ['💡', '创意'],
  ['⚡', '效率'],
] as const;

export default function AgentCenterPage({
  session,
}: {
  session: LoginResponse | null;
}) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [categories, setCategories] = useState<AgentCategory[]>([]);
  const [keyword, setKeyword] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AgentItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    categoryCode: '',
    icon: '🤖',
    iconColor: '#dbeafe',
  });

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      setAgents(
        await fetchAgents({
          q: keyword || undefined,
          categoryCode: categoryCode || undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [categoryCode, keyword]);

  useEffect(() => {
    void fetchAgentCategories().then((items) => {
      setCategories(items);
      setForm((current) => ({
        ...current,
        categoryCode: current.categoryCode || items[0]?.code || '',
      }));
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgents(), 200);
    return () => window.clearTimeout(timer);
  }, [loadAgents]);

  const openCreate = () => {
    if (!session) {
      navigate('/login');
      return;
    }
    setCreateError('');
    setEditing(null);
    setForm((current) => ({ ...current, name: '', description: '' }));
    setCreateOpen(true);
  };

  const openEdit = (agent: AgentItem) => {
    setCreateError('');
    setEditing(agent);
    setForm({
      name: agent.name,
      description: agent.description,
      categoryCode: agent.categoryCode,
      icon: agent.icon || '🤖',
      iconColor: agent.iconColor || '#dbeafe',
    });
    setCreateOpen(true);
  };

  const removePersonal = async (agent: AgentItem) => {
    if (!window.confirm(`确定删除“${agent.name}”吗？删除后不可恢复。`)) return;
    try {
      await deleteAgent(agent.id);
      await loadAgents();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除智能体失败，请稍后重试');
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        categoryCode: form.categoryCode,
        icon: form.icon.trim() || undefined,
        iconColor: form.iconColor.trim() || undefined,
      };
      if (editing) await updateAgent(editing.id, payload);
      else await createAgent(payload);
      setCreateOpen(false);
      setEditing(null);
      setForm((current) => ({
        ...current,
        name: '',
        description: '',
      }));
      await loadAgents();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : `${editing ? '更新' : '创建'}智能体失败，请稍后重试`,
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <main className="agent-page">
        <div className="agent-heading">
          <div>
            <h1>智能体中心</h1>
            <p>发现和管理适合你的 AI 智能体</p>
          </div>
          <label className="agent-search">
            <Search size={19} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索智能体"
            />
          </label>
        </div>
        <div className="agent-categories">
          <button
            type="button"
            onClick={() => setCategoryCode('')}
            className={!categoryCode ? 'active' : ''}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              type="button"
              onClick={() => setCategoryCode(item.code)}
              className={categoryCode === item.code ? 'active' : ''}
              key={item.code}
            >
              {item.name}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="agent-loading">
            <LoaderCircle className="spin" /> 正在加载智能体…
          </div>
        ) : agents.length ? (
          <div className="agent-grid">
            {agents.map((agent) => (
              <article className="agent-card" key={agent.id}>
                <div
                  className="agent-avatar"
                  style={{ background: agent.iconColor || '#dbeafe' }}
                >
                  {agent.icon || '🤖'}
                </div>
                <div className="agent-card-main">
                  <div className="agent-name-row">
                    <h2>{agent.name}</h2>
                    {agent.isPersonal ? (
                      <span className="personal">我的</span>
                    ) : (
                      <span className="official">平台</span>
                    )}
                  </div>
                  <p>{agent.description}</p>
                  <footer>
                    <span>
                      <Flame size={13} /> {usage(agent.usageCount)}
                    </span>
                    <span>来自：{agent.author}</span>
                  </footer>
                  {agent.isPersonal ? (
                    <div className="agent-card-actions">
                      <button type="button" onClick={() => openEdit(agent)} title="编辑智能体">
                        <Edit2 size={13} /> 编辑
                      </button>
                      <button type="button" className="danger" onClick={() => void removePersonal(agent)} title="删除智能体">
                        <Trash2 size={13} /> 删除
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="agent-empty">暂无符合条件的智能体</div>
        )}
        <button
          type="button"
          className="agent-fab"
          title="创建智能体"
          onClick={openCreate}
        >
          <Plus size={18} /> 创建智能体
        </button>
        {createOpen ? (
          <div
            className="agent-modal-backdrop"
            role="presentation"
            onMouseDown={() => setCreateOpen(false)}
          >
            <section
              className="agent-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-agent-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <h2 id="create-agent-title">{editing ? '编辑智能体' : '创建智能体'}</h2>
                  <p>{editing ? '修改后立即对你生效。' : '创建后仅你本人可见。'}</p>
                </div>
                <button
                  type="button"
                  className="agent-icon-button"
                  title="关闭"
                  aria-label="关闭"
                  onClick={() => setCreateOpen(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <form onSubmit={(event) => void submitCreate(event)}>
                <label>
                  名称
                  <input
                    value={form.name}
                    maxLength={128}
                    required
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  简介
                  <textarea
                    value={form.description}
                    maxLength={500}
                    rows={4}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                  />
                </label>
                <label>
                  分类
                  <select
                    value={form.categoryCode}
                    required
                    onChange={(event) =>
                      setForm({ ...form, categoryCode: event.target.value })
                    }
                  >
                    {categories.map((item) => (
                      <option value={item.code} key={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="agent-form-row">
                  <label>
                    图标
                    <select
                      value={form.icon}
                      onChange={(event) =>
                        setForm({ ...form, icon: event.target.value })
                      }
                    >
                      {agentIconOptions.map(([value, label]) => (
                        <option value={value} key={value}>
                          {value} {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    图标颜色
                    <input
                      type="color"
                      value={form.iconColor}
                      onChange={(event) =>
                        setForm({ ...form, iconColor: event.target.value })
                      }
                    />
                  </label>
                </div>
                {createError ? (
                  <p className="agent-form-error">{createError}</p>
                ) : null}
                <footer>
                  <button
                    type="button"
                    className="agent-secondary-button"
                    onClick={() => setCreateOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="agent-primary-button"
                    disabled={creating || !categories.length}
                  >
                    {creating ? (editing ? '保存中…' : '创建中…') : editing ? '保存修改' : '创建智能体'}
                  </button>
                </footer>
              </form>
            </section>
          </div>
        ) : null}
      </main>
    </>
  );
}
