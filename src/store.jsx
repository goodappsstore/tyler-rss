import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const ToastContext = createContext(null);

let toastId = 0;

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message, kind = "info") => {
      const id = ++toastId;
      const toast = {
        id,
        message: String(message ?? "").trim() || "Done.",
        kind: ["success", "error", "info"].includes(kind) ? kind : "info",
      };
      setToasts((current) => [...current.slice(-3), toast]);
      const lifetime = toast.kind === "error" ? 6400 : 4200;
      const timer = setTimeout(() => dismiss(id), lifetime);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        <div className="toast-live" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => {
            const Icon = TOAST_ICONS[toast.kind] || Info;
            return (
              <div
                key={toast.id}
                className={`toast toast-${toast.kind}`}
                role={toast.kind === "error" ? "alert" : "status"}
              >
                <span className="toast-icon" aria-hidden="true">
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className="toast-message">{toast.message}</span>
                <button
                  type="button"
                  className="toast-close"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  title="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
