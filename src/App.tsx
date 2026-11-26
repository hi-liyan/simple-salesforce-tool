import { Suspense, lazy, useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installNativeShortcutGuard } from "./utils/nativeShortcutGuard";

// 按窗口 label 懒加载页面入口，避免主窗口与子窗口互相打包冗余代码。
const LazyMainPage = lazy(() => import("./pages/MainPage").then((m) => ({ default: m.MainPage })));
const LazyAuthPage = lazy(() => import("./pages/AuthPage").then((m) => ({ default: m.AuthPage })));
const LazyFieldMetaPage = lazy(() => import("./pages/FieldMetaPage").then((m) => ({ default: m.FieldMetaPage })));

type AppPage = "main" | "auth" | "field-meta";

function resolvePageByWindowLabel(): AppPage {
  try {
    const label = getCurrentWebviewWindow().label;
    if (label === "sf-auth") return "auth";
    if (label === "sf-field-meta") return "field-meta";
    return "main";
  } catch {
    if (window.location.pathname === "/auth") return "auth";
    if (window.location.pathname === "/field-meta") return "field-meta";
    return "main";
  }
}

export default function App() {
  const page = resolvePageByWindowLabel();

  // 在应用根组件安装 WebView 原生快捷键拦截，覆盖主窗口与所有独立子窗口。
  useEffect(() => {
    return installNativeShortcutGuard();
  }, []);

  return (
    <div data-theme="salesforce" className="h-full w-full">
      <ErrorBoundary>
        <Suspense fallback={<div className="h-full w-full bg-[#F2F4F7]" />}>
          {page === "auth" ? <LazyAuthPage /> : page === "field-meta" ? <LazyFieldMetaPage /> : <LazyMainPage />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
