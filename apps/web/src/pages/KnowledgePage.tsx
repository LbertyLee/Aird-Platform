import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  Globe2,
  Info,
  Lock,
  Plus,
  Settings2,
} from 'lucide-react';
import type { LoginResponse } from '@agent/contracts';
import {
  apiErrorMessage,
  fetchKnowledgeOverview,
  type KnowledgeVisibility,
  type UserKnowledgeLibrary,
  type UserKnowledgeOverview,
} from '../api/knowledge';
import CreateLibraryModal from '../components/CreateLibraryModal';

function libraryIconChar(lib: UserKnowledgeLibrary) {
  const icon = (lib.icon || '').trim();
  if (icon && [...icon].length === 1) return icon;
  const name = lib.name || '知';
  return [...name].find((ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch)) || '知';
}

export default function KnowledgePage({
  session,
}: {
  session: LoginResponse | null;
}) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<UserKnowledgeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setOverview(await fetchKnowledgeOverview());
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [session?.accessToken]);

  const stats = overview?.stats;
  const libraries = overview?.libraries ?? [];

  return (
    <>
      <main className="kb-page">
        <section className="kb-hero">
          <div className="kb-hero-copy">
            <div className="kb-hero-title">
              <span className="kb-hero-icon">
                <FolderOpen size={22} />
              </span>
              <div>
                <h1>知识库</h1>
                <p>集中管理研究文档与智搜成果，构建可检索的企业级知识资产</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="kb-primary-btn"
            disabled={!session}
            onClick={() => {
              if (!session) {
                navigate('/login');
                return;
              }
              setCreateOpen(true);
            }}
          >
            <Plus size={16} /> 新建知识库
          </button>
        </section>

        <div className="kb-hint">
          <Info size={16} />
          <span>
            说明：知识库按主题归档研究资料与智搜成果，支持新建知识库、知识分组、知识库配置与召回测试；上传 /
            存入的文档自动审核通过并学习入库，参与 AI 智搜的本地知识库优先检索。
          </span>
        </div>

        {!session ? (
          <div className="kb-gate">
            <strong>登录后管理你的知识库</strong>
            <p>创建主题知识库、上传研究文档，审核通过后自动参与智搜优先检索。</p>
            <button type="button" className="kb-primary-btn" onClick={() => navigate('/login')}>
              去登录
            </button>
          </div>
        ) : (
          <>
            <section className="kb-stats">
              <StatCard
                icon={<FolderOpen size={18} />}
                tone="blue"
                value={stats?.libraryCount ?? 0}
                label="知识库"
              />
              <StatCard
                icon={<FileText size={18} />}
                tone="green"
                value={stats?.documentCount ?? 0}
                label="文档总数"
              />
              <StatCard
                icon={<CheckCircle2 size={18} />}
                tone="cyan"
                value={stats?.learnedCount ?? 0}
                label="学习完成"
              />
              <StatCard
                icon={<Settings2 size={18} />}
                tone="amber"
                value={stats?.failedCount ?? 0}
                label="学习中断 / 失败"
              />
            </section>

            {error ? (
              <div className="kb-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            ) : null}

            {loading ? (
              <div className="kb-empty">正在加载知识库…</div>
            ) : libraries.length === 0 ? (
              <div className="kb-empty">
                <strong>还没有知识库</strong>
                <p>点击右上角「新建知识库」，按主题归档你的研究资料。</p>
              </div>
            ) : (
              <section className="kb-grid">
                {libraries.map((lib) => (
                  <article
                    key={lib.id}
                    className="kb-card"
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/knowledge/${lib.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/knowledge/${lib.id}`);
                      }
                    }}
                  >
                    <div className="kb-card-top" style={{ background: lib.color || '#3b82f6' }} />
                    <div className="kb-card-body">
                      <div className="kb-card-head">
                        <span
                          className="kb-card-mark"
                          style={{ background: lib.color || '#3b82f6' }}
                        >
                          {libraryIconChar(lib)}
                        </span>
                        <div className="kb-card-title-row">
                          <h2>{lib.name}</h2>
                          <VisibilityBadge visibility={lib.visibility} />
                        </div>
                      </div>
                      <p className="kb-card-desc">
                        {lib.intro?.trim() || '暂无简介'}
                      </p>
                      <div className="kb-card-foot">
                        <span>{lib.fileTotal ?? 0} 篇文档</span>
                        <span className="kb-card-enter">进入知识库 →</span>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {createOpen ? (
        <CreateLibraryModal
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function StatCard({
  icon,
  tone,
  value,
  label,
}: {
  icon: ReactNode;
  tone: 'blue' | 'green' | 'cyan' | 'amber';
  value: number;
  label: string;
}) {
  return (
    <div className={`kb-stat kb-stat-${tone}`}>
      <span className="kb-stat-icon">{icon}</span>
      <strong>{value}</strong>
      <em>{label}</em>
    </div>
  );
}

function VisibilityBadge({ visibility }: { visibility: KnowledgeVisibility }) {
  if (visibility === 'public') {
    return (
      <span className="kb-badge kb-badge-public">
        <Globe2 size={12} /> 公共
      </span>
    );
  }
  return (
    <span className="kb-badge kb-badge-private">
      <Lock size={12} /> 私有
    </span>
  );
}
