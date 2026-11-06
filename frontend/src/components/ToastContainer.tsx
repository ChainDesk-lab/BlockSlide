"use client";

import { useToast } from "../contexts/ToastContext";
import Notice from "./Notice";

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Notice
          key={toast.id}
          tone={toast.type}
          className={`toast toast--${toast.type}`}
          role="alert"
          floating
          onDismiss={() => removeToast(toast.id)}
          dismissLabel="Close"
        >
          <p className="toast__message">{toast.message}</p>
        </Notice>
      ))}
    </div>
  );
}
