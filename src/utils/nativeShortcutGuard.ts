// 禁用 WebView 原生不必要快捷键的按键守卫。

/**
 * 判断当前按键事件是否属于需要拦截的 WebView 原生浏览器快捷键。
 * @param event 键盘事件对象
 * @returns 若需要阻止浏览器默认行为则返回 true
 */
export function shouldBlockNativeShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const hasPrimaryModifier = event.ctrlKey || event.metaKey;

  // 1. 禁用页面刷新快捷键：F5（含组合键）以及 Ctrl/Cmd + R / Ctrl/Cmd + Shift + R。
  if (key === "f5") {
    return true;
  }
  if (hasPrimaryModifier && !event.altKey && key === "r") {
    return true;
  }

  // 2. 禁用浏览器光标浏览开关 F7 与原生查找下一个 F3。
  if (key === "f7" || key === "f3") {
    return true;
  }

  // 3. 禁用浏览器 Alt + 左/右方向键触发的历史前进/后退导航。
  if (event.altKey && !hasPrimaryModifier && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    return true;
  }

  // 4. 禁用其他不必要的浏览器原生快捷键（打印、保存网页、打开文件、查看源码、新建/关闭窗口与标签、历史、下载、书签、查找下一个）。
  if (hasPrimaryModifier && !event.altKey) {
    const blockedPrimaryKeys = new Set(["p", "s", "o", "u", "w", "t", "n", "h", "j", "d", "g"]);
    if (blockedPrimaryKeys.has(key)) {
      return true;
    }

    // 5. 生产环境下禁用浏览器 DevTools 快捷键（开发环境保留以便调试）。
    if (!import.meta.env.DEV && event.shiftKey && (key === "i" || key === "j" || key === "c")) {
      return true;
    }
  }

  // 6. 生产环境下禁用 F12 开发者工具快捷键。
  if (!import.meta.env.DEV && key === "f12") {
    return true;
  }

  return false;
}

/**
 * 注册全局原生快捷键拦截器（使用冒泡阶段监听，确保编辑器、终端与组件自定义快捷键优先响应）。
 * @returns 用于注销事件监听的清理函数
 */
export function installNativeShortcutGuard(): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    // 若已被内部组件（如终端、代码编辑器或业务弹窗）处理并阻止默认行为，则不再重复干预。
    if (event.defaultPrevented) return;

    if (shouldBlockNativeShortcut(event)) {
      // 仅阻止浏览器原生默认行为，不阻断事件继续传播，避免影响组件自身按键逻辑。
      event.preventDefault();
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}
