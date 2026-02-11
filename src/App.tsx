import { AuthPage } from "./pages/AuthPage";
import { MainPage } from "./pages/MainPage";

// 应用路由：根据路径渲染主页面或授权页面。
export default function App() {
  return (
    // 根节点：根据路径切换页面。
    <>
      {/* 授权页面或主页面。 */}
      {window.location.pathname === "/auth" ? <AuthPage /> : <MainPage />}
    </>
  );
}
