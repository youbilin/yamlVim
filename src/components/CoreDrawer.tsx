import { useEffect } from 'react';
import { X } from 'lucide-react';

import { CorePage } from '../pages/CorePage';
import { ControllerPanel } from './ControllerPanel';

interface CoreDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function CoreDrawer({ open, onClose }: CoreDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="core-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="core-drawer" role="dialog" aria-modal="true" aria-label="内核与控制器">
        <div className="core-drawer-head">
          <strong>内核与控制器</strong>
          <button className="btn btn-icon" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="core-drawer-body">
          <CorePage />
          <ControllerPanel />
        </div>
      </aside>
    </div>
  );
}
