import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeApi } from "react-arborist";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../../../api";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import { useQuerySourceTreeStore } from "../../../../store/useQuerySourceTreeStore.ts";
import { getSourceColor } from "../logic/sourceColor.ts";
import {
  buildSelectedNodeId,
  collectRestorableSourceIds,
  normalizePersistedSourceTreeUiState,
  sanitizePersistedSourceTreeUiState
} from "../logic/sourceTreePersistence.ts";
import { resolveNodeClickOutcome, resolveNodeDoubleClickAction, type TreeNodeClickState } from "../logic/sourceTreeInteractions.ts";
import { buildMySqlRootChildren, buildMySqlTableChildren, buildSalesforceRootChildren, buildSourceRootNodes } from "../logic/sourceTreeProviders.ts";
import { beginRefreshingSource, finishRefreshingSource, focusSourceNode, toggleExpandedNode } from "../logic/sourceTreeState.ts";
import type { QueryTreeNode, SourceTreeState } from "../types/tree.ts";

// 树渲染节点：在纯逻辑节点基础上补齐 children，供 react-arborist 使用。
export type QueryTreeRenderNode = QueryTreeNode & {
  children?: QueryTreeRenderNode[];
};

type UseSourceTreeStateInput = {
  // 全部数据源。
  sources: SalesforceSource[];
  // 兼容层：当前页面已持有的 sourceId。
  selectedSourceId: string;
  // 兼容层：当前页面已持有的对象列表。
  selectedSourceObjects: SalesforceObject[];
  // 兼容层：当前页面对象列表加载态。
  selectedSourceObjectsLoading: boolean;
  // 打开对象回调。
  onOpenObject: (item: SalesforceObject, source?: SalesforceSource) => void;
  // 不可查询对象提示。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
};

type UseSourceTreeStateResult = {
  // 当前聚焦数据源 ID。
  focusedSourceId: string;
  // 树渲染数据。
  treeData: QueryTreeRenderNode[];
  // 纯状态快照：供节点渲染读取 loading/error。
  treeState: SourceTreeState;
  // 树选择态：优先高亮聚焦数据源。
  selectionId: string;
  // 点击节点：内部处理单击聚焦与稳定双击判定。
  onNodeClick: (node: QueryTreeNode, treeNode: NodeApi<QueryTreeRenderNode>) => Promise<void>;
  // 点击展开箭头。
  onToggleNode: (node: QueryTreeNode, treeNode: NodeApi<QueryTreeRenderNode>) => Promise<void>;
  // 刷新聚焦数据源。
  refreshFocusedSource: () => Promise<void>;
};

// 创建空树状态：统一初始化所有分桶字段。
function createEmptyTreeState(focusedSourceId: string, selectedNodeId = ""): SourceTreeState {
  return {
    // 初始进入页面时，默认选中当前 source 根节点，保持树有稳定高亮。
    selectedNodeId: buildSelectedNodeId(selectedNodeId, focusedSourceId),
    focusedSourceId,
    expandedNodeIds: [],
    sourceObjectsById: {},
    sourceTreeChildrenById: {},
    sourceLoadingById: {},
    sourceRefreshingById: {},
    sourceErrorById: {},
    sourceAuthPendingById: {}
  };
}

// 多数据源树状态：负责聚焦、懒加载、展开与单源刷新。
export function useSourceTreeState({
  sources,
  selectedSourceId,
  selectedSourceObjects,
  selectedSourceObjectsLoading,
  onOpenObject,
  onNotQueryableObjectClick
}: UseSourceTreeStateInput): UseSourceTreeStateResult {
  // 左树持久化 UI 快照：跨 panel 切换与重启恢复展开/高亮状态。
  const persistedTreeUiState = useQuerySourceTreeStore((state) => state.treeUiState);
  // 写入左树持久化 UI 快照。
  const setPersistedTreeUiState = useQuerySourceTreeStore((state) => state.setTreeUiState);
  // 持久化 store 是否已完成 hydration。
  const [persistHydrated, setPersistHydrated] = useState(useQuerySourceTreeStore.persist.hasHydrated());
  // 左树状态：只服务侧边栏，不再等同于全局“当前数据源”。
  const [treeState, setTreeState] = useState<SourceTreeState>(() => {
    const initialTreeUiState = normalizePersistedSourceTreeUiState(persistedTreeUiState);
    return {
      ...createEmptyTreeState(initialTreeUiState.focusedSourceId || selectedSourceId, initialTreeUiState.selectedNodeId),
      expandedNodeIds: initialTreeUiState.expandedNodeIds
    };
  });
  // 最近一次节点点击快照：用于在 arborist 重绘场景下稳定识别双击。
  const latestClickStateRef = useRef<TreeNodeClickState | null>(null);
  // 持久化 UI 状态只恢复一次，避免后续用户交互被旧快照覆盖。
  const persistedUiAppliedRef = useRef(false);

  // 数据源索引：便于通过 sourceId 快速解析完整上下文。
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  // 监听持久化 hydration 完成：保证重启后首次进入 QueryPanel 也能拿到恢复后的树状态。
  useEffect(() => {
    if (persistHydrated) return;
    const unsubscribe = useQuerySourceTreeStore.persist.onFinishHydration(() => {
      setPersistHydrated(true);
    });
    return unsubscribe;
  }, [persistHydrated]);

  // hydration 完成后，将持久化 UI 快照灌回本地树状态。
  useEffect(() => {
    if (!persistHydrated || persistedUiAppliedRef.current) return;
    persistedUiAppliedRef.current = true;
    const restoredTreeUiState = normalizePersistedSourceTreeUiState(persistedTreeUiState);
    setTreeState((current) => ({
      ...current,
      selectedNodeId: buildSelectedNodeId(restoredTreeUiState.selectedNodeId, restoredTreeUiState.focusedSourceId || selectedSourceId),
      focusedSourceId: restoredTreeUiState.focusedSourceId || selectedSourceId,
      expandedNodeIds: restoredTreeUiState.expandedNodeIds
    }));
  }, [persistHydrated, persistedTreeUiState, selectedSourceId]);

  // 当前选中 source 的对象列表同步到左树缓存，避免首个展开时重复请求。
  useEffect(() => {
    if (!selectedSourceId || selectedSourceObjectsLoading) return;
    const selectedSource = sourceMap.get(selectedSourceId);
    if (!selectedSource) return;

    setTreeState((current) => {
      const next = {
        ...current,
        focusedSourceId: current.focusedSourceId || selectedSourceId,
        sourceObjectsById: {
          ...current.sourceObjectsById,
          [selectedSourceId]: selectedSourceObjects
        }
      };

      // Salesforce 直接把对象挂在 source 下；MySQL 根节点维持分组结构。
      if (String(selectedSource.sourceType || "salesforce").toLowerCase() === "mysql") {
        return next;
      }

      return {
        ...next,
        sourceTreeChildrenById: {
          ...current.sourceTreeChildrenById,
          [selectedSourceId]: selectedSourceObjects.map((item) => ({
            id: `object:${selectedSourceId}:${item.name}`,
            kind: "object" as const,
            sourceId: selectedSourceId,
            sourceType: String(selectedSource.sourceType || "salesforce"),
            objectName: item.name,
            label: item.label || item.name,
            queryable: item.queryable,
            expandable: false
          }))
        }
      };
    });
  }, [selectedSourceId, selectedSourceObjects, selectedSourceObjectsLoading, sourceMap]);

  // 数据源列表变化时修正聚焦源，避免指向已删除 source。
  useEffect(() => {
    if (sources.length === 0) {
      setTreeState(createEmptyTreeState(""));
      return;
    }
    setTreeState((current) => {
      const nextTreeUiState = sanitizePersistedSourceTreeUiState(
        {
          selectedNodeId: current.selectedNodeId,
          focusedSourceId: current.focusedSourceId,
          expandedNodeIds: current.expandedNodeIds
        },
        sources,
        selectedSourceId
      );
      return {
        ...current,
        selectedNodeId: nextTreeUiState.selectedNodeId,
        focusedSourceId: nextTreeUiState.focusedSourceId,
        expandedNodeIds: nextTreeUiState.expandedNodeIds
      };
    });
  }, [selectedSourceId, sources, sourceMap]);

  useEffect(() => {
    let active = true;
    let unlistenStart: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    const setup = async () => {
      unlistenStart = await listen<{ sourceId?: string }>("sf:token-refresh-start", (event) => {
        if (!active) return;
        const sourceId = String(event.payload?.sourceId || "");
        if (!sourceId) return;
        setTreeState((current) => ({
          ...current,
          sourceAuthPendingById: {
            ...current.sourceAuthPendingById,
            [sourceId]: true
          }
        }));
      });

      unlistenEnd = await listen<{ sourceId?: string }>("sf:token-refresh-end", (event) => {
        if (!active) return;
        const sourceId = String(event.payload?.sourceId || "");
        if (!sourceId) return;
        setTreeState((current) => ({
          ...current,
          sourceAuthPendingById: {
            ...current.sourceAuthPendingById,
            [sourceId]: false
          }
        }));
      });
    };

    void setup();
    return () => {
      active = false;
      unlistenStart?.();
      unlistenEnd?.();
    };
  }, []);

  // 加载单个数据源的根子节点，并按类型缓存对象/分组数据。
  const loadSourceChildren = useCallback(
    async (source: SalesforceSource, forceRefresh = false) => {
      const sourceId = source.id;
      if (!sourceId) return;

      // 加载与刷新都统一映射到节点前缀 loading，便于 UI 直接展示。
      setTreeState((current) => {
        const refreshingState = forceRefresh ? beginRefreshingSource(current, sourceId) : current;
        return {
          ...refreshingState,
          sourceLoadingById: {
            ...refreshingState.sourceLoadingById,
            [sourceId]: true
          },
          sourceErrorById: {
            ...refreshingState.sourceErrorById,
            [sourceId]: ""
          }
        };
      });

      try {
        const objects = forceRefresh
          ? await api.refreshObjects(sourceId)
          : sourceId === selectedSourceId && !selectedSourceObjectsLoading
            ? selectedSourceObjects
            : await api.listObjects(sourceId);
        const context = {
          getSourceColor,
          listObjects: async () => objects,
          withSalesforceSourceReauth: async <T>(_source: SalesforceSource, action: () => Promise<T>) => action()
        };
        const normalizedSourceType = String(source.sourceType || "salesforce").toLowerCase();
        const children = normalizedSourceType === "mysql"
          ? await buildMySqlRootChildren(source, context)
          : await buildSalesforceRootChildren(source, context);

        setTreeState((current) => ({
          ...finishRefreshingSource(current, sourceId, ""),
          sourceLoadingById: {
            ...current.sourceLoadingById,
            [sourceId]: false
          },
          sourceObjectsById: {
            ...current.sourceObjectsById,
            [sourceId]: objects
          },
          sourceTreeChildrenById: {
            ...current.sourceTreeChildrenById,
            [sourceId]: children
          }
        }));
      } catch (error) {
        setTreeState((current) => ({
          ...finishRefreshingSource(current, sourceId, String(error)),
          sourceLoadingById: {
            ...current.sourceLoadingById,
            [sourceId]: false
          }
        }));
      }
    },
    [selectedSourceId, selectedSourceObjects, selectedSourceObjectsLoading]
  );

  // 聚焦某个数据源：仅更新左树焦点，不触发右侧工作区切桶。
  const focusSource = useCallback((sourceId: string) => {
    setTreeState((current) => focusSourceNode(current, sourceId));
  }, []);

  // 处理对象打开：严格使用节点自带 source 上下文。
  const openObjectNode = useCallback((node: QueryTreeNode) => {
    if (node.kind !== "object") return;
    const source = sourceMap.get(node.sourceId);
    if (!source) return;
    const objectItem = treeState.sourceObjectsById[node.sourceId]?.find((item) => item.name === node.objectName) || {
      name: node.objectName,
      label: node.label,
      queryable: node.queryable,
      createable: false,
      updateable: false,
      deletable: false
    };
    if (!objectItem.queryable) {
      onNotQueryableObjectClick?.(objectItem);
      return;
    }
    onOpenObject(objectItem, source);
  }, [onNotQueryableObjectClick, onOpenObject, sourceMap, treeState.sourceObjectsById]);

  // 展开/折叠 source/group 节点：首次展开时先拉取子节点。
  const toggleNode = useCallback(
    async (node: QueryTreeNode, treeNode: NodeApi<QueryTreeRenderNode>) => {
      if (node.kind === "object") {
        return;
      }

      const source = sourceMap.get(node.sourceId);
      if (!source) return;

      focusSource(node.sourceId);

      // source 首次展开时加载根节点；MySQL tables 分组首次展开时补拉表列表。
      const shouldLoadSourceChildren =
        node.kind === "source"
        && !treeState.sourceTreeChildrenById[node.sourceId]
        && !treeState.sourceLoadingById[node.sourceId];
      const shouldLoadMySqlTables =
        node.kind === "group"
        && node.groupType === "tables"
        && !treeState.sourceObjectsById[node.sourceId]
        && !treeState.sourceLoadingById[node.sourceId];

      if (!treeNode.isOpen && (shouldLoadSourceChildren || shouldLoadMySqlTables)) {
        await loadSourceChildren(source, false);
      }

      setTreeState((current) => ({
        ...current,
        expandedNodeIds: toggleExpandedNode(current.expandedNodeIds, node.id)
      }));
      treeNode.toggle();
    },
    [focusSource, loadSourceChildren, sourceMap, treeState.sourceLoadingById, treeState.sourceObjectsById, treeState.sourceTreeChildrenById]
  );

  // 处理单击聚焦：任何节点点击都先更新选中行；source/object 再同步聚焦数据源。
  const handleSingleClick = useCallback((node: QueryTreeNode) => {
    setTreeState((current) => ({
      ...current,
      selectedNodeId: node.id
    }));

    if (node.kind === "source") {
      focusSource(node.sourceId);
      return;
    }
    if (node.kind === "object") {
      focusSource(node.sourceId);
    }
  }, [focusSource]);

  // 节点点击：先处理单击焦点，再基于时间窗把第二次点击提升为稳定双击动作。
  const onNodeClick = useCallback(async (node: QueryTreeNode, treeNode: NodeApi<QueryTreeRenderNode>) => {
    handleSingleClick(node);

    const outcome = resolveNodeClickOutcome(latestClickStateRef.current, node.id, Date.now());
    latestClickStateRef.current = outcome.nextState;
    if (!outcome.isDoubleClick) return;

    if (resolveNodeDoubleClickAction(node) === "open") {
      openObjectNode(node);
      return;
    }
    await toggleNode(node, treeNode);
  }, [handleSingleClick, openObjectNode, toggleNode]);

  // 刷新当前聚焦数据源：仅刷新该 source，不做全量同步。
  const refreshFocusedSource = useCallback(async () => {
    const sourceId = treeState.focusedSourceId;
    if (!sourceId) return;
    const source = sourceMap.get(sourceId);
    if (!source) return;
    await loadSourceChildren(source, true);
  }, [loadSourceChildren, sourceMap, treeState.focusedSourceId]);

  // 构建树数据：source 为根，按类型挂载对象或分组。
  const treeData = useMemo<QueryTreeRenderNode[]>(() => {
    const rootNodes = buildSourceRootNodes(sources, {
      getSourceColor,
      listObjects: async () => []
    });

    return rootNodes.map((rootNode) => {
      const sourceChildren = treeState.sourceTreeChildrenById[rootNode.sourceId] || [];
      return {
        ...rootNode,
        children: sourceChildren.map((child) => {
          if (child.kind !== "group") return child;
          return {
            ...child,
            children: child.groupType === "tables"
              ? buildMySqlTableChildren(child.sourceId, treeState.sourceObjectsById[child.sourceId] || [])
              : []
          };
        })
      };
    });
  }, [sources, treeState.sourceObjectsById, treeState.sourceTreeChildrenById]);

  // 将本地树 UI 状态持久化到 store，供切换 panel 与重启后恢复。
  useEffect(() => {
    setPersistedTreeUiState({
      selectedNodeId: treeState.selectedNodeId,
      focusedSourceId: treeState.focusedSourceId,
      expandedNodeIds: treeState.expandedNodeIds
    });
  }, [setPersistedTreeUiState, treeState.expandedNodeIds, treeState.focusedSourceId, treeState.selectedNodeId]);

  // 根据持久化的展开/高亮状态恢复必要的数据源 children，确保重启后树内容能实际展开出来。
  useEffect(() => {
    if (sources.length === 0) return;

    const restorableSourceIds = collectRestorableSourceIds(
      {
        selectedNodeId: treeState.selectedNodeId,
        focusedSourceId: treeState.focusedSourceId,
        expandedNodeIds: treeState.expandedNodeIds
      },
      sources
    );

    restorableSourceIds.forEach((sourceId) => {
      const source = sourceMap.get(sourceId);
      if (!source) return;
      if (treeState.sourceTreeChildrenById[sourceId]) return;
      if (treeState.sourceLoadingById[sourceId]) return;
      void loadSourceChildren(source, false);
    });
  }, [
    loadSourceChildren,
    sourceMap,
    sources,
    treeState.expandedNodeIds,
    treeState.focusedSourceId,
    treeState.selectedNodeId,
    treeState.sourceLoadingById,
    treeState.sourceTreeChildrenById
  ]);

  return {
    focusedSourceId: treeState.focusedSourceId,
    treeData,
    treeState,
    selectionId: treeState.selectedNodeId,
    onNodeClick,
    onToggleNode: toggleNode,
    refreshFocusedSource
  };
}
