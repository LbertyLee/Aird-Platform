import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { LoginResponse } from '@agent/contracts';
import {
  fetchMyProfile,
  saveUserSession,
  updateMyProfile,
} from '../api/auth';
import { apiErrorMessage } from '../api/research';

export default function EditProfileModal({
  session,
  onClose,
  onSaved,
}: {
  session: LoginResponse;
  onClose: () => void;
  onSaved: (next: LoginResponse) => void;
}) {
  const [displayName, setDisplayName] = useState(
    session.profile.displayName || '',
  );
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const profile = await fetchMyProfile();
        if (cancelled) return;
        setDisplayName(profile.displayName || session.profile.displayName || '');
        setPhone(profile.phone || '');
        setEmail(profile.email || '');
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session.profile.displayName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = displayName.trim();
    if (!name) {
      setError('请填写姓名');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const profile = await updateMyProfile({
        displayName: name,
        phone: phone.trim(),
        email: email.trim(),
      });
      const next: LoginResponse = {
        ...session,
        profile: {
          ...session.profile,
          displayName: profile.displayName ?? name,
        },
      };
      saveUserSession(next);
      onSaved(next);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kb-modal-mask" role="presentation" onClick={onClose}>
      <form
        className="kb-modal edit-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-profile-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <div className="kb-modal-head">
          <h2 id="edit-profile-title">修改个人信息</h2>
          <button
            type="button"
            className="kb-modal-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="kb-modal-body">
          {loading ? (
            <p className="edit-profile-hint">正在加载个人信息…</p>
          ) : (
            <>
              <label>
                <span>姓名</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="请输入姓名"
                  maxLength={64}
                  autoFocus
                />
              </label>
              <label>
                <span>手机号</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="请输入手机号"
                  maxLength={32}
                />
              </label>
              <label>
                <span>邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="选填"
                  maxLength={128}
                />
              </label>
            </>
          )}
          {error ? <p className="edit-profile-error">{error}</p> : null}
          <div className="kb-modal-foot">
            <button type="button" className="kb-secondary-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="kb-primary-btn"
              disabled={loading || saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
