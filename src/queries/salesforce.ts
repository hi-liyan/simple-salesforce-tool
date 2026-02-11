import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { SalesforceObject, SalesforceSource } from "../types";

// React Query Key：数据源列表。
const sourcesKey = ["sources"] as const;

// React Query Key：对象列表。
const objectsKey = (sourceId: string) => ["objects", sourceId] as const;

// 数据源列表查询（普通刷新）。
export function useSourcesQuery() {
  return useQuery<SalesforceSource[]>({
    queryKey: sourcesKey,
    queryFn: () => api.listSources()
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
    enabled: Boolean(sourceId)
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
