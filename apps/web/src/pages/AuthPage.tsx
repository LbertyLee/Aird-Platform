import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, LockKeyhole, Phone, UserRound, X } from 'lucide-react';
import { sendSmsCode } from '../api/auth';
import { apiErrorMessage } from '../api/research';
import { fetchLegalDocuments, type LegalDocument, type LegalDocuments } from '../api/legal-documents';

type AuthValues = {
  phone: string;
  code: string;
  username?: string;
  password?: string;
  confirmPassword?: string;
};

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMPTY_DOCUMENT: LegalDocument = { content: '', version: '', updatedAt: '', effectiveAt: '' };
const ALLOWED_LEGAL_TAGS = new Set(['P', 'H2', 'H3', 'STRONG', 'B', 'EM', 'UL', 'OL', 'LI', 'BR']);

function sanitizeLegalHtml(html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (!(child instanceof Element)) continue;
      if (!ALLOWED_LEGAL_TAGS.has(child.tagName)) {
        child.remove();
        continue;
      }
      for (const attribute of Array.from(child.attributes)) child.removeAttribute(attribute.name);
      visit(child);
    }
  };
  visit(template.content);
  return template.innerHTML;
}

function documentMeta(documentInfo: LegalDocument) {
  return [
    documentInfo.version ? `版本：${documentInfo.version}` : '',
    documentInfo.updatedAt ? `更新日期：${documentInfo.updatedAt}` : '',
    documentInfo.effectiveAt ? `生效日期：${documentInfo.effectiveAt}` : '',
  ].filter(Boolean).join('　');
}

export default function AuthPage({
  registerMode,
  onSubmit,
}: {
  registerMode: boolean;
  onSubmit: (values: AuthValues) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<AuthValues>({
    phone: '',
    code: '',
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsCooldown, setSmsCooldown] = useState(0);
  const [loginMethod, setLoginMethod] = useState<'password' | 'sms'>('password');
  const [legalDocuments, setLegalDocuments] = useState<LegalDocuments>({ userAgreement: EMPTY_DOCUMENT, privacyPolicy: EMPTY_DOCUMENT });
  const [legalDocumentsLoading, setLegalDocumentsLoading] = useState(registerMode);
  const [activeLegalDocument, setActiveLegalDocument] = useState<{ title: string; document: LegalDocument } | null>(null);

  useEffect(() => {
    if (!registerMode) return;
    let active = true;
    void fetchLegalDocuments()
      .then((documents) => { if (active) setLegalDocuments(documents); })
      .catch(() => { if (active) setLegalDocuments({ userAgreement: EMPTY_DOCUMENT, privacyPolicy: EMPTY_DOCUMENT }); })
      .finally(() => { if (active) setLegalDocumentsLoading(false); });
    return () => { active = false; };
  }, [registerMode]);

  useEffect(() => {
    if (!activeLegalDocument) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setActiveLegalDocument(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeLegalDocument]);

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setSmsCooldown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [smsCooldown]);

  const update = (key: keyof AuthValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function requestSmsCode() {
    setError('');
    const phone = values.phone.trim();
    if (!PHONE_PATTERN.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    setSmsSending(true);
    try {
      await sendSmsCode(phone, registerMode ? 'register' : 'login');
      setSmsCooldown(60);
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setSmsSending(false);
    }
  }

  const passwordLogin = !registerMode && loginMethod === 'password';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (registerMode && values.password !== values.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(values);
    } catch (requestError) {
      setError(apiErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="user-auth-page">
      <header className="auth-navbar">
        <button className="research-brand" onClick={() => navigate('/research')}>
          <span>AI</span>
          <strong>AI数智研究平台</strong>
        </button>
      </header>
      <section className="auth-stage">
        <div className="auth-intro">
          <div className="auth-intro-mark">AI</div>
          <h1>让数据研究更简单</h1>
          <p>连接多源数据，快速完成检索、分析与研究成果生成。</p>
          <div className="auth-intro-points">
            <span>多源智能检索</span>
            <span>数据可视化分析</span>
            <span>研究成果一键生成</span>
          </div>
        </div>
        <form className="user-auth-form" onSubmit={(event) => void submit(event)}>
          <div className="auth-form-icon">
            <LockKeyhole size={22} />
          </div>
          <div className="auth-heading">
            <h2>{registerMode ? '创建账号' : '欢迎回来'}</h2>
            <p>
              {registerMode
                ? '注册后即可开始使用数据智能搜索'
                : '登录后查看历史记录与完整研究能力'}
            </p>
          </div>
          {!registerMode && (
            <div className="auth-login-methods" role="tablist" aria-label="登录方式">
              <button
                type="button"
                role="tab"
                aria-selected={passwordLogin}
                className={passwordLogin ? 'active' : ''}
                onClick={() => {
                  setLoginMethod('password');
                  setError('');
                  update('code', '');
                }}
              >
                账号密码登录
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!passwordLogin}
                className={!passwordLogin ? 'active' : ''}
                onClick={() => {
                  setLoginMethod('sms');
                  setError('');
                  update('password', '');
                }}
              >
                验证码登录
              </button>
            </div>
          )}
          {registerMode && (
            <>
              <label>
                用户名
                <div className="auth-input">
                  <UserRound size={17} />
                  <input
                    required
                    minLength={3}
                    placeholder="请输入用户名"
                    value={values.username}
                    onChange={(event) => update('username', event.target.value)}
                  />
                </div>
              </label>
              <label>
                密码
                <div className="auth-input">
                  <LockKeyhole size={17} />
                  <input
                    required
                    minLength={6}
                    type="password"
                    placeholder="请输入密码（至少6位）"
                    value={values.password}
                    onChange={(event) => update('password', event.target.value)}
                  />
                </div>
              </label>
              <label>
                确认密码
                <div className="auth-input">
                  <LockKeyhole size={17} />
                  <input
                    required
                    minLength={6}
                    type="password"
                    placeholder="请再次输入密码"
                    value={values.confirmPassword}
                    onChange={(event) =>
                      update('confirmPassword', event.target.value)
                    }
                  />
                </div>
              </label>
            </>
          )}
          {passwordLogin ? (
            <>
              <label>
                账号或手机号
                <div className="auth-input">
                  <UserRound size={17} />
                  <input
                    required
                    minLength={1}
                    placeholder="请输入账号或手机号"
                    value={values.username}
                    onChange={(event) => update('username', event.target.value)}
                  />
                </div>
              </label>
              <label>
                密码
                <div className="auth-input">
                  <LockKeyhole size={17} />
                  <input
                    required
                    minLength={6}
                    type="password"
                    placeholder="请输入密码"
                    value={values.password}
                    onChange={(event) => update('password', event.target.value)}
                  />
                </div>
              </label>
            </>
          ) : (
            <>
              <label>
                手机号
                <div className="auth-input">
                  <Phone size={17} />
                  <input
                    required
                    pattern="^1[3-9]\d{9}$"
                    inputMode="tel"
                    placeholder="请输入手机号"
                    value={values.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </div>
              </label>
              <label>
                验证码
                <div className="auth-input auth-input--code">
                  <KeyRound size={17} />
                  <input
                    required
                    minLength={4}
                    maxLength={4}
                    inputMode="numeric"
                    placeholder="请输入验证码"
                    value={values.code}
                    onChange={(event) => update('code', event.target.value)}
                  />
                  <button
                    type="button"
                    className="auth-sms-send"
                    disabled={smsSending || smsCooldown > 0}
                    onClick={() => void requestSmsCode()}
                  >
                    {smsSending
                      ? '发送中…'
                      : smsCooldown > 0
                        ? `${smsCooldown}s`
                        : '获取验证码'}
                  </button>
                </div>
              </label>
            </>
          )}
          {error && <div className="auth-error">{error}</div>}
          {registerMode && (
            <div className="auth-legal-consent">
              <p>
                用户注册即表示您已阅读并同意
                <button type="button" disabled={!legalDocuments.userAgreement.content} onClick={() => setActiveLegalDocument({ title: '用户协议', document: legalDocuments.userAgreement })}>《用户协议》</button>
                和
                <button type="button" disabled={!legalDocuments.privacyPolicy.content} onClick={() => setActiveLegalDocument({ title: '隐私政策', document: legalDocuments.privacyPolicy })}>《隐私政策》</button>
              </p>
              {(documentMeta(legalDocuments.userAgreement) || documentMeta(legalDocuments.privacyPolicy)) && (
                <div className="auth-legal-meta">
                  {documentMeta(legalDocuments.userAgreement) && <span>用户协议：{documentMeta(legalDocuments.userAgreement)}</span>}
                  {documentMeta(legalDocuments.privacyPolicy) && <span>隐私政策：{documentMeta(legalDocuments.privacyPolicy)}</span>}
                </div>
              )}
              {legalDocumentsLoading && <span className="auth-legal-loading">正在加载协议…</span>}
            </div>
          )}
          <button className="auth-submit" disabled={loading}>
            {loading ? '正在提交...' : registerMode ? '注册并登录' : '登录'}
          </button>
          <p className="auth-switch">
            {registerMode ? '已有账号？' : '还没有账号？'}
            <button
              type="button"
              onClick={() => navigate(registerMode ? '/login' : '/register')}
            >
              {registerMode ? '去登录' : '立即注册'}
            </button>
          </p>
        </form>
      </section>
      {activeLegalDocument && (
        <div className="auth-legal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveLegalDocument(null); }}>
          <section className="auth-legal-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-legal-title">
            <header>
              <div>
                <h2 id="auth-legal-title">{activeLegalDocument.title}</h2>
                {documentMeta(activeLegalDocument.document) && <p>{documentMeta(activeLegalDocument.document)}</p>}
              </div>
              <button type="button" className="auth-legal-close" aria-label="关闭" onClick={() => setActiveLegalDocument(null)}><X size={18} /></button>
            </header>
            <div className="auth-legal-body" dangerouslySetInnerHTML={{ __html: sanitizeLegalHtml(activeLegalDocument.document.content) }} />
          </section>
        </div>
      )}
    </main>
  );
}
