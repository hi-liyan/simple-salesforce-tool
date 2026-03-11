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
  // 刷新数据源：支持同步 CLI 或直接拉取本地列表，并在必要时刷新对象列表。
  const refreshSources = useCallback(
    async (syncCli: boolean, preferredOrgId?: string, preferredSourceId?: string, options?: RefreshSourcesOptions) => {
      // 默认保持原行为：既展示 loading，也在有选中数据源时强制刷新对象列表。
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

  // 切换数据源：先乐观切换，再以强制刷新对象列表作为成功判定，失败则回滚。
  const handleSourceChange = useCallback(
    async (sourceId: string) => {
      // 切回“未选择数据源”属于本地状态切换，不需要远端校验。
      if (!sourceId) {
        setSelectedSourceId("");
        clearWorkspaceNotice();
        return;
      }

      // 记录切换前数据源，失败时用于回滚。
      const previousSourceId = selectedSourceId;
      // 切换前数据源展示名：用于失败回滚提示文案。
      const previousSourceDisplayName =
        sources.find((item) => item.id === previousSourceId)?.name || (previousSourceId ? previousSourceId : "未选择数据源");
      // 生成本次切换请求序号，后续用于识别过期请求。
      const switchSeq = sourceSwitchSeqRef.current + 1;
      sourceSwitchSeqRef.current = switchSeq;
      const selectedSource = sources.find((item) => item.id === sourceId);
      const sourceDisplayName = selectedSource?.name || sourceId;

      // UX 优化：先切换到目标数据源，让用户立刻感知选择变化。
      setSelectedSourceId(sourceId);
      setLoading(true);
      try {
        // 再强制拉取远端 Objects 作为“切换成功”判定，避免命中缓存造成假成功提示。
        await queryClient.fetchQuery({
          queryKey: ["objects", sourceId],
          queryFn: () => api.refreshObjects(sourceId)
        });
        // 若当前请求已过期（用户又切换了其他数据源），忽略本次结果。
        if (sourceSwitchSeqRef.current !== switchSeq) return;
        showWorkspaceNotice({
          type: "success",
          message: `已切换到数据源：${sourceDisplayName}`
        });
      } catch (error) {
        // 若当前请求已过期（用户又切换了其他数据源），忽略本次结果。
        if (sourceSwitchSeqRef.current !== switchSeq) return;
        // 切换失败时回滚到切换前状态，并明确给出失败提示。
        setSelectedSourceId(previousSourceId);
        showWorkspaceNotice(
          {
            type: "error",
            message: `切换数据源失败，已恢复到原数据源（${previousSourceDisplayName}）：${String(error)}`
          },
          5000
        );
      } finally {
        // 仅由最新切换请求结束 loading，避免并发下被过期请求提前关闭。
        if (sourceSwitchSeqRef.current !== switchSeq) return;
        setLoading(false);
      }
    },
    [setSelectedSourceId, clearWorkspaceNotice, selectedSourceId, sources, sourceSwitchSeqRef, setLoading, queryClient, showWorkspaceNotice]
  );

  return {
    refreshSources,
    handleSourceChange
  };
}
