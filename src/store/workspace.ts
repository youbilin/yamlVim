import { create } from 'zustand';

import { getWorkspaceView } from '../api';
import type { WorkspaceView } from '../types';

interface WorkspaceStore {
  view: WorkspaceView | null;
  loading: boolean;
  error: string | null;
  version: number;
  load: () => Promise<void>;
}

export const useWorkspaceData = create<WorkspaceStore>((set) => ({
  view: null,
  loading: false,
  error: null,
  version: 0,
  async load() {
    set({ loading: true, error: null });
    try {
      const view = await getWorkspaceView();
      set((state) => ({
        view,
        loading: false,
        error: null,
        version: state.version + 1,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
