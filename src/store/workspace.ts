import { create } from 'zustand';

import { getWorkspaceView } from '../api';
import type { WorkspaceView } from '../types';

interface WorkspaceStore {
  view: WorkspaceView | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useWorkspaceData = create<WorkspaceStore>((set) => ({
  view: null,
  loading: false,
  error: null,
  async load() {
    set({ loading: true, error: null });
    try {
      set({ view: await getWorkspaceView(), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
