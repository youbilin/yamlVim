import { create } from 'zustand';

import {
  loadSettings,
  probeCore as probeCoreApi,
  saveSettings,
} from '../api';
import type { AppSettings, CoreProbe } from '../types';

interface AppStore {
  settings: AppSettings;
  probe: CoreProbe | null;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  setCorePath: (corePath: string) => void;
  setControllerEndpoint: (endpoint: string) => void;
  setControllerSecret: (secret: string) => void;
  save: () => Promise<void>;
  runProbe: () => Promise<void>;
}

export const useApp = create<AppStore>((set, get) => ({
  settings: { corePath: 'mihomo', controllerEndpoint: '', controllerSecret: '' },
  probe: null,
  loaded: false,
  error: null,
  async load() {
    try {
      const settings = await loadSettings();
      set({ settings, loaded: true, error: null });
    } catch (error) {
      set({
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  setCorePath(corePath) {
    set((state) => ({ settings: { ...state.settings, corePath }, probe: null }));
  },
  setControllerEndpoint(endpoint) {
    set((state) => ({ settings: { ...state.settings, controllerEndpoint: endpoint } }));
  },
  setControllerSecret(secret) {
    set((state) => ({ settings: { ...state.settings, controllerSecret: secret } }));
  },
  async save() {
    await saveSettings(get().settings);
  },
  async runProbe() {
    const path = get().settings.corePath.trim();
    if (!path) throw new Error('请输入 mihomo 可执行文件路径');
    const probe = await probeCoreApi(path);
    set({ probe });
    await saveSettings(get().settings);
  },
}));
