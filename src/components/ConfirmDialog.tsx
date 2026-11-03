import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="dialog-body">
        <p className="lead">{message}</p>
      </div>
      <div className="dialog-foot">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void onConfirm()}
        >
          {confirmLabel}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Dialog>
  );
}
