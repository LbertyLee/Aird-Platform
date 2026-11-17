import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认删除',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={() => !busy && onCancel()}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="confirm-dialog-close" type="button" aria-label="关闭" disabled={busy} onClick={onCancel}>
          <X size={17} />
        </button>
        <div className="confirm-dialog-icon"><AlertTriangle size={20} /></div>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} type="button" className="confirm-dialog-cancel" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="confirm-dialog-danger" disabled={busy} onClick={onConfirm}>{busy ? '正在删除…' : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
