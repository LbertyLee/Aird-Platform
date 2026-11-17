import { useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, X } from 'lucide-react';
import {
  apiErrorMessage,
  createKnowledgeLibrary,
  type KnowledgeVisibility,
  type UserKnowledgeLibrary,
} from '../api/knowledge';

const COVER_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#f97316',
  '#ef4444',
  '#14b8a6',
] as const;

export default function CreateLibraryModal({
  onClose,
  onCreated,
  maskClassName,
  radioName = 'visibility',
}: {
  onClose: () => void;
  onCreated: (library: UserKnowledgeLibrary) => void | Promise<void>;
  maskClassName?: string;
  /** 嵌套弹窗时需唯一 name，避免与外层表单 radio 冲突 */
  radioName?: string;
}) {
  const [name, setName] = useState('');
  const [intro, setIntro] = useState('');
  const [visibility, setVisibility] = useState<KnowledgeVisibility>('private');
  const [color, setColor] = useState<string>(COVER_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => name.trim().length > 0 && !submitting, [name, submitting]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const library = await createKnowledgeLibrary({
        name: name.trim(),
        intro: intro.trim() || undefined,
        visibility,
        color,
      });
      await onCreated(library);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={['kb-modal-mask', maskClassName].filter(Boolean).join(' ')}
      role="presentation"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="kb-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="kb-modal-head">
          <h2 id="kb-create-title">新建知识库</h2>
          <button
            type="button"
            className="kb-modal-close"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>
        <form className="kb-modal-body" onSubmit={(e) => void submit(e)}>
          <label>
            <span>知识库名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：区域经济研究库"
              maxLength={256}
              autoFocus
              required
            />
          </label>
          <label>
            <span>简介</span>
            <input
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="一句话描述该知识库的主题与用途"
              maxLength={1024}
            />
          </label>
          <fieldset>
            <legend>可见性</legend>
            <div className="kb-visibility-row">
              <label className={visibility === 'private' ? 'active' : ''}>
                <input
                  type="radio"
                  name={radioName}
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                私有（仅自己可见）
              </label>
              <label className={visibility === 'public' ? 'active' : ''}>
                <input
                  type="radio"
                  name={radioName}
                  checked={visibility === 'public'}
                  onChange={() => setVisibility('public')}
                />
                公共（全员可见）
              </label>
            </div>
          </fieldset>
          <div className="kb-color-field">
            <span>封面颜色</span>
            <div className="kb-color-row">
              {COVER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={color === c ? 'active' : ''}
                  style={{ background: c }}
                  aria-label={`选择颜色 ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          {error ? (
            <div className="kb-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}
          <footer className="kb-modal-foot">
            <button
              type="button"
              className="kb-secondary-btn"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="kb-primary-btn" disabled={!canSubmit}>
              {submitting ? '创建中…' : '创建'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
