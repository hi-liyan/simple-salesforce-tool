import type { SalesforceObject, SalesforceSource } from "../../../../types/index.ts";

// Query 统一树节点：供左侧多数据源树与不同 provider 共享。
export type QueryTreeNode =
  | {
      id: string;
      kind: "source";
      sourceId: string;
      sourceType: string;
      sourceName: string;
      sourceColor: string;
      label: string;
      expandable: true;
    }
  | {
      id: string;
      kind: "group";
      sourceId: string;
      sourceType: string;
      groupType: string;
      label: string;
      count?: number;
      expandable: boolean;
    }
  | {
      id: string;
      kind: "object";
      sourceId: string;
      sourceType: string;
      objectName: string;
      label: string;
      queryable: boolean;
      expandable: boolean;
    };

// 树 provider 上下文：封装颜色读取与对象列表获取能力。
export type QueryTreeProviderContext = {
  // 读取数据源颜色：供 root source 节点展示色标。
  getSourceColor: (source: SalesforceSource) => string;
  // 拉取指定数据源对象列表：供 Salesforce / MySQL provider 复用。
  listObjects: (sourceId: string) => Promise<SalesforceObject[]>;
  // Salesforce 认证重试包装器：供 provider 在对象加载时复用现有 token 刷新链路。
  withSalesforceSourceReauth?: <T>(source: SalesforceSource, action: () => Promise<T>) => Promise<T>;
};

// 左侧树按数据源分桶状态：用于聚焦、高亮、刷新和错误提示。
export type SourceTreeState = {
  // 当前被点击选中的节点 ID：用于驱动整行浅蓝高亮。
  selectedNodeId: string;
  // 当前聚焦的数据源 ID：用于刷新、控制台等业务动作定位。
  focusedSourceId: string;
  // 已展开的节点 ID 列表。
  expandedNodeIds: string[];
  // 各数据源已缓存的对象列表。
  sourceObjectsById: Record<string, SalesforceObject[]>;
  // 各数据源根子节点缓存。
  sourceTreeChildrenById: Record<string, QueryTreeNode[]>;
  // 各数据源加载态。
  sourceLoadingById: Record<string, boolean>;
  // 各数据源刷新态。
  sourceRefreshingById: Record<string, boolean>;
  // 各数据源错误信息。
  sourceErrorById: Record<string, string>;
  // 各数据源认证刷新中的标记。
  sourceAuthPendingById: Record<string, boolean>;
};
