import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { hasTauriRuntime } from "./app/api/tauri";
import "./styles/index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

if (hasTauriRuntime()) {
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        const mount = document.getElementById("root");
        if (mount && mount.childElementCount === 0) {
          window.location.reload();
        }
      }),
    )
    .catch(() => {});
}
