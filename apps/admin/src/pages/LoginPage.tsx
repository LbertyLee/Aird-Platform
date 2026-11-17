import './LoginPage.css';
import { Alert, App, Button, Checkbox, Form, Input } from 'antd';
import { Lock, Smartphone, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginApi, phoneLoginApi, sendSmsCodeApi } from '../api/auth';
import { scheduleAccessTokenRefresh } from '../api/http';
import { useSessionStore } from '../stores/session';
import { firstAccessibleAdminPage } from '../routes/admin-permissions';
import logoAi from '../assets/imgs/logo-ai.svg';
import loginBoxBg from '../assets/svgs/login-box-bg.svg';

const LOGIN_CACHE_KEY = 'admin-login-cache';
const APP_TITLE = 'AI数智研究平台管理端';

type LoginView = 'login' | 'mobile' | 'register';

type LoginCache = {
  username: string;
  rememberMe: boolean;
};

function readLoginCache(): LoginCache | null {
  try {
    const raw = localStorage.getItem(LOGIN_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LoginCache;
  } catch {
    return null;
  }
}

function writeLoginCache(cache: LoginCache) {
  localStorage.setItem(LOGIN_CACHE_KEY, JSON.stringify(cache));
}

function clearLoginCache() {
  localStorage.removeItem(LOGIN_CACHE_KEY);
}

/**
 * 管理端登录页。
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const setSession = useSessionStore((s) => s.setSession);
  const [view, setView] = useState<LoginView>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [mobilePhone, setMobilePhone] = useState('');
  const [mobileCode, setMobileCode] = useState('');
  const [smsCooldown, setSmsCooldown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);
  const [form] = Form.useForm<{ username: string; password: string }>();

  useEffect(() => {
    if (smsCooldown <= 0) return;
    const timer = window.setTimeout(
      () => setSmsCooldown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [smsCooldown]);

  useEffect(() => {
    const cache = readLoginCache();
    if (!cache) return;
    setRememberMe(cache.rememberMe);
    if (cache.rememberMe && cache.username) {
      form.setFieldsValue({ username: cache.username });
    }
  }, [form]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loginApi(values);
      if (rememberMe) {
        writeLoginCache({ username: values.username, rememberMe: true });
      } else {
        clearLoginCache();
      }
      setSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        permissionCodes: result.permissionCodes,
        profile: result.profile,
      });
      scheduleAccessTokenRefresh();
      navigate(firstAccessibleAdminPage(result.permissionCodes), { replace: true });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '登录失败，请检查账号密码';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    message.info('忘记密码功能开发中，请联系管理员重置密码');
  };

  const handleMobileLogin = () => {
    setView('mobile');
    setError(null);
  };

  const handleRegister = () => {
    setView('register');
    setError(null);
  };

  const handleBackLogin = () => {
    setView('login');
    setError(null);
  };

  const renderTitle = () => {
    if (view === 'mobile') return '手机登录';
    if (view === 'register') return '注册';
    return '登录';
  };

  const renderLoginForm = () => (
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        initialValues={{ username: 'netsoil' }}
        requiredMark={false}
        className="login-form"
      >
        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input
            size="large"
            placeholder="请输入用户名"
            prefix={<User size={16} className="login-input-icon" />}
            autoFocus
          />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password
            size="large"
            placeholder="请输入密码"
            prefix={<Lock size={16} className="login-input-icon" />}
          />
        </Form.Item>
        <div className="login-form-options">
          <Checkbox
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
          >
            记住我
          </Checkbox>
          <button
            type="button"
            className="login-link-btn"
            onClick={handleForgotPassword}
          >
            忘记密码?
          </button>
        </div>
        <Button
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={loading}
          className="login-submit"
        >
          登录
        </Button>
        <div className="login-quick-actions">
          <button
            type="button"
            className="login-link-btn"
            onClick={handleMobileLogin}
          >
            手机登录
          </button>
          <span className="login-quick-divider" />
          <button
            type="button"
            className="login-link-btn"
            onClick={handleRegister}
          >
            注册
          </button>
        </div>
      </Form>
  );

  const handleSendSms = async () => {
    const phone = mobilePhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      message.error('请输入正确的手机号');
      return;
    }
    setSmsSending(true);
    setError(null);
    try {
      await sendSmsCodeApi(phone, 'login');
      setSmsCooldown(60);
      message.success('验证码已发送');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '发送失败，请稍后重试';
      setError(String(msg));
    } finally {
      setSmsSending(false);
    }
  };

  const handleMobileSubmit = async () => {
    const phone = mobilePhone.trim();
    const code = mobileCode.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setError('请输入正确的手机号');
      return;
    }
    if (code.length < 4) {
      setError('请输入验证码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await phoneLoginApi(phone, code);
      setSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        permissionCodes: result.permissionCodes,
        profile: result.profile,
      });
      scheduleAccessTokenRefresh();
      navigate(firstAccessibleAdminPage(result.permissionCodes), {
        replace: true,
      });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || '登录失败，请检查验证码';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  const renderMobileForm = () => (
    <div className="login-placeholder-form">
      <Form layout="vertical" className="login-form">
        <Form.Item label="手机号码">
          <Input
            size="large"
            placeholder="请输入手机号码"
            prefix={<Smartphone size={16} className="login-input-icon" />}
            value={mobilePhone}
            onChange={(event) => setMobilePhone(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="验证码">
          <Input
            size="large"
            placeholder="请输入验证码"
            value={mobileCode}
            onChange={(event) => setMobileCode(event.target.value)}
            addonAfter={
              <button
                type="button"
                className="login-sms-code"
                disabled={smsSending || smsCooldown > 0}
                onClick={() => void handleSendSms()}
              >
                {smsSending
                  ? '发送中'
                  : smsCooldown > 0
                    ? `${smsCooldown}s`
                    : '获取验证码'}
              </button>
            }
          />
        </Form.Item>
        <Button
          type="primary"
          block
          size="large"
          className="login-submit"
          loading={loading}
          onClick={() => void handleMobileSubmit()}
        >
          登录
        </Button>
        <Button block size="large" className="login-back-btn" onClick={handleBackLogin}>
          返回
        </Button>
      </Form>
    </div>
  );

  const renderRegisterForm = () => (
    <div className="login-placeholder-form">
      <Alert
        type="info"
        showIcon
        message="注册功能开发中"
        description="当前仅支持管理员分配账号，如需开通请联系平台管理员。"
        className="login-placeholder-alert"
      />
      <Button block size="large" className="login-back-btn" onClick={handleBackLogin}>
        返回登录
      </Button>
    </div>
  );

  return (
    <div className="login-page">
      <div className="login-page__left">
        <div className="login-page__brand">
          <img alt="AID" className="login-page__logo" src={logoAi} />
          <span className="login-page__brand-title">{APP_TITLE}</span>
        </div>
        <div className="login-page__hero">
          <img
            alt=""
            className="login-page__hero-image"
            src={loginBoxBg}
          />
          <h2 className="login-page__welcome">欢迎使用 AI 数智研究平台</h2>
          <p className="login-page__message">
            一站式数据智能检索 · 深度分析 · 知识库管理，让研究更高效
          </p>
        </div>
      </div>

      <div className="login-page__right">
        <div className="login-page__mobile-brand">
          <img alt="AID" className="login-page__logo login-page__logo--sm" src={logoAi} />
          <span className="login-page__brand-title">{APP_TITLE}</span>
        </div>

        <div className="login-page__panel-wrap">
          <div className="login-page__panel">
            <h1 className="login-page__form-title">{renderTitle()}</h1>

            {error ? (
              <Alert
                style={{ marginBottom: 16 }}
                type="error"
                message={error}
              />
            ) : null}

            {view === 'login' && renderLoginForm()}
            {view === 'mobile' && renderMobileForm()}
            {view === 'register' && renderRegisterForm()}
          </div>
        </div>
      </div>
    </div>
  );
}
