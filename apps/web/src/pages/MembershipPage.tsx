import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Crown, X } from 'lucide-react';
import type { LoginResponse } from '@agent/contracts';
import {
  createMembershipOrder,
  fetchMembershipCatalog,
  fetchMembershipStatus,
  fetchPointSummary,
  type MembershipCatalog,
  type MembershipCatalogPackage,
  type MembershipStatus,
  type PointSummary,
} from '../api/membership';
import { apiErrorMessage } from '../api/research';
import ResearchLayout from '../layouts/ResearchLayout';
import './MembershipPage.css';

const PACKAGE_ORDER = ['monthly', 'auto_renew_monthly', 'quarterly', 'yearly'] as const;

const FALLBACK_EDITIONS = [
  {
    code: 'normal',
    name: '普通版',
    available: true,
    monthlyPoints: 5000,
    monthlyLimit: 7000,
    scenario: '日常轻度研究',
    features: [
      '每月赠送 5,000 算力积分',
      '公共数据基础检索与摘要',
      '单文件知识问答',
      '单主题分析',
      '导出表格与基础图表',
    ],
  },
  {
    code: 'plus',
    name: 'Plus',
    available: true,
    monthlyPoints: 12000,
    monthlyLimit: 14000,
    scenario: '持续研究',
    features: [
      '每月赠送 12,000 算力积分',
      '完整公共数据检索与深度分析',
      '多文件联合问答',
      '跨文件/地区分析',
      '带来源研究报告导出',
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    available: true,
    monthlyPoints: 26000,
    monthlyLimit: 28000,
    scenario: '高频深度研究',
    features: [
      '每月赠送 26,000 算力积分',
      '批量多主题分析',
      '完整检索与私有数据研究',
      '长篇报告与批量导出',
      '高频深度研究支持',
    ],
  },
];

const FALLBACK_COMPARE = [
  { feature: '公共数据', free: '基础检索与摘要', normal: '基础检索与摘要', plus: '完整检索与深度分析', pro: '完整检索与深度分析' },
  { feature: '私有数据', free: '不可使用', normal: '单文件问答', plus: '多文件联合问答', pro: '完整检索与私有数据研究' },
  { feature: '分析能力', free: '简单问答', normal: '单主题分析', plus: '跨文件/地区分析', pro: '批量多主题分析' },
  { feature: '导出能力', free: '仅页面预览', normal: '表格与基础图表', plus: '带来源研究报告', pro: '长篇报告与批量导出' },
  { feature: '适用场景', free: '体验与轻度问答', normal: '日常轻度研究', plus: '持续研究', pro: '高频深度研究' },
  { feature: '月赠送积分', free: '—', normal: '5,000', plus: '12,000', pro: '26,000' },
  { feature: '月度最高积分', free: '2,000', normal: '7,000', plus: '14,000', pro: '28,000' },
];

function priceUnit(packageType: string) {
  if (packageType === 'yearly') return '/年';
  if (packageType === 'quarterly') return '/季';
  if (packageType === 'auto_renew_monthly') return '/首月';
  return '/月';
}

function packageBadge(pkg: MembershipCatalogPackage) {
  if (pkg.tag === 'recommended' || pkg.packageType === 'yearly') return '最推荐';
  if (pkg.packageType === 'auto_renew_monthly') return '首月7折';
  if (pkg.packageType === 'quarterly') return '省30%';
  return null;
}

function formatMoney(value: number) {
  return `¥${Number(value).toFixed(2)}`;
}

function daysLeft(endAt?: string | null) {
  if (!endAt) return null;
  const end = new Date(`${endAt}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000));
}

export default function MembershipPage({
  session,
  onLogout,
}: {
  session: LoginResponse | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [catalog, setCatalog] = useState<MembershipCatalog | null>(null);
  const [status, setStatus] = useState<MembershipStatus | null>(null);
  const [points, setPoints] = useState<PointSummary | null>(null);
  const [selectedEdition, setSelectedEdition] = useState('normal');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutPkg, setCheckoutPkg] =
    useState<MembershipCatalogPackage | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const nextCatalog = await fetchMembershipCatalog();
        if (cancelled) return;
        setCatalog(nextCatalog);
        const preferred =
          nextCatalog.editions.find((item) => item.code === 'pro')?.code ??
          nextCatalog.editions[0]?.code ??
          'normal';
        setSelectedEdition((prev) =>
          nextCatalog.editions.some((item) => item.code === prev) ? prev : preferred,
        );
        if (session) {
          const [nextStatus, nextPoints] = await Promise.all([
            fetchMembershipStatus(),
            fetchPointSummary().catch(() => null),
          ]);
          if (cancelled) return;
          setStatus(nextStatus);
          setPoints(nextPoints);
          if (nextStatus.levelCode) {
            setSelectedEdition((prev) =>
              nextCatalog.editions.some((item) => item.code === nextStatus.levelCode)
                ? nextStatus.levelCode!
                : prev,
            );
          }
        } else {
          setStatus({
            isMember: false,
            remainingTrials: 1,
            trialQuota: 1,
            canSearch: true,
            minSearchPoints: 20,
            levelCode: null,
            levelName: null,
            endAt: null,
            autoRenew: false,
          });
        }
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason === 'points_low' || reason === 'trial_exhausted') {
      const minPoints = status?.minSearchPoints ?? 20;
      setNotice(
        `当前积分低于 ${minPoints}，暂无法使用 AI 智搜。请领取积分或开通会员后再试。`,
      );
    }
  }, [searchParams, status?.minSearchPoints]);

  const editions = catalog?.editions?.length ? catalog.editions : FALLBACK_EDITIONS;
  const currentEdition =
    editions.find((item) => item.code === selectedEdition) ?? editions[0];

  const packages = useMemo(() => {
    const list = (catalog?.packages ?? []).filter(
      (item) => item.levelCode === (currentEdition?.code ?? selectedEdition),
    );
    return [...list].sort(
      (a, b) =>
        PACKAGE_ORDER.indexOf(a.packageType as (typeof PACKAGE_ORDER)[number]) -
        PACKAGE_ORDER.indexOf(b.packageType as (typeof PACKAGE_ORDER)[number]),
    );
  }, [catalog, currentEdition?.code, selectedEdition]);

  const compareRows = catalog?.compareRows?.length
    ? catalog.compareRows
    : FALLBACK_COMPARE;
  const remainingDays = daysLeft(status?.endAt);
  const isMember = Boolean(status?.isMember);
  const usingFallback = !catalog?.packages?.length;

  function handleActivate(pkg?: MembershipCatalogPackage) {
    if (!session) {
      navigate('/login');
      return;
    }
    const target = pkg ?? packages.find((item) => item.tag === 'recommended') ?? packages[0];
    if (!target) {
      setNotice('暂无可购买套餐，请稍后再试。');
      return;
    }
    if (usingFallback || target.id.startsWith('fallback-')) {
      setNotice('套餐目录暂不可用，请稍后刷新再试。');
      return;
    }
    setPayError('');
    setCheckoutPkg(target);
  }

  function closeCheckout() {
    if (paying) return;
    setCheckoutPkg(null);
    setPayError('');
  }

  async function confirmPay() {
    if (!checkoutPkg || paying) return;
    setPaying(true);
    setPayError('');
    try {
      const order = await createMembershipOrder(checkoutPkg.id);
      setCheckoutPkg(null);
      navigate(`/settlement?orderId=${order.id}`);
    } catch (err) {
      setPayError(apiErrorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  const actionLabel = (pkg: MembershipCatalogPackage) => {
    if (!isMember) return '立即开通';
    if (status?.levelCode === pkg.levelCode && pkg.packageType === 'auto_renew_monthly') {
      return '立即续费';
    }
    return '切换套餐';
  };

  return (
    <ResearchLayout session={session} onLogout={onLogout} activeNav="home">
      <main className="membership-page">
        <header className="membership-hero">
          <h1>会员中心</h1>
          <p>选择适合的研究会员版本，按月获得算力积分与对应能力</p>
        </header>

        <section className="membership-status-card">
          <div className="membership-status-main">
            <Crown size={20} />
            <div>
              <strong>
                {isMember
                  ? `${status?.levelName || '会员'}${status?.autoRenew ? ' · 连续包月' : ''}`
                  : '当前为免费版'}
              </strong>
              <p>
                {isMember
                  ? `有效期至 ${status?.endAt ?? '—'}${remainingDays != null ? ` · 剩余 ${remainingDays} 天` : ''}`
                  : '开通会员后可获得更高月度积分与高级研究能力'}
              </p>
            </div>
          </div>
          <div className="membership-status-meta">
            <span className="membership-status-balance">
              剩余积分{' '}
              <b>{(points?.balance ?? status?.pointsBalance ?? 0).toLocaleString()}</b>
            </span>
            <span>
              本月已用{' '}
              <b>
                {(points?.monthlyUsed ?? 0).toLocaleString()} /{' '}
                {(points?.monthlyLimit ?? currentEdition?.monthlyLimit ?? 2000).toLocaleString()}
              </b>
            </span>
            <button type="button" className="membership-primary-btn" onClick={() => handleActivate()}>
              {isMember ? '续费/升级' : '立即开通'}
            </button>
          </div>
        </section>

        {(notice || error) && (
          <div className={`membership-notice ${error ? 'is-error' : ''}`}>
            {error || notice}
          </div>
        )}

        <div className="membership-edition-tabs" role="tablist" aria-label="会员版本">
          {editions.map((edition) => (
            <button
              key={edition.code}
              type="button"
              role="tab"
              aria-selected={edition.code === currentEdition?.code}
              className={`membership-edition-tab${edition.code === currentEdition?.code ? ' is-active' : ''}`}
              onClick={() => setSelectedEdition(edition.code)}
            >
              {edition.name}
            </button>
          ))}
        </div>

        <section className="membership-edition-panel">
          <div className="membership-edition-head">
            <h2>{currentEdition?.name}会员</h2>
            <p>
              {catalog?.discountTip ??
                '季付按月价 7 折，年付按月价 6 折；季付/年付一次付清、到期手动续费。连续包月首月 7 折（每账号限一次）。'}
            </p>
          </div>

          <div className="membership-plan-grid" aria-label="会员套餐">
            {loading && packages.length === 0 ? (
              <div className="membership-loading">正在加载套餐…</div>
            ) : packages.length === 0 ? (
              <div className="membership-loading">该版本暂无可售套餐</div>
            ) : (
              packages.map((pkg) => {
                const recommended =
                  pkg.tag === 'recommended' || pkg.packageType === 'yearly';
                const badge = packageBadge(pkg);
                const features =
                  currentEdition?.features ??
                  FALLBACK_EDITIONS.find((item) => item.code === pkg.levelCode)?.features ??
                  [];
                return (
                  <article
                    key={pkg.id}
                    className={`membership-plan-card ${recommended ? 'is-recommended' : ''}`}
                  >
                    {badge ? (
                      <span className={`plan-badge${recommended ? ' is-hot' : ''}`}>{badge}</span>
                    ) : null}
                    <div className="plan-head">
                      <Crown size={18} className={recommended ? 'gold' : ''} />
                      <div>
                        <strong>{pkg.levelName}</strong>
                        <span>
                          {pkg.name} · {currentEdition?.scenario ?? '研究会员'}
                        </span>
                      </div>
                    </div>
                    <div className="plan-price">
                      <b>{formatMoney(pkg.price)}</b>
                      <small>{priceUnit(pkg.packageType)}</small>
                      {pkg.originalPrice ? <s>{formatMoney(pkg.originalPrice)}</s> : null}
                    </div>
                    <p className="plan-desc">{pkg.description}</p>
                    {pkg.packageType === 'auto_renew_monthly' && pkg.renewPrice ? (
                      <p className="plan-desc plan-desc-sub">
                        次月起 {formatMoney(pkg.renewPrice)}/月自动续费
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className={`membership-plan-btn ${recommended ? 'is-gold' : ''}`}
                      onClick={() => handleActivate(pkg)}
                    >
                      {actionLabel(pkg)}
                    </button>
                    <ul>
                      {features.map((feature) => (
                        <li key={feature}>
                          <Check size={14} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="membership-compare">
          <h2>会员权益对比</h2>
          <div className="membership-compare-table">
            <div className="compare-row compare-head">
              <span>权益</span>
              <span>免费版</span>
              <span>普通版</span>
              <span>Plus</span>
              <span className="is-pro">Pro</span>
            </div>
            {compareRows.map((row) => (
              <div className="compare-row" key={row.feature}>
                <span>{row.feature}</span>
                <span>{row.free}</span>
                <span>{row.normal}</span>
                <span>{row.plus}</span>
                <span className="is-pro">{row.pro}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {checkoutPkg && (
        <div
          className="membership-pay-mask"
          role="presentation"
          onClick={closeCheckout}
        >
          <div
            className="membership-pay-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="membership-pay-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="membership-pay-head">
              <h2 id="membership-pay-title">确认支付</h2>
              <button
                type="button"
                className="membership-pay-close"
                onClick={closeCheckout}
                aria-label="关闭"
                disabled={paying}
              >
                <X size={18} />
              </button>
            </header>
            <div className="membership-pay-body">
              <div className="membership-pay-plan">
                {checkoutPkg.levelName} · {checkoutPkg.name}
              </div>
              <div className="membership-pay-price">
                {formatMoney(checkoutPkg.price)}
                {priceUnit(checkoutPkg.packageType)}
              </div>
              <p className="membership-pay-hint">
                确认后将生成待支付订单，并进入结算支付页完成模拟支付
              </p>
              {payError ? (
                <p className="membership-pay-error" role="alert">
                  {payError}
                </p>
              ) : null}
            </div>
            <footer className="membership-pay-foot">
              <button
                type="button"
                className="membership-pay-cancel"
                onClick={closeCheckout}
                disabled={paying}
              >
                取消
              </button>
              <button
                type="button"
                className="membership-pay-confirm"
                onClick={() => void confirmPay()}
                disabled={paying}
              >
                {paying ? '创建订单…' : '去结算支付'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </ResearchLayout>
  );
}
