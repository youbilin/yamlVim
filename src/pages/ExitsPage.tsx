import { useEffect } from 'react';

import { asArray, asRecord, asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

export function ExitsPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const exits = view?.exits ?? [];

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">出口</h2>
            <span className="chip chip-muted">{view ? `${view.exitCount}` : '—'}</span>
          </div>
        </div>

        {error ? <p className="notice notice-info">{error}</p> : null}

        {exits.length ? (
          <div className="data-list">
            {exits.map((exit, index) => {
              const entry = asRecord(exit);
              const name = asText(entry.name) || `exit-${index + 1}`;
              const type = asText(entry.type) || 'unknown';
              const members = asArray(entry.proxies);
              return (
                <div className="data-row" key={`${name}-${index}`}>
                  <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="data-main">
                    <strong>{name}</strong>
                    <span>
                      {type} · {members.length} members
                    </span>
                  </div>
                  <span className="chip chip-muted">{type}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <strong>还没有出口</strong>
          </div>
        )}
      </div>
    </section>
  );
}
