import type { ReactNode } from "react";
import { OrderableTabItem } from "./tabOrder";

// 通用标签状态点类型：用于展示连接或运行状态。
export type ReusableTabStatusTone = "success" | "warning" | "error" | "idle";

// 通用标签栏单项模型：面向 UI 层的最小展示结构。
export type ReusableTabItem = OrderableTabItem & {
  // 标签标题。
  title: string;
  // 是否允许关闭。
  closable?: boolean;
  // 是否允许重命名。
  renameable?: boolean;
  // 标题提示文本。
  titleTooltip?: string;
  // 可选状态点。
  statusTone?: ReusableTabStatusTone;
};

// 通用标签栏组件入参。
export type ReusableTabsProps = {
  // 当前全部标签。
  tabs: ReusableTabItem[];
  // 当前激活标签 ID。
  activeTabId: string;
  // 空态提示文案。
  emptyText?: string;
  // 新建按钮提示文案。
  createButtonTitle?: string;
  // 激活标签。
  onActivateTab: (tabId: string) => void;
  // 新建标签。
  onCreateTab?: () => void;
  // 拖拽排序。
  onReorderTabs?: (activeTabId: string, overTabId: string) => void;
  // 重命名标签。
  onRenameTab?: (tabId: string, title: string) => void;
  // 关闭单个标签。
  onCloseTab?: (tabId: string) => void;
  // 批量关闭标签。
  onCloseTabs?: (tabIds: string[]) => void;
  // 渲染标签追加内容。
  renderTabSuffix?: (tab: ReusableTabItem) => ReactNode;
};
