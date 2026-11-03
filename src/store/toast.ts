import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  message: string;
  kind: ToastKind;
  leaving?: boolean;
}

interface ToastStore {
  toasts: ToastMessage[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
  leave: (id: number) => void;
}

let nextId = 1;

export const useToast = create<ToastStore>((set) => ({
  toasts: [],
  push(message, kind = 'info') {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, message, kind }] }));
    window.setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.map((toast) =>
          toast.id === id ? { ...toast, leaving: true } : toast,
        ),
      }));
    }, 3200);
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    }, 3700);
  },
  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  leave(id) {
    set((state) => ({
      toasts: state.toasts.map((toast) =>
        toast.id === id ? { ...toast, leaving: true } : toast,
      ),
    }));
  },
}));

export const toast = {
  success(message: string) {
    useToast.getState().push(message, 'success');
  },
  error(message: string) {
    useToast.getState().push(message, 'error');
  },
  info(message: string) {
    useToast.getState().push(message, 'info');
  },
};
