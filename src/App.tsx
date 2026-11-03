import { useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  FileText,
  FileUp,
  FolderOpen,
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
import { CoreDrawer } from './components/CoreDrawer';
import { ImportDialog } from './components/ImportDialog';
import { ToastViewport } from './components/ToastViewport';
import { DnsPage } from './pages/DnsPage';
import { ExitsPage } from './pages/ExitsPage';
import { ChainsPage } from './pages/ChainsPage';
import { ExportPage } from './pages/ExportPage';
import { FilesPage } from './pages/FilesPage';
import { LivePage } from './pages/LivePage';
import { NodesPage } from './pages/NodesPage';
import { RulesPage } from './pages/RulesPage';
import { useImportDialog } from './store/dialogs';
import { useApp } from './store/app';

const navItems = [
  { to: '/live', label: '实时连接', icon: Activity },
  { to: '/nodes', label: '节点', icon: Server },
  { to: '/exits', label: '出口', icon: Layers },
  { to: '/chains', label: '链路', icon: GitBranch },
  { to: '/rules', label: '规则', icon: ListChecks },
  { to: '/dns', label: 'DNS 覆写', icon: Globe },
  { to: '/export', label: '导出', icon: FileText },
  { to: '/files', label: '文件', icon: FolderOpen },
];

const routeTitles: Record<string, string> = {
  '/live': '实时连接',
  '/nodes': '节点',
  '/exits': '出口',
  '/chains': '链路',
  '/rules': '规则',
  '/dns': 'DNS 覆写',
  '/export': '导出',
  '/files': '文件',
};

function currentTitle(pathname: string): string {
  return routeTitles[pathname] ?? 'YamlVim';
}

function Shell() {
  const location = useLocation();
  const load = useApp((state) => state.load);
  const probe = useApp((state) => state.probe);
  const showImport = useImportDialog((state) => state.show);
  const [collapsed, setCollapsed] = useState(() => {
    return window.localStorage.getItem('yamlvim.sidebar') === 'collapsed';
  });
  const [coreOpen, setCoreOpen] = useState(false);
  const browser = !isTauriRuntime();
  const dotClass = probe
    ? probe.kind === 'managed'
      ? 'managed'
      : probe.kind === 'attach-only'
        ? 'attach'
        : 'bad'
    : 'idle';

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
    <div className={collapsed ? 'app app-collapsed' : 'app'}>
      <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
        <div className="sidebar-head">
          <a
            className="github-link"
            href="https://github.com/youbilin/yamlVim"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            title="GitHub"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
          </a>
          <button
            className="btn btn-icon sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="nav">
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
            <button
              className="btn btn-icon core-button"
              type="button"
              onClick={() => setCoreOpen(true)}
              aria-label="内核与连接"
              title="内核与连接"
            >
              <Cpu size={18} />
              <span className={`core-dot ${dotClass}`} />
            </button>
          </div>
        </header>

        <div className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/live" replace />} />
            <Route path="/core" element={<Navigate to="/live" replace />} />
            <Route path="/settings" element={<Navigate to="/live" replace />} />
            <Route path="/config" element={<Navigate to="/export" replace />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/dns" element={<DnsPage />} />
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/exits" element={<ExitsPage />} />
            <Route path="/chains" element={<ChainsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="*" element={<Navigate to="/live" replace />} />
          </Routes>
        </div>
      </main>
      <ImportDialog />
      <CoreDrawer open={coreOpen} onClose={() => setCoreOpen(false)} />
      <ToastViewport />
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
