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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const browser = !isTauriRuntime();

  const refresh = async () => {
    try {
      setFiles(await listExports());
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleView = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      const yaml = await readExport(path);
      setPreview({ name: path.split('\\').pop() ?? path, yaml });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteExport(deleting);
      setDeleting(null);
      setMessage('导出文件已删除');
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const handleReEdit = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      await loadExportAsWorkspace(path);
      void useWorkspaceData.getState().load();
      setMessage('已加载为当前 workspace');
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">导出文件</h2>
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

        {browser ? (
          <p className="notice notice-info">浏览器模式请使用桌面版查看导出文件。</p>
        ) : null}
        {error ? <p className="notice notice-warn">{error}</p> : null}
        {message ? <p className="notice notice-ok">{message}</p> : null}

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
          <div className="preview-overlay">
            <div className="preview-panel">
              <div className="preview-head">
                <h3>{preview.name}</h3>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setPreview(null)}
                >
                  关闭
                </button>
              </div>
              <pre className="code-block">{preview.yaml}</pre>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
