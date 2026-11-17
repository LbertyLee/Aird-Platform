import {
  CreditCard,
  Crown,
  FileText,
  History,
  LogIn,
  LogOut,
  Receipt,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { LoginResponse } from '@agent/contracts';
import {
  fetchMembershipStatus,
  type MembershipStatus,
} from '../api/membership';
import EditProfileModal from '../components/EditProfileModal';
import NotificationCenter from '../components/NotificationCenter';
import { SESSION_UPDATED_EVENT } from '../api/http';
import logoAi from '../assets/logo-ai.svg';

/** 会员状态变更后通知顶栏刷新 */
export const MEMBERSHIP_UPDATED_EVENT = 'aird:membership-updated';

export { SESSION_UPDATED_EVENT };

export function notifyMembershipUpdated(detail?: MembershipStatus) {
  window.dispatchEvent(
    new CustomEvent(MEMBERSHIP_UPDATED_EVENT, { detail }),
  );
}

export function notifySessionUpdated(session: LoginResponse) {
  window.dispatchEvent(
    new CustomEvent(SESSION_UPDATED_EVENT, { detail: session }),
  );
}

function avatarText(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : '用';
}

export default function ResearchLayout({
  children,
  session,
  onLogout,
  activeNav,
}: {
  children?: ReactNode;
  session: LoginResponse | null;
  onLogout: () => void;
  hasResult?: boolean;
  activeNav?: 'home' | 'knowledge' | 'history' | 'agents';
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const displayName = session?.profile.displayName || session?.profile.username;
  const secondaryId = session?.profile.username;
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (!session?.accessToken) {
        if (!cancelled) setMembership(null);
        return;
      }
      try {
        const next = await fetchMembershipStatus();
        if (!cancelled) setMembership(next);
      } catch {
        if (!cancelled) setMembership(null);
      }
    }

    void loadStatus();

    function onMembershipUpdated(event: Event) {
      const detail = (event as CustomEvent<MembershipStatus | undefined>).detail;
      if (detail) {
        setMembership(detail);
        return;
      }
      void loadStatus();
    }

    window.addEventListener(MEMBERSHIP_UPDATED_EVENT, onMembershipUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(MEMBERSHIP_UPDATED_EVENT, onMembershipUpdated);
    };
  }, [session?.accessToken]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const isMember = Boolean(membership?.isMember);
  const membershipLabel = isMember
    ? membership?.levelName || '会员'
    : '加入会员';
  const currentNav = activeNav ?? (
    location.pathname.startsWith('/knowledge')
      ? 'knowledge'
      : location.pathname === '/agents'
        ? 'agents'
        : location.pathname === '/research' &&
            new URLSearchParams(location.search).get('view') === 'history'
          ? 'history'
          : 'home'
  );

  function go(path: string) {
    setMenuOpen(false);
    navigate(path);
  }

  function openProfileEditor() {
    setMenuOpen(false);
    setProfileOpen(true);
  }

  return (
    <div className="research-shell">
      <header className="research-navbar">
        <div className="navbar-inner">
          <button className="research-brand" onClick={() => navigate('/research')}>
            <img src={logoAi} alt="AID" />
            <strong>AI数智研究平台</strong>
          </button>
          <nav className="research-nav" aria-label="主导航">
            <button
              type="button"
              className={currentNav === 'home' ? 'active' : ''}
              onClick={() => navigate('/research')}
            >
              首页
            </button>
            <button
              type="button"
              className={currentNav === 'knowledge' ? 'active' : ''}
              onClick={() => navigate('/knowledge')}
            >
              知识库
            </button>
            <button
              type="button"
              className={currentNav === 'agents' ? 'active' : ''}
              onClick={() => navigate('/agents')}
            >
              智能体
            </button>
            <button
              type="button"
              className={currentNav === 'history' ? 'active' : ''}
              onClick={() => navigate('/research?view=history')}
            >
              <History size={14} />
              历史记录
            </button>
          </nav>
          <div className="research-account">
            <NotificationCenter enabled={Boolean(session)} />
            <button
              type="button"
              className={`membership-button${isMember ? ' is-member' : ''}`}
              onClick={() => navigate('/membership')}
              title={
                isMember && membership?.endAt
                  ? `有效期至 ${membership.endAt}`
                  : undefined
              }
            >
              <Crown size={14} />
              {membershipLabel}
            </button>
            {session ? (
              <button
                type="button"
                className="membership-button is-member"
                onClick={() => navigate('/points')}
                title="积分中心"
              >
                <CreditCard size={14} />
                积分{' '}
                {(membership?.pointsBalance ?? 0).toLocaleString()}
              </button>
            ) : null}
            {session ? (
              <div className="account-menu" ref={menuRef}>
                <button
                  type="button"
                  className="account-trigger"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <span className="account-avatar">{avatarText(displayName || '')}</span>
                  <span className="account-meta">
                    <strong>{displayName}</strong>
                  </span>
                </button>
                {menuOpen ? (
                  <div className="account-dropdown" role="menu">
                    <div className="account-dropdown-head">
                      <span className="account-avatar">{avatarText(displayName || '')}</span>
                      <div>
                        <strong>{displayName}</strong>
                        {secondaryId ? <small>{secondaryId}</small> : null}
                      </div>
                    </div>
                    <button type="button" role="menuitem" onClick={() => go('/knowledge')}>
                      <FileText size={15} />
                      我的数据
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('/research')}>
                      <FileText size={15} />
                      我的报告
                    </button>
                    <button type="button" role="menuitem" onClick={openProfileEditor}>
                      <Settings size={15} />
                      修改个人信息
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('/settlement')}>
                      <CreditCard size={15} />
                      结算支付
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('/billing')}>
                      <Receipt size={15} />
                      账单查询
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                    >
                      <LogOut size={15} />
                      退出登录
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button type="button" className="login-button" onClick={() => navigate('/login')}>
                <LogIn size={15} />
                登录
              </button>
            )}
          </div>
        </div>
      </header>
      {children ?? <Outlet />}
      {profileOpen && session ? (
        <EditProfileModal
          session={session}
          onClose={() => setProfileOpen(false)}
          onSaved={(next) => {
            notifySessionUpdated(next);
          }}
        />
      ) : null}
    </div>
  );
}
