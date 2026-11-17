import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Coins, Gift, TrendingUp } from 'lucide-react';
import type { LoginResponse } from '@agent/contracts';
import {
  claimDailyPoints,
  fetchPointLedgers,
  fetchPointSummary,
  type PointLedgerPage,
  type PointSummary,
} from '../api/membership';
import { apiErrorMessage } from '../api/research';
import ResearchLayout, {
  notifyMembershipUpdated,
} from '../layouts/ResearchLayout';
import './PointsPage.css';

const sourceLabel: Record<string, string> = {
  registration: '注册赠送',
  free_monthly: '每月自动赠送',
  membership_monthly: '会员月度赠送',
  daily: '每日积分',
  consume: '算力消耗',
  refund: '学习失败退款',
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export default function PointsPage({
  session,
  onLogout,
}: {
  session: LoginResponse | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<PointSummary | null>(null);
  const [ledgerPage, setLedgerPage] = useState<PointLedgerPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!session) {
      navigate('/login', { replace: true });
      return;
    }
    void fetchPointSummary()
      .then(setSummary)
      .catch((requestError) => setError(apiErrorMessage(requestError)));
  }, [session, navigate]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLedgerLoading(true);
    void fetchPointLedgers({ page, pageSize })
      .then((result) => {
        if (!cancelled) setLedgerPage(result);
      })
      .catch((requestError) => {
        if (!cancelled) setError(apiErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, page, pageSize]);

  async function claim() {
    setClaiming(true);
    setError('');
    try {
      const nextSummary = await claimDailyPoints();
      setSummary(nextSummary);
      setPage(1);
      setLedgerPage(await fetchPointLedgers({ page: 1, pageSize }));
      notifyMembershipUpdated();
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setClaiming(false);
    }
  }

  const percent = summary?.monthlyLimit
    ? Math.min(100, (summary.monthlyUsed / summary.monthlyLimit) * 100)
    : 0;
  const rules = summary?.rules;
  const dailyAmount = summary?.daily.amount ?? rules?.dailyPoints ?? 50;
  const freeLimit = rules?.freeMonthlyLimit ?? 2000;
  const memberRuleText = rules?.levels?.length
    ? rules.levels
        .map((item) => `${item.name} ${item.monthlyPoints.toLocaleString()}`)
        .join('，')
    : '按会员版本每月发放';
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((ledgerPage?.total ?? 0) / pageSize)),
    [ledgerPage?.total, pageSize],
  );

  return (
    <ResearchLayout session={session} onLogout={onLogout} activeNav="home">
      <main className="points-page">
        <header className="points-hero">
          <span>积分中心</span>
          <h1>套餐与用量</h1>
          <p>查看算力积分余额、月度套餐额度与全部获取、消耗记录。</p>
        </header>
        {error ? <div className="points-error">{error}</div> : null}
        <section className="points-stats">
          <article>
            <Coins />
            <small>当前可用积分</small>
            <strong>{summary?.balance.toLocaleString() ?? '—'}</strong>
            <em>
              按模型实际输入、输出 Token 折算；余额低于{' '}
              {rules?.minSearchPoints ?? 20} 时不可智搜
            </em>
          </article>
          <article>
            <Gift />
            <small>累计获得</small>
            <strong>{summary?.totalEarned.toLocaleString() ?? '—'}</strong>
            <em>注册、自动、每日及会员赠送</em>
          </article>
          <article>
            <TrendingUp />
            <small>本月消耗</small>
            <strong>{summary?.monthlyUsed.toLocaleString() ?? '—'}</strong>
            <em>本月累计使用积分</em>
          </article>
          <article>
            <Check />
            <small>今日领取</small>
            <strong>{summary?.daily.claimed ? '已领取' : '待领取'}</strong>
            <em>每日可领取 {dailyAmount} 积分</em>
          </article>
        </section>
        <section className="points-grid">
          <article className="points-card points-quota">
            <h2>当前套餐用量</h2>
            <p>
              {summary?.membership
                ? `${summary.membership.levelName} · 有效期至 ${summary.membership.endAt}`
                : `免费版 · 每月最多 ${freeLimit.toLocaleString()} 积分`}
            </p>
            <div className="points-usage">
              <span>本月积分已使用 / 月度最高积分</span>
              <b>
                {summary?.monthlyUsed ?? 0} /{' '}
                {summary?.monthlyLimit.toLocaleString() ?? 0}
              </b>
            </div>
            <div className="points-progress">
              <i style={{ width: `${percent}%` }} />
            </div>
            <p className="points-tip">
              会员积分按自然月发放；免费积分由注册、每月赠送及每日领取组成。
            </p>
          </article>
          <article className="points-card">
            <h2>积分获取规则</h2>
            <div className="points-rule">
              <b>
                注册赠送 · +
                {(rules?.registrationPoints ?? 500).toLocaleString()}
              </b>
              <span>新用户首次登录自动到账</span>
            </div>
            <div className="points-rule">
              <b>
                每月自动赠送 · +
                {(rules?.monthlyFreePoints ?? 500).toLocaleString()}
              </b>
              <span>所有用户按自然月自动到账</span>
            </div>
            <div className="points-rule">
              <b>每日积分 · +{dailyAmount}</b>
              <span>每日仅可领取一次</span>
            </div>
            <div className="points-rule">
              <b>会员月度赠送</b>
              <span>{memberRuleText}</span>
            </div>
          </article>
        </section>
        <section className="points-daily">
          <div>
            <Gift />
            <div>
              <h2>每日积分中心</h2>
              <p>
                每天可领取 {dailyAmount} 算力积分，免费赠送积分本月合计最多{' '}
                {freeLimit.toLocaleString()}。
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!summary || summary.daily.claimed || claiming}
            onClick={() => void claim()}
          >
            {summary?.daily.claimed
              ? '今日已领取'
              : claiming
                ? '领取中…'
                : '立即领取'}
          </button>
        </section>
        <section className="points-card points-ledger">
          <div className="points-ledger-heading">
            <h2>最近积分流水</h2>
            <label>
              每页
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                aria-label="每页流水条数"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="points-ledger-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>说明</th>
                  <th>积分变动</th>
                  <th>余额</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading ? (
                  <tr>
                    <td colSpan={5} className="points-ledger-empty">
                      加载中…
                    </td>
                  </tr>
                ) : ledgerPage?.items.length ? (
                  ledgerPage.items.map((item) => (
                    <tr key={item.id}>
                      <td>{sourceLabel[item.source] ?? item.source}</td>
                      <td>{item.description}</td>
                      <td className={item.amount > 0 ? 'income' : 'expense'}>
                        {item.amount > 0 ? '+' : ''}
                        {item.amount}
                      </td>
                      <td>{item.balanceAfter}</td>
                      <td>{item.createdAt}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="points-ledger-empty">
                      暂无积分流水
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="points-ledger-pagination">
            <span>共 {ledgerPage?.total ?? 0} 条</span>
            <div>
              <button
                type="button"
                disabled={page <= 1 || ledgerLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <span>
                第 {page} / {totalPages} 页
              </span>
              <button
                type="button"
                disabled={page >= totalPages || ledgerLoading}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </main>
    </ResearchLayout>
  );
}
