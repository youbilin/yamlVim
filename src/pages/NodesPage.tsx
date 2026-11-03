import { useEffect } from 'react';

import { asRecord, asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

export function NodesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);

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
        </div>

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
          </div>
        )}
      </div>
    </section>
  );
}
