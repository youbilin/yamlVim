import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { asText } from '../lib/workspace';
import { useWorkspaceData } from '../store/workspace';

export function RulesPage() {
  const view = useWorkspaceData((state) => state.view);
  const error = useWorkspaceData((state) => state.error);
  const load = useWorkspaceData((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const rules = view?.rules ?? [];
  const ruleSets = Object.keys(view?.ruleProviders ?? {});

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">RULES</p>
          <h1>规则</h1>
          <p className="lead">
            规则顺序和 rule-providers 属于当前 workspace。导出会重新生成规则列表，不会回填原始配置。
          </p>
        </div>
        <span className="chip chip-muted">{view ? `${view.ruleCount} rules` : 'no workspace'}</span>
      </header>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">规则列表</h2>
            <p className="card-sub">按顺序匹配；rule-providers 名称来自导入配置。</p>
          </div>
          <Link className="btn btn-ghost" to="/config">
            导入配置
          </Link>
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
            <p>导入 YAML 后，rules 会自动显示在这里。</p>
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
