# 可复用多标签栏设计

**日期**: 2026-03-24

**目标**: 将 `QueryPanel`、`TerminalPanel`、`JsonFormatterTool` 中重复实现的多标签栏能力抽离为可复用方案，在不打散各自业务状态的前提下，统一支持多 Tab、拖拽排序、右键菜单、双击重命名与状态持久化。

## 背景

当前三处面板都已经支持多 Tab，但实现方式彼此独立：

- `QueryPanel` 已实现横向拖拽排序与右键菜单，并承担 data/console 混合工作区能力。
- `JsonFormatterTool` 已实现基础多 Tab 与双击重命名，并使用 Zustand persist 做懒恢复。
- `TerminalPanel` 具备多 Tab 运行时，但 Tab 栏仍是独立实现，且缺少重命名、右键菜单与持久化。

这导致以下问题：

- Tab 栏交互重复实现，后续功能演进容易继续分叉。
- 同类能力在不同面板上的行为不完全一致，用户心智不统一。
- 状态持久化边界分散，排序与标题修改无法形成统一约束。

## 范围

本次设计只抽离“通用标签栏层”，不统一三处业务数据模型。

纳入范围：

- 通用标签栏组件
- 通用标签栏交互状态 hook
- 每个 panel 的 adapter 接入层
- 每个 panel 的 Tab 顺序与激活态持久化策略

不纳入范围：

- 合并三处业务 store 为同一个通用 store
- 改造 QueryPanel 的 data/console 业务语义
- 改造 Terminal 后端会话管理
- 改造 JsonFormatterTool 的内容编辑区与常驻挂载策略

## 方案选择

最终采用“方案 2”：

- 抽出通用 `Tabs` 组件
- 抽出通用 tab 行为 hook/store 工具
- 各 panel 继续维护自己的业务数据与业务动作

不选择“只抽 UI 组件”的原因：

- 右键菜单、重命名、批量关闭、拖拽排序这些并不只是样式复用，而是完整交互状态机。
- 如果只抽外观，逻辑仍然会散落在三个 panel 中，重复问题无法真正解决。

不选择“统一三处 tab store”的原因：

- `QueryPanel`、`TerminalPanel`、`JsonFormatterTool` 的业务字段差异很大。
- 强行统一底层数据模型会增加抽象噪音，反而提升维护成本与接入风险。

## 总体设计

### 一、组件分层

新增一套通用标签栏模块，分为三层：

1. `ReusableTabs`
   负责纯展示与交互事件分发。

2. `useTabBarState`
   负责标签栏局部交互状态，如右键菜单、重命名草稿、拖拽中的活动项。

3. panel adapter
   负责把 panel 自己的业务 tab 状态映射成通用 tab 模型，并把动作回调接回各自 store。

这样可以保持：

- 通用组件只理解“标签栏”
- 业务 panel 只关心“这个 Tab 对应什么业务实体”
- 持久化仍然由业务 store 控制，不在通用组件里写死

### 二、通用 tab 数据模型

定义一个面向 UI 的最小模型，例如：

```ts
type ReusableTabItem = {
  id: string;
  title: string;
  closable?: boolean;
  renameable?: boolean;
  titleTooltip?: string;
  statusTone?: "success" | "warning" | "error" | "idle";
};
```

说明：

- `id` 是唯一标识，用于激活、排序、关闭。
- `title` 是展示标题。
- `closable` 控制是否显示关闭按钮。
- `renameable` 控制是否允许双击重命名。
- `titleTooltip` 用于 `TerminalPanel` 这类需要展示 PID/命令行摘要的场景。
- `statusTone` 用于可选状态点展示，满足终端连接态之类需求。

通用组件不感知 data tab、console tab、terminal tab、json tab 的业务差别。

### 三、通用组件职责

`ReusableTabs` 负责：

- 渲染标签列表
- 渲染新增按钮
- 处理横向拖拽排序
- 双击进入重命名态
- 渲染 QueryPanel 风格的右键菜单
- 执行菜单操作的回调分发
- 提供空态展示

`ReusableTabs` 不负责：

- 直接修改业务 store
- 关闭终端后端会话
- 恢复 tab 内容
- 控制每个 tab pane 的挂载/卸载

### 四、通用 hook 职责

`useTabBarState` 管理以下局部状态：

- `contextMenu`
- `renamingTabId`
- `renamingDraft`
- `activeDragTabId`

并暴露以下动作：

- `openContextMenu`
- `closeContextMenu`
- `startRename`
- `changeRenameDraft`
- `commitRename`
- `cancelRename`
- `handleDragStart`
- `handleDragEnd`
- `closeCurrentTab`
- `closeLeftTabs`
- `closeRightTabs`
- `closeOtherTabs`
- `closeAllTabs`

这些逻辑应统一收口，避免继续在每个 panel 中各写一套。

## 各面板接入设计

### QueryPanel

`QueryPanel` 仍保留“统一工作区”业务语义：

- data tab 与 console tab 的映射逻辑仍在 `useWorkspaceTabs`
- `parseWorkspaceTabId` 等逻辑不迁移到通用组件

接入方式：

- 用 `ReusableTabs` 替换现有 `QueryWorkspaceTabs`
- 保留当前 QueryPanel 的右键菜单行为作为通用默认行为来源
- 将 `workspaceTabs` 转换为 `ReusableTabItem[]`
- 将 `onActivateWorkspaceTab`、`onReorderWorkspaceTabs`、`onCloseWorkspaceTab`、`onCloseWorkspaceTabs` 接入通用组件

持久化调整：

- 目前 `workspaceTabOrder` 仅存在 `useWorkspaceTabs` 的本地 state 中
- 需要将顺序状态迁移为可持久化来源
- 推荐新增 QueryPanel 专用轻量 store 或在现有 QueryPanel 相关状态中增加 `workspaceTabOrderBySourceId`

推荐按数据源分桶持久化：

- 不同数据源的查询工作区本来就隔离
- 避免一个 source 的 console/data tab 顺序污染另一个 source

### JsonFormatterTool

`JsonFormatterTool` 当前已经具备：

- 多 Tab
- 双击重命名
- 内容持久化
- 懒恢复

接入方式：

- 保留现有常驻挂载策略
- 把顶部 Tab 栏替换为 `ReusableTabs`
- 重命名逻辑迁移到通用 hook
- 关闭、激活、新建逻辑继续使用 `useJsonFormatterStore`

持久化调整：

- 当前 store 只持久化 `tabs` 与 `activeTabId`
- 需要新增 `tabOrder`
- 恢复时按照 `tabOrder` 输出 Tab 列表
- 若 `tabOrder` 缺项或有脏数据，则按“保留已有顺序 + 追加缺失 tab”规则兜底

### TerminalPanel

`TerminalPanel` 业务特点最特殊：

- UI tab 与后端终端会话一一对应
- 关闭 tab 前需要先回收后端 session
- 连接状态、PID、shell 信息是运行态衍生信息

接入方式：

- 用 `ReusableTabs` 替换当前顶部终端 Tab 栏
- 把 tooltip、状态点通过 adapter 传给通用组件
- 关闭动作仍由 `TerminalPanel` 外层托管，先调后端 API，再落 store

持久化调整：

- 当前 `useTerminalStore` 未持久化
- 改为 `persist`
- 持久化字段至少包括：`tabs`、`activeTabId`、`tabOrder`
- 不持久化字段包括：后端 session 是否连接、PID、shell 版本、xterm runtime 句柄

恢复策略：

- 恢复 UI 层 tabs 与输入/输出历史
- 进入面板后按现有流程重新建立后端终端会话
- 若恢复后端失败，不丢 tab，只把连接状态标记为未连接并允许用户继续操作

## 持久化设计

### 持久化原则

通用组件不直接持久化，持久化由各 panel 的 store 负责。

原因：

- 不同 panel 的恢复时机不同
- `JsonFormatterTool` 和 Query 相关 store 当前都是手动 rehydrate
- `TerminalPanel` 需要区分“UI 持久化状态”和“后端运行态”

### 建议持久化字段

通用约束如下：

- 需要持久化：
  - `tabs`
  - `activeTabId`
  - `tabOrder`

- 不需要持久化：
  - 右键菜单打开状态
  - 重命名草稿
  - 拖拽中的活动项
  - 临时 hover/焦点态

### 顺序恢复算法

恢复 tab 顺序时统一采用以下规则：

1. 先读取持久化 `tabOrder`
2. 过滤已不存在的 tab id
3. 将当前真实 `tabs` 中未出现在 `tabOrder` 的项追加到末尾
4. 若 `activeTabId` 不存在，则回退到排序后的第一个 tab

这样可以兼容：

- 旧版本未持久化顺序的数据
- 迁移过程中 title 或内容更新但顺序快照不完整

## 交互设计

### 基础交互

- 单击：激活 tab
- 双击：进入重命名态
- 点击关闭：关闭当前 tab
- 点击新增按钮：创建新 tab，并切换为激活态

### 拖拽排序

- 统一使用 `dnd-kit`
- 仅允许横向拖拽
- 设置最小激活距离，避免点击误触拖拽
- 使用 overlay 保持拖拽视觉稳定

### 右键菜单

右键菜单保持与 QueryPanel 一致：

- 关闭当前
- 关闭左侧
- 关闭右侧
- 关闭其他
- 全部关闭

规则：

- 右键打开菜单时，不强制切换激活态
- 菜单项可根据左右是否存在 tab 动态禁用
- 点击空白、滚动、按下 `Escape` 时关闭菜单

### 重命名

- 允许双击标题进入编辑态
- `Enter` 提交
- `Escape` 取消
- `blur` 自动提交
- 空白名称回退为原名称

限制：

- `QueryPanel` 的 data workspace tab 不允许重命名
- `QueryPanel` 的 console tab 是否允许重命名，以 console tab 底层业务规则为准
- `JsonFormatterTool` 与 `TerminalPanel` 默认允许重命名

## 组件接口草案

```ts
type ReusableTabsProps = {
  tabs: ReusableTabItem[];
  activeTabId: string;
  emptyText?: string;
  createButtonTitle?: string;
  onActivateTab: (tabId: string) => void;
  onCreateTab?: () => void;
  onReorderTabs?: (activeTabId: string, overTabId: string) => void;
  onRenameTab?: (tabId: string, title: string) => void;
  onCloseTab?: (tabId: string) => void;
  onCloseTabs?: (tabIds: string[]) => void;
  renderTabSuffix?: (tab: ReusableTabItem) => ReactNode;
};
```

补充说明：

- `renderTabSuffix` 用于扩展 terminal 的状态点等额外 UI
- 若未传 `onRenameTab`，组件自动禁用重命名
- 若未传 `onCloseTabs`，则右键菜单中的批量关闭功能禁用

## 文件拆分建议

建议新增：

- `src/components/tabs/ReusableTabs.tsx`
- `src/components/tabs/useTabBarState.ts`
- `src/components/tabs/types.ts`
- `src/components/tabs/tabOrder.ts`

建议改造：

- `src/features/main/QueryPanel/components/QueryWorkspaceTabs.tsx`
- `src/features/main/QueryPanel/hooks/useWorkspaceTabs.ts`
- `src/features/main/TerminalPanel/index.tsx`
- `src/features/main/ToolsPanel/components/JsonFormatterTool.tsx`
- `src/store/useJsonFormatterStore.ts`
- `src/store/useTerminalStore.ts`

说明：

- `tabOrder.ts` 提供顺序归一化、重排、恢复等纯函数
- 纯函数独立后更容易测试，也避免 UI 组件过重

## 测试设计

### 纯函数测试

优先为纯逻辑补测试：

- 顺序恢复
- 拖拽重排
- 批量关闭后的激活态回退
- 脏数据恢复

### 组件交互测试

至少覆盖：

- 双击进入重命名
- 回车提交重命名
- 右键菜单显示与关闭
- 拖拽排序回调触发

### 回归验证

重点验证以下场景：

- QueryPanel 在不同 source 下切换后，workspace 顺序可恢复
- JsonFormatterTool 懒恢复后标题、顺序、激活态正确
- TerminalPanel 恢复后 UI tab 仍在，但后端会话按进入流程重新建立
- 关闭激活 tab、关闭左/右/其他后，激活态回退正确

## 风险与约束

### 风险一：QueryPanel 的混合工作区语义被误抽象

规避方式：

- 通用组件只操作 `id/title`
- data/console 解析逻辑留在 QueryPanel

### 风险二：Terminal 持久化把运行态脏数据带入下次启动

规避方式：

- 明确只持久化 UI tab 数据
- 所有进程连接信息、xterm runtime、打开中的 session promise 都留在运行态

### 风险三：Json/Query/Terminal 的恢复时机不一致导致闪动

规避方式：

- 通用组件不接管 hydration
- 各 panel 继续按自己原有节奏恢复

## 实施顺序

推荐按以下顺序落地：

1. 先新增通用 tabs 模块与纯函数工具
2. 接入 QueryPanel，作为右键菜单与拖拽行为基准实现
3. 接入 JsonFormatterTool，并补齐 `tabOrder` 持久化
4. 接入 TerminalPanel，并补齐 persist 与重命名能力
5. 最后补测试与回归验证

## 预期结果

完成后应达到以下结果：

- 三处 Tab 栏交互行为统一
- 右键菜单以 QueryPanel 规则为统一标准
- 双击重命名不再在各 panel 重复实现
- Tab 顺序成为显式可持久化状态
- 业务 pane 内容与标签栏行为解耦，后续扩展成本降低
