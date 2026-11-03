import { create } from 'zustand';

interface ImportDialogStore {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useImportDialog = create<ImportDialogStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
