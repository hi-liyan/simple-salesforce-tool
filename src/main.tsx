import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/index.css";
// 内置中文字体：避免 Ubuntu 未安装中文字体时出现方框字。
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-500.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "@fontsource/noto-sans-sc/chinese-simplified-700.css";

// React Query 客户端：统一管理缓存与请求状态。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  }
});

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
