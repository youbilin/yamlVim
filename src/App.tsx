import { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  FileText,
  FileUp,
  GitBranch,
  Globe,
  Layers,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
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
import { ImportDialog } from './components/ImportDialog';
import { CorePage } from './pages/CorePage';
import { DnsPage } from './pages/DnsPage';
import { ExitsPage } from './pages/ExitsPage';
import { ExportPage } from './pages/ExportPage';
import { LivePage } from './pages/LivePage';
import { NodesPage } from './pages/NodesPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RulesPage } from './pages/RulesPage';
import { useImportDialog } from './store/dialogs';
import type { CoreProbe } from './types';
import { useApp } from './store/app';

const navItems = [
  { to: '/core', label: '内核', icon: Cpu },
  { to: '/live', label: '实时连接', icon: Activity },
  { to: '/nodes', label: '节点', icon: Server },
  { to: '/exits', label: '出口', icon: Layers },
  { to: '/chains', label: '链路', icon: GitBranch },
  { to: '/rules', label: '规则', icon: ListChecks },
  { to: '/dns', label: 'DNS 覆写', icon: Globe },
  { to: '/export', label: '导出', icon: FileText },
];

const routeTitles: Record<string, string> = {
  '/core': '内核',
  '/live': '实时连接',
  '/nodes': '节点',
  '/exits': '出口',
  '/chains': '链路',
  '/rules': '规则',
  '/dns': 'DNS 覆写',
  '/export': '导出',
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
  const showImport = useImportDialog((state) => state.show);
  const [collapsed, setCollapsed] = useState(() => {
    return window.localStorage.getItem('yamlvim.sidebar') === 'collapsed';
  });
  const chip = coreChip(probe);
  const browser = !isTauriRuntime();

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('yamlvim.sidebar', next ? 'collapsed' : 'expanded');
      return next;
    });
  };

  return (
    <div className="app">
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-head">
          <button
            className="btn btn-icon sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="nav">
          <span className="nav-label">WORKSPACE</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <strong className="topbar-title">{currentTitle(location.pathname)}</strong>
          <div className="topbar-meta">
            <button className="btn btn-ghost" type="button" onClick={showImport}>
              <FileUp size={15} />
              导入
            </button>
            {browser ? <span className="badge">浏览器预览</span> : null}
            <span className={chip.className}>{chip.label}</span>
          </div>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/core" replace />} />
            <Route path="/core" element={<CorePage />} />
            <Route path="/dns" element={<DnsPage />} />
            <Route path="/config" element={<Navigate to="/export" replace />} />
            <Route path="/settings" element={<Navigate to="/core" replace />} />
            <Route path="/live" element={<LivePage />} />
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
            <Route path="/export" element={<ExportPage />} />
            <Route path="*" element={<Navigate to="/core" replace />} />
          </Routes>
        </div>
      </main>
      <ImportDialog />
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
