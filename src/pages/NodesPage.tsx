import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { AddNodeDialog } from '../components/AddNodeDialog';
import { asRecord, asText } from '../lib/workspace';
import { useImportDialog } from '../store/dialogs';
import { useWorkspaceData } from '../store/workspace';

export function NodesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);
  const showImport = useImportDialog((state) => state.show);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const nodes = view?.nodes ?? [];

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">节点</h2>
            <span className="chip chip-muted">{view ? `${view.nodeCount}` : '—'}</span>
          </div>
          <div className="inline-actions">
            <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
              新增节点
            </button>
            <button className="btn btn-ghost" type="button" onClick={showImport}>
              导入
            </button>
          </div>
        </div>

        {notice ? <p className="notice notice-ok">{notice}</p> : null}
        {error ? <p className="notice notice-info">{error}</p> : null}

        {nodes.length ? (
          <div className="data-list">
            {nodes.map((node, index) => {
              const entry = asRecord(node);
              const name = asText(entry.name) || `node-${index + 1}`;
              const type = asText(entry.type) || 'unknown';
              const server = asText(entry.server);
              const port = asText(entry.port);
              return (
                <div className="data-row" key={`${name}-${index}`}>
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{name}</strong>
                    <span>
                      {type}
                      {server ? ` · ${server}${port ? `:${port}` : ''}` : ''}
                    </span>
                  </div>
                  <span className="chip chip-muted">{type}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <strong>还没有节点</strong>
            <div className="inline-actions">
              <button className="btn btn-primary" type="button" onClick={() => setAddOpen(true)}>
                新增节点
              </button>
            </div>
          </div>
        )}
      </div>

      <AddNodeDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(message) => setNotice(message)}
      />
    </section>
  );
}
