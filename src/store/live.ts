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
  metadata: {
    host?: string;
    destinationIP?: string;
    destinationPort?: string;
    sourceIP?: string;
    sourcePort?: string;
    network?: string;
    process?: string;
    processPath?: string;
  };
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

export interface LiveRate {
  up: number;
  down: number;
}

interface LedgerEntry {
  upload: number;
  download: number;
}

interface LiveStore {
  connections: LiveConnection[];
  groups: ProxyGroup[];
  attached: boolean;
  error: string | null;
  rates: Record<string, LiveRate>;
  upRate: number;
  downRate: number;
  delays: Record<string, number | null>;
  poll: () => Promise<void>;
  switchGroup: (group: string, name: string) => Promise<void>;
  closeConnection: (id: string) => Promise<void>;
  testDelay: (group: string) => Promise<void>;
}

let ledger = new Map<string, LedgerEntry>();
let lastPollAt = 0;

function computeRates(connections: LiveConnection[]): {
  rates: Record<string, LiveRate>;
  up: number;
  down: number;
} {
  const now = Date.now();
  const elapsed = lastPollAt ? Math.min(5, Math.max(0.2, (now - lastPollAt) / 1000)) : 0;
  const nextLedger = new Map<string, LedgerEntry>();
  const rates: Record<string, LiveRate> = {};
  let up = 0;
  let down = 0;
  for (const connection of connections) {
    nextLedger.set(connection.id, { upload: connection.upload, download: connection.download });
    if (!elapsed) {
      rates[connection.id] = { up: 0, down: 0 };
      continue;
    }
    const previous = ledger.get(connection.id);
    const upDelta = previous ? Math.max(0, connection.upload - previous.upload) : 0;
    const downDelta = previous ? Math.max(0, connection.download - previous.download) : 0;
    const upRate = Math.round(upDelta / elapsed);
    const downRate = Math.round(downDelta / elapsed);
    rates[connection.id] = { up: upRate, down: downRate };
    up += upRate;
    down += downRate;
  }
  ledger = nextLedger;
  lastPollAt = now;
  return { rates, up, down };
}

export const useLive = create<LiveStore>((set, get) => ({
  connections: [],
  groups: [],
  attached: false,
  error: null,
  rates: {},
  upRate: 0,
  downRate: 0,
  delays: {},
  async poll() {
    const endpoint = useApp.getState().settings.controllerEndpoint.trim();
    if (!endpoint) {
      set({ attached: false, connections: [], groups: [], error: null, rates: {}, upRate: 0, downRate: 0 });
      return;
    }
    try {
      const [connectionsRaw, proxiesRaw] = await Promise.all([
        controllerGet('/connections'),
        controllerGet('/proxies'),
      ]);
      const connectionsData = JSON.parse(connectionsRaw) as { connections?: LiveConnection[] };
      const proxiesData = JSON.parse(proxiesRaw) as { proxies?: Record<string, RawProxy> };
      const connections = connectionsData.connections ?? [];
      const groups = Object.entries(proxiesData.proxies ?? {})
        .filter(([, proxy]) => proxy.type === 'Selector' && Array.isArray(proxy.all))
        .map(([name, proxy]) => ({
          name,
          now: proxy.now ?? '',
          all: proxy.all ?? [],
        }));
      const { rates, up, down } = computeRates(connections);
      set({
        connections,
        groups,
        attached: true,
        error: null,
        rates,
        upRate: up,
        downRate: down,
      });
    } catch (reason) {
      set({ attached: false, error: errorMessage(reason), rates: {}, upRate: 0, downRate: 0 });
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
