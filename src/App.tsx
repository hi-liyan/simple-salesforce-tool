import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthPage } from "./pages/AuthPage";
import { FieldMetaPage } from "./pages/FieldMetaPage";
import { MainPage } from "./pages/MainPage";

type AppPage = "main" | "auth" | "field-meta";

function resolvePageByWindowLabel(): AppPage {
  try {
    const label = getCurrentWebviewWindow().label;
    if (label === "sf-auth") return "auth";
    if (label === "sf-field-meta") return "field-meta";
    return "main";
  } catch {
    // Fallback for non-Tauri environments.
    if (window.location.pathname === "/auth") return "auth";
    if (window.location.pathname === "/field-meta") return "field-meta";
    return "main";
  }
}

export default function App() {
  const page = resolvePageByWindowLabel();

  return (
    <div data-theme="salesforce" className="h-full w-full">
      <ErrorBoundary>
        {page === "auth" ? <AuthPage /> : page === "field-meta" ? <FieldMetaPage /> : <MainPage />}
      </ErrorBoundary>
    </div>
  );
}
