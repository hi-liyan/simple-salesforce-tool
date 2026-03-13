import { useCallback, MutableRefObject } from "react";
import { QueryClient } from "@tanstack/react-query";
import { api } from "../../../../api";
import { Notice, SalesforceSource } from "../../../../types";

// 数据源刷新控制项：用于区分首屏本地恢复、后台静默同步与用户手动刷新。
type RefreshSourcesOptions = {
  // 是否在刷新数据源后强制回源刷新对象列表。
  forceObjectRefresh?: boolean;
  // 是否展示页面级 loading。
  showLoading?: boolean;
};

type UseSourceActionsInput = {
  // 当前数据源列表。
  sources: SalesforceSource[];
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 设置全局 loading。
  setLoading: (loading: boolean) => void;
  // 写入当前选中数据源。
  setSelectedSourceId: (sourceId: string) => void;
  // React Query 客户端。
  queryClient: QueryClient;
  // 同步 CLI 数据源能力。
  syncSources: () => Promise<SalesforceSource[]>;
  // 切换请求序号引用：用于并发保护。
  sourceSwitchSeqRef: MutableRefObject<number>;
  // 工作区提示展示能力。
  showWorkspaceNotice: (notice: Notice, durationMs?: number) => void;
  // 清理工作区提示能力。
  clearWorkspaceNotice: () => void;
  // 激活 Tab 提示能力。
  patchActiveTabNotice: (notice: Notice) => void;
};

// 数据源相关行为：统一封装刷新与切换流程，降低 MainPage 复杂度。
export function useSourceActions({
  sources,
  selectedSourceId,
  setLoading,
  setSelectedSourceId,
  queryClient,
  syncSources,
  sourceSwitchSeqRef,
  showWorkspaceNotice,
  clearWorkspaceNotice,
  patchActiveTabNotice
}: UseSourceActionsInput) {
  // 刷新数据源：支持同步 CLI 或直接拉取本地列表，并在显式刷新时强制更新当前 Objects 缓存。
  const refreshSources = useCallback(
    async (syncCli: boolean, preferredOrgId?: string, preferredSourceId?: string, options?: RefreshSourcesOptions) => {
      // 默认保持“用户主动刷新”的行为：展示 loading，并同步刷新当前数据源的 Objects 本地缓存。
      const { forceObjectRefresh = true, showLoading = true } = options || {};
      if (showLoading) {
        setLoading(true);
      }
      try {
        let list = sources;
        if (syncCli) {
          list = await syncSources();
        } else {
          list = await queryClient.fetchQuery({
            queryKey: ["sources"],
            queryFn: () => api.listSources()
          });
        }

        const preferredId = preferredOrgId ? `cli-${preferredOrgId}` : "";
        // 计算刷新后的最终选中数据源，用于决定是否要同步刷新 Objects。
        let nextSelectedSourceId = "";
        if (preferredId && list.some((item) => item.id === preferredId)) {
          nextSelectedSourceId = preferredId;
        } else if (preferredSourceId && list.some((item) => item.id === preferredSourceId)) {
          nextSelectedSourceId = preferredSourceId; // 启动恢复：命中历史数据源时优先沿用。
        } else if (!list.some((item) => item.id === selectedSourceId)) {
          nextSelectedSourceId = "";
        } else {
          nextSelectedSourceId = selectedSourceId;
        }
        setSelectedSourceId(nextSelectedSourceId);

        // 非首屏恢复场景下，若当前仍有选中数据源，则立即重新拉取 Objects 列表。
        if (forceObjectRefresh && nextSelectedSourceId) {
          await queryClient.fetchQuery({
            queryKey: ["objects", nextSelectedSourceId],
            // 显式刷新时强制请求后端远端拉取接口，并回写数据库缓存。
            staleTime: 0,
            queryFn: () => api.refreshObjects(nextSelectedSourceId)
          });
        }
      } catch (error) {
        patchActiveTabNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
      } finally {
        // 静默刷新时不改动页面级 loading，避免后台同步打断用户操作。
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [setLoading, sources, syncSources, queryClient, selectedSourceId, setSelectedSourceId, patchActiveTabNotice]
  );

  // 切换数据源：仅切换当前上下文，Objects 列表由缓存优先链路接管，不再切换即强制远端刷新。
  const handleSourceChange = useCallback(
    async (sourceId: string) => {
      // 切回“未选择数据源”属于本地状态切换，不需要远端校验。
      if (!sourceId) {
        setSelectedSourceId("");
        clearWorkspaceNotice();
        return;
      }

      // 递增切换序号：保留并发语义，便于后续扩展更多切换副作用。
      sourceSwitchSeqRef.current += 1;

      // UX 优化：先切换到目标数据源，让用户立刻感知选择变化。
      setSelectedSourceId(sourceId);
      clearWorkspaceNotice();

      // 预热当前数据源的 Objects 查询：优先命中 React Query/本地数据库缓存，避免首次渲染再补发请求。
      void queryClient.prefetchQuery({
        queryKey: ["objects", sourceId],
        queryFn: () => api.listObjects(sourceId),
        staleTime: Number.POSITIVE_INFINITY
      });
    },
    [setSelectedSourceId, clearWorkspaceNotice, sourceSwitchSeqRef, queryClient]
  );

  return {
    refreshSources,
    handleSourceChange
  };
}
