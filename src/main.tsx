import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/index.css";
// 内置中文字体基础字重：保留 400 作为首屏兜底，避免无中文字体环境出现方框字。
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";

// React Query 客户端：统一管理缓存与请求状态。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
});

// 延后加载非首屏必需字重：将 500/600/700 从首包中拆出，降低入口资源压力。
function loadDeferredChineseFonts() {
  // 实际加载逻辑：通过动态 import 让 Vite 为额外字重生成独立资源。
  const loadFonts = () => {
    void import("@fontsource/noto-sans-sc/chinese-simplified-500.css");
    void import("@fontsource/noto-sans-sc/chinese-simplified-600.css");
    void import("@fontsource/noto-sans-sc/chinese-simplified-700.css");
  };

  // 优先在浏览器空闲时加载，避免与首屏渲染争抢主线程。
  const hostWindow = typeof window !== "undefined" ? window : null;
  if (hostWindow && "requestIdleCallback" in hostWindow) {
    (hostWindow as Window & { requestIdleCallback: (callback: () => void) => number }).requestIdleCallback(() => {
      loadFonts();
    });
    return;
  }

  // 兼容兜底：不支持空闲回调时退化到异步定时器。
  globalThis.setTimeout(() => {
    loadFonts();
  }, 0);
}

// 应用入口：挂载 React 根组件与全局 Provider。
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // 严格模式：帮助发现潜在问题。
  <React.StrictMode>
    {/* React Query Provider：提供全局数据缓存上下文。 */}
    <QueryClientProvider client={queryClient}>
      {/* 应用根组件。 */}
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

// 启动后异步补齐更高字重，减少首屏 CSS 与字体资源体积。
loadDeferredChineseFonts();
