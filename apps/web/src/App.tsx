import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { LoginResponse, ResearchSearchResponse } from '@agent/contracts';
import DataAnalysisWorkspace from './DataAnalysisWorkspace';
import AuthPage from './pages/AuthPage';
import BillingPage from './pages/BillingPage';
import KnowledgeDetailPage from './pages/KnowledgeDetailPage';
import KnowledgePage from './pages/KnowledgePage';
import MembershipPage from './pages/MembershipPage';
import PointsPage from './pages/PointsPage';
import ResearchPage from './pages/ResearchPage';
import SearchResultsPage from './pages/SearchResultsPage';
import SettlementPage from './pages/SettlementPage';
import AgentCenterPage from './pages/AgentCenterPage';
import ResearchLayout from './layouts/ResearchLayout';
import type { PendingSearchJob } from './search-progress';
import {
  clearUserSession,
  login,
  phoneLogin,
  register,
  readUserSession,
  saveUserSession,
  bootstrapUserSessionRefresh,
} from './api/auth';
import { SESSION_UPDATED_EVENT } from './api/http';

function AuthRoute({
  registerMode,
  onAuthenticated,
}: {
  registerMode: boolean;
  onAuthenticated: (session: LoginResponse) => void;
}) {
  const navigate = useNavigate();
  return (
    <AuthPage
      registerMode={registerMode}
      onSubmit={async (values) => {
        const session = registerMode
          ? await register({
              username: values.username?.trim() || values.phone,
              password: values.password || `${values.phone}:sms`,
              phone: values.phone,
              code: values.code,
            })
          : values.password
            ? await login({
                username: values.username?.trim() || values.phone,
                password: values.password,
              })
            : await phoneLogin(values.phone, values.code);
        saveUserSession(session);
        onAuthenticated(session);
        navigate('/research', { replace: true });
      }}
    />
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<LoginResponse | null>(() =>
    readUserSession(),
  );
  const [result, setResult] = useState<ResearchSearchResponse | null>(() => {
    try {
      const raw = window.sessionStorage.getItem('research:last-result');
      return raw ? (JSON.parse(raw) as ResearchSearchResponse) : null;
    } catch {
      return null;
    }
  });
  const [pendingSearch, setPendingSearch] = useState<PendingSearchJob | null>(
    () => {
      try {
        const saved = JSON.parse(
          window.sessionStorage.getItem(
            `research:pending-search:${readUserSession()?.profile.id ?? 'anonymous'}`,
          ) || 'null',
        ) as PendingSearchJob | null;
        return saved &&
          typeof saved.query === 'string' &&
          saved.filters &&
          typeof saved.startedAt === 'number' &&
          Date.now() - saved.startedAt < 7_200_000
          ? saved
          : null;
      } catch {
        return null;
      }
    },
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [hasCurrentSearch, setHasCurrentSearch] = useState(false);
  const [readyAnalysisId, setReadyAnalysisId] = useState<string | null>(null);

  useEffect(() => {
    const key = `research:pending-search:${session?.profile.id ?? 'anonymous'}`;
    try {
      if (pendingSearch)
        window.sessionStorage.setItem(key, JSON.stringify(pendingSearch));
      else window.sessionStorage.removeItem(key);
    } catch {
      /* Recovery is optional when browser storage is disabled. */
    }
  }, [pendingSearch, session?.profile.id]);

  const logout = () => {
    window.sessionStorage.removeItem(
      `research:pending-search:${session?.profile.id ?? 'anonymous'}`,
    );
    clearUserSession();
    setSession(null);
    setPendingSearch(null);
    setResult(null);
    setSelectedIds([]);
    setReadyAnalysisId(null);
    setAnalysisPending(false);
    setHasCurrentSearch(false);
    window.sessionStorage.removeItem('research:last-result');
  };

  useEffect(() => {
    bootstrapUserSessionRefresh();
    function onSessionUpdated(event: Event) {
      const detail = (event as CustomEvent<LoginResponse>).detail;
      if (detail) setSession(detail);
    }
    window.addEventListener(SESSION_UPDATED_EVENT, onSessionUpdated);
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, onSessionUpdated);
    };
  }, []);

  const persistResult = (next: ResearchSearchResponse) => {
    setResult(next);
    setPendingSearch(null);
    try {
      window.sessionStorage.setItem(
        'research:last-result',
        JSON.stringify(next),
      );
    } catch {
      /* storage may be unavailable */
    }
  };

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute registerMode={false} onAuthenticated={setSession} />
          }
        />
        <Route
          path="/register"
          element={<AuthRoute registerMode onAuthenticated={setSession} />}
        />
        <Route
          path="/membership"
          element={<MembershipPage session={session} onLogout={logout} />}
        />
        <Route
          path="/points"
          element={<PointsPage session={session} onLogout={logout} />}
        />
        <Route
          path="/billing"
          element={<BillingPage session={session} onLogout={logout} />}
        />
        <Route
          path="/settlement"
          element={<SettlementPage session={session} onLogout={logout} />}
        />
        <Route
          path="/settlement/return"
          element={<SettlementPage session={session} onLogout={logout} />}
        />
        <Route element={<ResearchLayout session={session} onLogout={logout} />}>
          <Route
            path="/research"
            element={
              <ResearchPage
                session={session}
                onHistorySelect={(next) => {
                  persistResult(next);
                  setSelectedIds([]);
                }}
                onStartSearch={(job) => {
                  // A new run owns the results view. Drop the previous run so a
                  // failed request can never leave stale data visible.
                  setResult(null);
                  setReadyAnalysisId(null);
                  setSearchFailed(false);
                  setHasCurrentSearch(true);
                  try {
                    window.sessionStorage.removeItem('research:last-result');
                  } catch {
                    /* storage may be unavailable */
                  }
                  setPendingSearch(job);
                  setSelectedIds([]);
                }}
              />
            }
          />
          <Route
            path="/knowledge"
            element={<KnowledgePage session={session} />}
          />
          <Route
            path="/knowledge/:id"
            element={<KnowledgeDetailPage session={session} />}
          />
          <Route
            path="/agents"
            element={<AgentCenterPage session={session} />}
          />
        </Route>
        <Route
          path="/results"
          element={
            !pendingSearch && !result ? (
              <Navigate to="/research" replace />
            ) : null
          }
        />
        <Route
          path="/analysis"
          element={
            result ||
            new URLSearchParams(location.search).has('sessionId') ? (
              <DataAnalysisWorkspace
                result={result}
                selectedIds={selectedIds}
                onBack={() => navigate(result ? '/results' : '/research')}
                session={session}
                onLogout={logout}
              />
            ) : (
              <Navigate to="/research" replace />
            )
          }
        />
        <Route path="/" element={<Navigate to="/research" replace />} />
        <Route path="*" element={<Navigate to="/research" replace />} />
      </Routes>
      {(pendingSearch || result) && (
        <div hidden={location.pathname !== '/results'}>
          <SearchResultsPage
            session={session}
            result={result}
            pendingSearch={pendingSearch}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onResult={persistResult}
            onClearPending={() => setPendingSearch(null)}
            onHistorySelect={(next) => {
              persistResult(next);
              setSelectedIds([]);
            }}
            onAnalysisPending={setAnalysisPending}
            onSearchFailed={setSearchFailed}
            onAnalysisReady={(id) => {
              setReadyAnalysisId(id);
              if (window.location.pathname === '/results') {
                navigate(
                  `/analysis?sessionId=${encodeURIComponent(id)}&view=matrix`,
                );
              }
            }}
            onLogout={logout}
            onBack={() => navigate('/research')}
          />
        </div>
      )}
      {location.pathname !== '/results' &&
        location.pathname !== '/analysis' &&
        (pendingSearch ||
          analysisPending ||
          readyAnalysisId ||
          (hasCurrentSearch && result)) && (
          <button
            type="button"
            className="current-research-task"
            onClick={() =>
              navigate(
                readyAnalysisId && !analysisPending && !pendingSearch
                  ? `/analysis?sessionId=${encodeURIComponent(readyAnalysisId)}&view=matrix`
                  : '/results',
              )
            }
          >
            {analysisPending
              ? '分析任务进行中'
              : pendingSearch
                ? searchFailed
                  ? '查看检索任务'
                  : '检索任务进行中'
                : readyAnalysisId
                  ? '查看分析结果'
                  : '查看检索结果'}
          </button>
        )}
    </>
  );
}
