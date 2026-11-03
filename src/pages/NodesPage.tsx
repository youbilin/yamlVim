import { useEffect } from 'react';
import { Link } from 'react-router-dom';

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
      <header className="page-head">
        <div>
          <p className="eyebrow">NODES</p>
          <h1>节点</h1>
          <p className="lead">
            导入的 YAML 会解析成当前 workspace 的节点池。导出只使用这里的节点，不再保留隐藏的原始配置。
          </p>
        </div>
        <span className="chip chip-muted">{view ? `${view.nodeCount} nodes` : 'no workspace'}</span>
      </header>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">节点池</h2>
            <p className="card-sub">来自导入 YAML 的 proxies；节点编辑和分享链接导入是下一步。</p>
          </div>
          <Link className="btn btn-ghost" to="/config">
            导入配置
          </Link>
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
            <p>在配置页导入 mihomo YAML 后，节点会自动出现在这里。</p>
          </div>
        )}
      </div>
    </section>
  );
}
