import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { SalesforceObject, SalesforceSource, SystemLogPage } from "../types";

// React Query Key：数据源列表。
const sourcesKey = ["sources"] as const;

// React Query Key：对象列表。
const objectsKey = (sourceId: string) => ["objects", sourceId] as const;
const systemLogsKey = (page: number, pageSize: number) => ["system-logs", page, pageSize] as const;

// 数据源列表查询（普通刷新）。
export function useSourcesQuery(enabled = true) {
  return useQuery<SalesforceSource[]>({
    queryKey: sourcesKey,
    queryFn: () => api.listSources(),
    // 启动阶段允许由外层手动注入首屏数据，避免 Query 再次重复拉本地列表。
    enabled
  });
}

// 数据源同步（从 CLI 获取）。
export function useSyncSourcesMutation() {
  const queryClient = useQueryClient();
  return useMutation<SalesforceSource[]>({
    mutationFn: () => api.syncCliSources(),
    onSuccess: (list) => {
      queryClient.setQueryData(sourcesKey, list);
    }
  });
}

// 对象列表查询（依赖所选数据源）。
export function useObjectsQuery(sourceId: string) {
  return useQuery<SalesforceObject[]>({
    queryKey: objectsKey(sourceId),
    queryFn: () => api.listObjects(sourceId),
    enabled: Boolean(sourceId),
    // Objects 列表改为“手动刷新”模式：会话内命中后不再自动判旧，切换数据源时优先复用本地缓存。
    staleTime: Number.POSITIVE_INFINITY
  });
}

// 主动刷新对象列表。
export function useRefreshObjects() {
  const queryClient = useQueryClient();
  return (sourceId: string) => queryClient.invalidateQueries({ queryKey: objectsKey(sourceId) });
}

// 主动刷新数据源列表。
export function useRefreshSources() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: sourcesKey });
}

// 系统日志分页查询（按时间倒序）。
export function useSystemLogsQuery(page: number, pageSize: number) {
  return useQuery<SystemLogPage>({
    queryKey: systemLogsKey(page, pageSize),
    queryFn: () => api.listSystemLogs(page, pageSize)
  });
}
