import { create } from 'zustand';

import {
  controllerCloseConnection,
  controllerDelay,
  controllerGet,
  errorMessage,
  switchProxy,
} from '../api';
import { useApp } from './app';

export interface LiveConnection {
  id: string;
  metadata: { host?: string; destinationPort?: string; network?: string };
  upload: number;
  download: number;
  chains: string[];
  rule?: string;
  rulePayload?: string;
  start: string;
}

interface RawProxy {
  type?: string;
  now?: string;
  all?: string[];
}

export interface ProxyGroup {
  name: string;
  now: string;
  all: string[];
}

interface LiveStore {
  connections: LiveConnection[];
  groups: ProxyGroup[];
  attached: boolean;
  error: string | null;
  delays: Record<string, number | null>;
  poll: () => Promise<void>;
  switchGroup: (group: string, name: string) => Promise<void>;
  closeConnection: (id: string) => Promise<void>;
  testDelay: (group: string) => Promise<void>;
}

export const useLive = create<LiveStore>((set, get) => ({
  connections: [],
  groups: [],
  attached: false,
  error: null,
  delays: {},
  async poll() {
    const endpoint = useApp.getState().settings.controllerEndpoint.trim();
    if (!endpoint) {
      set({ attached: false, connections: [], groups: [], error: null });
      return;
    }
    try {
      const [connectionsRaw, proxiesRaw] = await Promise.all([
        controllerGet('/connections'),
        controllerGet('/proxies'),
      ]);
      const connectionsData = JSON.parse(connectionsRaw) as { connections?: LiveConnection[] };
      const proxiesData = JSON.parse(proxiesRaw) as { proxies?: Record<string, RawProxy> };
      const groups = Object.entries(proxiesData.proxies ?? {})
        .filter(([, proxy]) => proxy.type === 'Selector' && Array.isArray(proxy.all))
        .map(([name, proxy]) => ({
          name,
          now: proxy.now ?? '',
          all: proxy.all ?? [],
        }));
      set({
        connections: connectionsData.connections ?? [],
        groups,
        attached: true,
        error: null,
      });
    } catch (reason) {
      set({ attached: false, error: errorMessage(reason) });
    }
  },
  async switchGroup(group, name) {
    await switchProxy(group, name);
    await get().poll();
  },
  async closeConnection(id) {
    await controllerCloseConnection(id);
    await get().poll();
  },
  async testDelay(group) {
    try {
      const result = await controllerDelay(group);
      set((state) => ({ delays: { ...state.delays, [group]: result.delayMs ?? null } }));
    } catch {
      set((state) => ({ delays: { ...state.delays, [group]: null } }));
    }
  },
}));
