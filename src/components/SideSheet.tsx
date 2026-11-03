import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface SideSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SideSheet({ title, onClose, children }: SideSheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="side-sheet-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="side-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="side-sheet-head">
          <strong>{title}</strong>
          <button className="btn btn-icon" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="side-sheet-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
