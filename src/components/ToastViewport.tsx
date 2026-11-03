import { X } from 'lucide-react';

import { useToast } from '../store/toast';

export function ToastViewport() {
  const toasts = useToast((state) => state.toasts);
  const dismiss = useToast((state) => state.dismiss);

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          className={`toast toast-${toast.kind} ${toast.leaving ? 'leaving' : ''}`}
          key={toast.id}
          role="status"
        >
          <span>{toast.message}</span>
          <button
            className="toast-close"
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="关闭提示"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
