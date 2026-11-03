import { useEffect } from 'react';

import { asText } from '../lib/workspace';
import { useImportDialog } from '../store/dialogs';
import { useWorkspaceData } from '../store/workspace';

export function RulesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);
  const showImport = useImportDialog((state) => state.show);

  useEffect(() => {
    void load();
  }, [load]);

  const rules = view?.rules ?? [];
  const ruleSets = Object.keys(view?.ruleProviders ?? {});

  return (
    <section className="page">
      <div className="card">
        <div className="card-head">
          <div className="card-title-row">
            <h2 className="card-title">规则</h2>
            <span className="chip chip-muted">{view ? `${view.ruleCount}` : '—'}</span>
          </div>
          <button className="btn btn-ghost" type="button" onClick={showImport}>
            导入 YAML
          </button>
        </div>

        {error ? <p className="notice notice-info">{error}</p> : null}

        {rules.length ? (
          <div className="data-list">
            {rules.map((rule, index) => (
              <div className="data-row" key={`rule-${index}`}>
                <span className="data-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="data-main">
                  <code>{asText(rule) || String(rule)}</code>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            <strong>还没有规则</strong>
            <button className="btn btn-primary" type="button" onClick={showImport}>
              导入 YAML
            </button>
          </div>
        )}

        {ruleSets.length ? (
          <div className="data-section">
            <span className="eyebrow">RULE PROVIDERS</span>
            <div className="tag-row">
              {ruleSets.map((name) => (
                <span className="chip chip-muted" key={name}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
