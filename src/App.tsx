import { useEffect } from 'react';
import {
  Activity,
  Cpu,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  Server,
  Settings,
} from 'lucide-react';
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';

import { isTauriRuntime } from './api';
import { ConfigPage } from './pages/ConfigPage';
import { CorePage } from './pages/CorePage';
import { DnsPage } from './pages/DnsPage';
import { ExitsPage } from './pages/ExitsPage';
import { NodesPage } from './pages/NodesPage';
import { RulesPage } from './pages/RulesPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import type { CoreProbe } from './types';
import { SettingsPage } from './pages/SettingsPage';
import { useApp } from './store/app';

const navItems = [
  { to: '/core', label: '内核', icon: Cpu },
  { to: '/dns', label: 'DNS 覆写', icon: Globe },
  { to: '/config', label: '配置', icon: FolderOpen },
  { to: '/live', label: '实时连接', icon: Activity },
  { to: '/nodes', label: '节点', icon: Server },
  { to: '/exits', label: '出口', icon: Layers },
  { to: '/chains', label: '链路', icon: GitBranch },
  { to: '/rules', label: '规则', icon: ListChecks },
  { to: '/export', label: '导出', icon: FileText },
];

const routeTitles: Record<string, string> = {
  '/core': '内核',
  '/dns': 'DNS 覆写',
  '/config': '配置',
  '/live': '实时连接',
  '/nodes': '节点',
  '/exits': '出口',
  '/chains': '链路',
  '/rules': '规则',
  '/export': '导出',
  '/settings': '设置',
};

function currentTitle(pathname: string): string {
  return routeTitles[pathname] ?? 'YamlVim';
}

function coreChip(probe: CoreProbe | null) {
  if (!probe) return { className: 'chip chip-muted', label: '未探测' };
  if (probe.kind === 'managed') return { className: 'chip chip-managed', label: 'Managed' };
  if (probe.kind === 'attach-only') return { className: 'chip chip-attach', label: 'Attach-only' };
  return { className: 'chip chip-unusable', label: 'Unusable' };
}

function Shell() {
  const location = useLocation();
  const load = useApp((state) => state.load);
  const probe = useApp((state) => state.probe);
  const chip = coreChip(probe);
  const browser = !isTauriRuntime();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Y</div>
          <div className="brand-text">
            <strong>YamlVim</strong>
            <span>mihomo workbench</span>
          </div>
        </div>

        <nav className="nav">
          <span className="nav-label">WORKSPACE</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <NavLink
            to="/settings"
            className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
          >
            <Settings size={17} />
            <span>设置</span>
          </NavLink>
          <span className="version">v0.1.0 · M2</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">YAMLVIM</span>
            <strong>{currentTitle(location.pathname)}</strong>
          </div>
          <div className="topbar-meta">
            {browser ? <span className="badge">浏览器预览</span> : null}
            <span className={chip.className}>{chip.label}</span>
          </div>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/core" replace />} />
            <Route path="/core" element={<CorePage />} />
            <Route path="/dns" element={<DnsPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route
              path="/live"
              element={
                <PlaceholderPage
                  title="实时连接"
                  description="只读 attach 控制器，查看实时路径。延迟测试仅对控制器已知节点可用。"
                  milestone="M2"
                />
              }
            />
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/exits" element={<ExitsPage />} />
            <Route
              path="/chains"
              element={
                <PlaceholderPage
                  title="链路"
                  description="用 dialer-proxy 生成独立链式节点。"
                  milestone="M2"
                />
              }
            />
            <Route path="/rules" element={<RulesPage />} />
            <Route
              path="/export"
              element={
                <PlaceholderPage
                  title="导出"
                  description="配置页已支持从当前 workspace 导出新的 YAML；独立导出页后续接入。"
                  milestone="M4"
                />
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/core" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
