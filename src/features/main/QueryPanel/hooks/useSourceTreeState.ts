import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../../../api";
import { getDataSourceDriver } from "../../../../drivers/registry";
import type { ObjectField, SalesforceObject, SalesforceSource } from "../../../../types";
import { useQuerySourceTreeStore } from "../../../../store/useQuerySourceTreeStore.ts";
import { getSourceColor } from "../logic/sourceColor.ts";
import { runQuerySourceRequestWithRetry } from "../logic/sourceTreeRetry.ts";
import {
  buildSelectedNodeId,
  collectRestorableSourceIds,
  normalizePersistedSourceTreeUiState,
  sanitizePersistedSourceTreeUiState
} from "../logic/sourceTreePersistence.ts";
import { resolveNodeDoubleClickAction } from "../logic/sourceTreeInteractions.ts";
import { searchSourceObjects, type QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";
import {
  buildDriverSourceChildren,
  buildGroupObjectChildren,
  buildObjectColumnChildren,
  buildObjectSubFolderChildren,
  buildSourceRootNodes
} from "../logic/sourceTreeProviders.ts";
import { beginRefreshingSource, finishRefreshingSource, focusSourceNode } from "../logic/sourceTreeState.ts";
import type { QueryTreeNode, SourceTreeState } from "../types/tree.ts";

// 树渲染节点：在纯逻辑节点基础上补齐 children，供左侧递归树渲染使用。
export type QueryTreeRenderNode = QueryTreeNode & {
  children?: QueryTreeRenderNode[];
};

// 添加展开节点：避免节点在异步加载期间被重复 toggle 导致展开态来回翻转。
function appendExpandedNode(expandedNodeIds: string[], nodeId: string): string[] {
  return expandedNodeIds.includes(nodeId) ? expandedNodeIds : [...expandedNodeIds, nodeId];
}

// 移除展开节点：用于显式收起节点，避免继续依赖 toggle 造成竞态。
function removeExpandedNode(expandedNodeIds: string[], nodeId: string): string[] {
  return expandedNodeIds.filter((item) => item !== nodeId);
}

// 判断对象缓存是否已准备完成：避免把“尚未真正加载完成的空缓存”误判为可搜索结果。
function hasPreparedSourceObjectsCache(treeState: SourceTreeState, sourceId: string): boolean {
  const hasCachedObjects = Object.prototype.hasOwnProperty.call(treeState.sourceObjectsById, sourceId);
  if (!hasCachedObjects) return false;

  const cachedObjects = treeState.sourceObjectsById[sourceId] || [];
  if (cachedObjects.length > 0) return true;

  return Object.prototype.hasOwnProperty.call(treeState.sourceTreeChildrenById, sourceId);
}

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
  // 当前聚焦数据源变化通知：供侧边栏搜索范围与动作按钮实时同步。
  onFocusedSourceChange?: (sourceId: string) => void;
};

type UseSourceTreeStateResult = {
  // 当前聚焦数据源 ID。
  focusedSourceId: string;
  // 树渲染数据。
  treeData: QueryTreeRenderNode[];
  // 纯状态快照：供节点渲染读取 loading/error。
  treeState: SourceTreeState;
  // 单击节点：内部处理高亮与聚焦。
  onNodeClick: (node: QueryTreeNode) => void;
  // 双击节点：source/group 切换展开，object 打开工作区。
  onNodeDoubleClick: (node: QueryTreeNode) => Promise<void>;
  // 点击展开箭头。
  onToggleNode: (node: QueryTreeNode) => Promise<void>;
  // 刷新聚焦数据源。
  refreshFocusedSource: () => Promise<void>;
  // 刷新指定数据源。
  refreshSourceById: (sourceId: string) => Promise<void>;
  // 刷新单个对象/表的字段结构缓存。
  refreshObjectColumns: (sourceId: string, objectName: string) => Promise<ObjectField[]>;
  // 折叠指定数据源下的所有展开节点。
  collapseSourceNodes: (sourceId: string) => void;
  // 定位指定 source/object 到左侧树。
  locateNodeByTarget: (target: { sourceId: string; objectName?: string }) => Promise<{ targetNodeId: string; groupNodeId?: string } | null>;
  // 搜索当前聚焦数据源下的对象/表。
  searchFocusedSourceObjects: (keyword: string) => Promise<QuerySourceObjectSearchResult[]>;
  // 根据定位目标直接打开对象。
  openObjectByTarget: (target: { sourceId: string; objectName: string }) => Promise<void>;
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
    objectFieldsByKey: {},
    objectDdlByKey: {},
    objectFieldsLoadingByKey: {},
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
  onNotQueryableObjectClick,
  onFocusedSourceChange
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
  // 数据源请求版本：仅允许最后一次请求写回状态，避免旧请求结果覆盖新结果。
  const sourceRequestVersionRef = useRef<Record<string, number>>({});
  // 数据源在途请求：同一 source 正在加载时直接复用同一个 Promise，避免重复打远端。
  const sourceLoadingPromiseRef = useRef<Record<string, Promise<SalesforceObject[]>>>({});
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

  // 将当前聚焦数据源同步给外层：确保搜索范围提示和动作按钮始终跟左树焦点一致。
  useEffect(() => {
    onFocusedSourceChange?.(treeState.focusedSourceId);
  }, [onFocusedSourceChange, treeState.focusedSourceId]);

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

  // 监听工作区/控制台 DDL 触发的元数据刷新事件，保持左树对象列表与字段缓存实时同步。
  useEffect(() => {
    const onSourceObjectsRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceId?: string; objects?: SalesforceObject[] }>).detail;
      const sourceId = String(detail?.sourceId || "").trim();
      const objects = detail?.objects;
      if (!sourceId || !Array.isArray(objects)) return;
      const source = sourceMap.get(sourceId);
      if (!source) return;

      void buildDriverSourceChildren(source, {
        getSourceColor,
        listObjects: async () => objects
      }).then((children) => {
        setTreeState((current) => {
          const nextObjectFieldsByKey = { ...current.objectFieldsByKey };
          Object.keys(nextObjectFieldsByKey).forEach((key) => {
            if (key.startsWith(`${sourceId}:`)) {
              delete nextObjectFieldsByKey[key];
            }
          });
          return {
            ...current,
            sourceObjectsById: {
              ...current.sourceObjectsById,
              [sourceId]: objects
            },
            sourceTreeChildrenById: {
              ...current.sourceTreeChildrenById,
              [sourceId]: children
            },
            objectFieldsByKey: nextObjectFieldsByKey
          };
        });
      });
    };

    window.addEventListener("query:source-objects-refreshed", onSourceObjectsRefreshed);
    return () => {
      window.removeEventListener("query:source-objects-refreshed", onSourceObjectsRefreshed);
    };
  }, [sourceMap]);

  // 加载单个数据源的根子节点，并按类型缓存对象/分组数据。
  const loadSourceChildren = useCallback(
    async (source: SalesforceSource, forceRefresh = false): Promise<SalesforceObject[]> => {
      const sourceId = source.id;
      if (!sourceId) return [];
      const existingLoadingPromise = sourceLoadingPromiseRef.current[sourceId];
      if (existingLoadingPromise) {
        return existingLoadingPromise; // 行内注释：同一 source 的展开/刷新并发时复用同一轮请求结果。
      }

      const currentRequestVersion = (sourceRequestVersionRef.current[sourceId] || 0) + 1;
      sourceRequestVersionRef.current[sourceId] = currentRequestVersion;

      // 判断当前请求是否仍是该数据源的最新请求：避免并发场景下旧结果回写导致状态闪动。
      const isLatestSourceRequest = () => sourceRequestVersionRef.current[sourceId] === currentRequestVersion;

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

      const loadingPromise = (async () => {
        try {
          const objects = await runQuerySourceRequestWithRetry(source, async () => {
            if (forceRefresh) {
              return await api.refreshObjects(sourceId); // 行内注释：显式刷新始终强制回源拉取最新对象列表。
            }
            return await api.listObjects(sourceId); // 行内注释：节点首次展开优先复用 SQLite 持久化缓存，无缓存时再由后端自动回源。
          });
          const context = {
            getSourceColor,
            listObjects: async () => objects,
            withSalesforceSourceReauth: async <T>(_source: SalesforceSource, action: () => Promise<T>) => action()
          };
          const children = await buildDriverSourceChildren(source, context);

          if (!isLatestSourceRequest()) return objects;

          setTreeState((current) => {
            // 强刷数据源时，清理该数据源下已缓存的表字段与 DDL，保证结构变化后重新展开能拉到最新结构。
            const nextObjectFieldsByKey = { ...current.objectFieldsByKey };
            const nextObjectDdlByKey = { ...current.objectDdlByKey };
            if (forceRefresh) {
              Object.keys(nextObjectFieldsByKey).forEach((key) => {
                if (key.startsWith(`${sourceId}:`)) {
                  delete nextObjectFieldsByKey[key];
                }
              });
              Object.keys(nextObjectDdlByKey).forEach((key) => {
                if (key.startsWith(`${sourceId}:`)) {
                  delete nextObjectDdlByKey[key];
                }
              });
            }
            return {
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
              },
              objectFieldsByKey: nextObjectFieldsByKey,
              objectDdlByKey: nextObjectDdlByKey
            };
          });
          return objects;
        } catch (error) {
          if (!isLatestSourceRequest()) return [];

          setTreeState((current) => ({
            ...finishRefreshingSource(current, sourceId, String(error)),
            sourceLoadingById: {
              ...current.sourceLoadingById,
              [sourceId]: false
            }
          }));
          return [];
        } finally {
          delete sourceLoadingPromiseRef.current[sourceId]; // 行内注释：当前轮请求结束后释放占位，允许后续再次手动刷新。
        }
      })();

      sourceLoadingPromiseRef.current[sourceId] = loadingPromise;
      return loadingPromise;
    },
    []
  );

  // 聚焦某个数据源：仅更新左树焦点，不触发右侧工作区切桶。
  const focusSource = useCallback((sourceId: string) => {
    onFocusedSourceChange?.(sourceId); // 行内注释：点击左树节点时立刻同步焦点，避免侧边栏文案和搜索作用域晚一拍。
    setTreeState((current) => focusSourceNode(current, sourceId));
  }, [onFocusedSourceChange]);

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

  // 判断节点当前是否已展开：统一基于本地树状态读取，避免渲染层和状态层各自维护一套展开真值。
  const isNodeExpanded = useCallback((nodeId: string) => treeState.expandedNodeIds.includes(nodeId), [treeState.expandedNodeIds]);

  // 懒加载或强制刷新指定表/对象的字段列表。
  const loadObjectFields = useCallback(
    async (source: SalesforceSource, objectName: string, forceRefresh = false): Promise<ObjectField[]> => {
      const cacheKey = `${source.id}:${objectName}`;
      if (!forceRefresh && treeState.objectFieldsByKey[cacheKey]) {
        return treeState.objectFieldsByKey[cacheKey];
      }

      setTreeState((current) => ({
        ...current,
        objectFieldsLoadingByKey: {
          ...current.objectFieldsLoadingByKey,
          [cacheKey]: true
        }
      }));

      try {
        const driver = getDataSourceDriver(source.sourceType);
        const subFolders = driver.treeConfig.objectSubFolders || [];
        const needsDdl =
          driver.capabilities.supportsDdl
          && (subFolders.includes("keys") || subFolders.includes("indexes"));

        const [describe, ddl] = await Promise.all([
          runQuerySourceRequestWithRetry(source, () => api.describeObject(source.id, objectName)),
          needsDdl
            ? api.getObjectDdl(source.id, objectName).catch(() => null)
            : Promise.resolve(null)
        ]);
        const fields = describe.fields || [];
        setTreeState((current) => ({
          ...current,
          objectFieldsByKey: {
            ...current.objectFieldsByKey,
            [cacheKey]: fields
          },
          objectDdlByKey: ddl
            ? {
                ...current.objectDdlByKey,
                [cacheKey]: ddl
              }
            : current.objectDdlByKey,
          objectFieldsLoadingByKey: {
            ...current.objectFieldsLoadingByKey,
            [cacheKey]: false
          }
        }));
        return fields;
      } catch {
        setTreeState((current) => ({
          ...current,
          objectFieldsLoadingByKey: {
            ...current.objectFieldsLoadingByKey,
            [cacheKey]: false
          }
        }));
        return [];
      }
    },
    [treeState.objectFieldsByKey]
  );

  // 确保 source/group/object 节点展开：先写入展开态，再按需补拉子节点。
  const ensureNodeExpanded = useCallback(
    async (node: QueryTreeNode) => {
      if (node.kind === "column" || node.kind === "key" || node.kind === "index") {
        return;
      }

      const source = sourceMap.get(node.sourceId);
      if (!source) return;

      focusSource(node.sourceId);

      const shouldLoadSourceChildren =
        node.kind === "source"
        && !treeState.sourceTreeChildrenById[node.sourceId]
        && !treeState.sourceLoadingById[node.sourceId];
      const shouldLoadGroupObjects =
        node.kind === "group"
        && node.groupType === "tables"
        && !treeState.sourceObjectsById[node.sourceId]
        && !treeState.sourceLoadingById[node.sourceId];
      const objectCacheKey =
        node.kind === "object" || node.kind === "object-folder"
          ? `${node.sourceId}:${node.objectName}`
          : "";
      const shouldLoadObjectFields =
        (node.kind === "object" || node.kind === "object-folder")
        && node.expandable
        && !treeState.objectFieldsByKey[objectCacheKey]
        && !treeState.objectFieldsLoadingByKey[objectCacheKey];

      if (!isNodeExpanded(node.id)) {
        setTreeState((current) => ({
          ...current,
          expandedNodeIds: appendExpandedNode(current.expandedNodeIds, node.id)
        }));

        if (shouldLoadSourceChildren || shouldLoadGroupObjects) {
          await loadSourceChildren(source, false);
        } else if (shouldLoadObjectFields && (node.kind === "object" || node.kind === "object-folder")) {
          await loadObjectFields(source, node.objectName, false);
        }
      }
    },
    [
      focusSource,
      isNodeExpanded,
      loadObjectFields,
      loadSourceChildren,
      sourceMap,
      treeState.objectFieldsByKey,
      treeState.objectFieldsLoadingByKey,
      treeState.sourceLoadingById,
      treeState.sourceObjectsById,
      treeState.sourceTreeChildrenById
    ]
  );

  // 展开/折叠节点：点击箭头时切换展开态。
  const toggleNode = useCallback(
    async (node: QueryTreeNode) => {
      if (!node.expandable) {
        return;
      }

      if (!isNodeExpanded(node.id)) {
        await ensureNodeExpanded(node);
        return;
      }

      const source = sourceMap.get(node.sourceId);
      if (!source) return;
      focusSource(node.sourceId);

      setTreeState((current) => ({
        ...current,
        expandedNodeIds: removeExpandedNode(current.expandedNodeIds, node.id)
      }));
    },
    [ensureNodeExpanded, focusSource, isNodeExpanded, sourceMap]
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

  // 节点单击：仅负责高亮与聚焦，避免与原生双击事件竞争判定窗口。
  const onNodeClick = useCallback((node: QueryTreeNode) => {
    handleSingleClick(node);
  }, [handleSingleClick]);

  // 节点双击：交给浏览器原生双击事件判定，避免手工 260ms 阈值导致操作不灵敏。
  const onNodeDoubleClick = useCallback(async (node: QueryTreeNode) => {
    const doubleClickAction = resolveNodeDoubleClickAction(node);
    if (doubleClickAction === "open") {
      openObjectNode(node);
      return;
    }
    await toggleNode(node);
  }, [openObjectNode, toggleNode]);

  // 刷新指定数据源。
  const refreshSourceById = useCallback(async (sourceId: string) => {
    if (!sourceId) return;
    const source = sourceMap.get(sourceId);
    if (!source) return;
    await loadSourceChildren(source, true);
  }, [loadSourceChildren, sourceMap]);

  // 刷新当前聚焦数据源：仅刷新该 source，不做全量同步。
  const refreshFocusedSource = useCallback(async () => {
    await refreshSourceById(treeState.focusedSourceId);
  }, [refreshSourceById, treeState.focusedSourceId]);

  // 刷新单表字段结构。
  const refreshObjectColumns = useCallback(async (sourceId: string, objectName: string) => {
    const source = sourceMap.get(sourceId);
    if (!source) return [];
    return await loadObjectFields(source, objectName, true);
  }, [loadObjectFields, sourceMap]);

  // 折叠指定数据源下的所有展开节点。
  const collapseSourceNodes = useCallback((sourceId: string) => {
    setTreeState((current) => ({
      ...current,
      expandedNodeIds: current.expandedNodeIds.filter((id) => !id.includes(`:${sourceId}`))
    }));
  }, []);

  // 定位树节点：必要时先补齐 source children，再同步焦点/高亮/展开状态。
  const locateNodeByTarget = useCallback(
    async (target: { sourceId: string; objectName?: string }) => {
      const normalizedSourceId = String(target.sourceId || "").trim();
      const normalizedObjectName = String(target.objectName || "").trim();
      if (!normalizedSourceId) return null;

      const source = sourceMap.get(normalizedSourceId);
      if (!source) return null;

      const sourceNodeId = `source:${normalizedSourceId}`;
      const driver = getDataSourceDriver(source.sourceType);
      const groupNodeId = normalizedObjectName && driver.treeConfig.useGroupNodes ? `group:${normalizedSourceId}:tables` : "";
      const targetNodeId = normalizedObjectName ? `object:${normalizedSourceId}:${normalizedObjectName}` : sourceNodeId;

      if (!treeState.sourceTreeChildrenById[normalizedSourceId] && !treeState.sourceLoadingById[normalizedSourceId]) {
        await loadSourceChildren(source, false); // 行内注释：首次定位前先补齐当前 source 的树结构与对象缓存。
      }

      setTreeState((current) => {
        const nextExpandedNodeIds = new Set(current.expandedNodeIds);
        nextExpandedNodeIds.add(sourceNodeId);
        if (groupNodeId) {
          nextExpandedNodeIds.add(groupNodeId);
        }

        return {
          ...current,
          focusedSourceId: normalizedSourceId,
          selectedNodeId: targetNodeId,
          expandedNodeIds: [...nextExpandedNodeIds]
        };
      });

      return {
        targetNodeId,
        groupNodeId: groupNodeId || undefined
      };
    },
    [loadSourceChildren, sourceMap, treeState.sourceLoadingById, treeState.sourceTreeChildrenById]
  );

  // 搜索当前聚焦数据源：优先复用缓存对象列表，不足时自动补拉一次。
  const searchFocusedSourceObjects = useCallback(
    async (keyword: string) => {
      const normalizedKeyword = String(keyword || "").trim();
      if (!normalizedKeyword) return [];

      const sourceId = treeState.focusedSourceId || selectedSourceId;
      if (!sourceId) return [];
      const source = sourceMap.get(sourceId);
      if (!source) return [];

      const hasCachedObjects = hasPreparedSourceObjectsCache(treeState, sourceId);
      const cachedObjects = treeState.sourceObjectsById[sourceId] || [];
      const objects = hasCachedObjects ? cachedObjects : await loadSourceChildren(source, false);

      return searchSourceObjects({
        keyword: normalizedKeyword,
        source,
        objects
      });
    },
    [loadSourceChildren, selectedSourceId, sourceMap, treeState.focusedSourceId, treeState.sourceObjectsById]
  );

  // 根据 source/object 直接打开对象：用于搜索结果命中后的快捷跳转。
  const openObjectByTarget = useCallback(
    async (target: { sourceId: string; objectName: string }) => {
      const normalizedSourceId = String(target.sourceId || "").trim();
      const normalizedObjectName = String(target.objectName || "").trim();
      if (!normalizedSourceId || !normalizedObjectName) return;

      const source = sourceMap.get(normalizedSourceId);
      if (!source) return;

      const hasCachedObjects = hasPreparedSourceObjectsCache(treeState, normalizedSourceId);
      const cachedObjects = treeState.sourceObjectsById[normalizedSourceId] || [];
      const objects = hasCachedObjects ? cachedObjects : await loadSourceChildren(source, false);
      const objectItem = objects.find((item) => item.name === normalizedObjectName);
      if (!objectItem) return;

      await locateNodeByTarget({
        sourceId: normalizedSourceId,
        objectName: normalizedObjectName
      });

      if (!objectItem.queryable) {
        onNotQueryableObjectClick?.(objectItem);
        return;
      }

      onOpenObject(objectItem, source);
    },
    [loadSourceChildren, locateNodeByTarget, onNotQueryableObjectClick, onOpenObject, sourceMap, treeState.sourceObjectsById]
  );

  // 构建树数据：source -> group/object -> column，支持按需展开字段节点。
  const treeData = useMemo<QueryTreeRenderNode[]>(() => {
    const rootNodes = buildSourceRootNodes(sources, {
      getSourceColor,
      listObjects: async () => []
    });

    const attachObjectColumns = (node: QueryTreeNode): QueryTreeRenderNode => {
      if (node.kind !== "object") return node;
      const cacheKey = `${node.sourceId}:${node.objectName}`;
      const hasLoadedFields = Object.prototype.hasOwnProperty.call(treeState.objectFieldsByKey, cacheKey);
      if (!hasLoadedFields) {
        return { ...node, children: [] };
      }
      const fields = treeState.objectFieldsByKey[cacheKey] || [];
      const driver = getDataSourceDriver(node.sourceType);
      const subFolders = driver.treeConfig.objectSubFolders || [];

      if (subFolders.length > 0) {
        const ddl = treeState.objectDdlByKey[cacheKey] || null;
        const folderEntries = buildObjectSubFolderChildren(
          node.sourceId,
          node.sourceType,
          node.objectName,
          subFolders,
          fields,
          ddl
        );
        return {
          ...node,
          children: folderEntries.map((entry) => ({
            ...entry.folderNode,
            children: entry.children
          }))
        };
      }

      return {
        ...node,
        children: fields.length > 0
          ? buildObjectColumnChildren(node.sourceId, node.sourceType, node.objectName, fields)
          : []
      };
    };

    return rootNodes.map((rootNode) => {
      const sourceChildren = treeState.sourceTreeChildrenById[rootNode.sourceId] || [];
      return {
        ...rootNode,
        children: sourceChildren.map((child) => {
          if (child.kind === "object") {
            return attachObjectColumns(child);
          }
          if (child.kind !== "group") return child;
          const groupObjects = child.groupType === "tables"
            ? buildGroupObjectChildren(child.sourceId, child.sourceType, treeState.sourceObjectsById[child.sourceId] || [])
            : [];
          return {
            ...child,
            children: groupObjects.map(attachObjectColumns)
          };
        })
      };
    });
  }, [sources, treeState.objectDdlByKey, treeState.objectFieldsByKey, treeState.sourceObjectsById, treeState.sourceTreeChildrenById]);

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
    onNodeClick,
    onNodeDoubleClick,
    onToggleNode: toggleNode,
    refreshFocusedSource,
    refreshSourceById,
    refreshObjectColumns,
    collapseSourceNodes,
    locateNodeByTarget,
    searchFocusedSourceObjects,
    openObjectByTarget
  };
}
