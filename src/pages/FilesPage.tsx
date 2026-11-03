import { useEffect, useState } from 'react';
import { Eye, RefreshCw, Trash2 } from 'lucide-react';

import {
  deleteExport,
  errorMessage,
  isTauriRuntime,
  listExports,
  loadExportAsWorkspace,
  readExport,
} from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';
import { toast } from '../store/toast';
import { useWorkspaceData } from '../store/workspace';
import type { ExportFile } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPage() {
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [preview, setPreview] = useState<{ name: string; yaml: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const browser = !isTauriRuntime();

  const refresh = async () => {
    try {
      setFiles(await listExports());
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleView = async (path: string) => {
    setBusy(true);
    try {
      const yaml = await readExport(path);
      setPreview({ name: path.split('\\').pop() ?? path, yaml });
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteExport(deleting);
      setDeleting(null);
      toast.success('导出文件已删除');
      await refresh();
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  };

  const handleReEdit = async (path: string) => {
    setBusy(true);
    try {
      await loadExportAsWorkspace(path);
      void useWorkspaceData.getState().load();
      toast.success('已加载为当前 workspace');
      await refresh();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <span className="chip chip-muted">{files.length} files</span>
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void refresh()}
            disabled={busy || browser}
          >
            <RefreshCw size={15} />
            刷新
          </button>
        </div>

        {files.length ? (
          <div className="data-list">
            {files.map((file, index) => (
              <div className="data-row" key={file.path}>
                <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="data-main">
                  <strong>{file.name}</strong>
                  <span>{formatSize(file.sizeBytes)}</span>
                </div>
                <div className="inline-actions">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void handleView(file.path)}
                    disabled={busy}
                  >
                    <Eye size={15} />
                    查看
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => void handleReEdit(file.path)}
                    disabled={busy || browser}
                  >
                    重新编辑
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setDeleting(file.path)}
                    disabled={busy || browser}
                    aria-label="删除导出文件"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>暂无导出文件</strong>
          </div>
        )}

        {deleting ? (
          <ConfirmDialog
            title="删除导出文件"
            message="确定删除这个导出 YAML？此操作不可撤销。"
            confirmLabel="删除"
            onConfirm={confirmDelete}
            onClose={() => setDeleting(null)}
          />
        ) : null}

        {preview ? (
          <Dialog title={preview.name} onClose={() => setPreview(null)}>
            <div className="dialog-body">
              <pre className="code-block file-preview-code">{preview.yaml}</pre>
            </div>
            <div className="dialog-foot">
              <button className="btn btn-ghost" type="button" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
          </Dialog>
        ) : null}
      </div>
    </section>
  );
}
