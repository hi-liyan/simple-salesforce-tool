import { Box, Button, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSystemLogsQuery } from "../../queries/salesforce";

// 系统日志面板：展示后端持久化日志，支持倒序分页浏览。
export function SystemLogsPanel() {
  // 当前页（从 1 开始）。
  const [page, setPage] = useState(1);
  // 每页条数。
  const pageSize = 30;
  const { data, isFetching, isLoading, refetch, error } = useSystemLogsQuery(page, pageSize);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Box sx={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column" }}>
      {/* 顶部工具栏：标题 + 刷新 + 分页。 */}
      <Box
        sx={{
          px: 1.5,
          py: 0.9,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <Typography variant="subtitle2">系统日志</Typography>
        <Stack direction="row" spacing={0.8} alignItems="center">
          <Button startIcon={<RefreshCw size={14} />} size="small" onClick={() => void refetch()} disabled={isFetching}>
            刷新
          </Button>
          <Button size="small" disabled={page <= 1 || isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            上一页
          </Button>
          <Typography variant="caption" color="text.secondary">
            第 {page} / {totalPages} 页（共 {total} 条）
          </Typography>
          <Button
            size="small"
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </Button>
        </Stack>
      </Box>

      {/* 日志内容区。 */}
      <Box sx={{ minHeight: 0, flex: 1, overflow: "auto", px: 1.5, py: 1.2 }}>
        {isLoading && (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              正在加载系统日志...
            </Typography>
          </Stack>
        )}

        {!isLoading && error && (
          <Typography variant="caption" color="error.main">
            加载系统日志失败：{String(error)}
          </Typography>
        )}

        {!isLoading && !error && (data?.items?.length ?? 0) === 0 && (
          <Typography variant="caption" color="text.secondary">
            暂无系统日志。
          </Typography>
        )}

        {!isLoading &&
          !error &&
          data?.items.map((item) => (
            <Box key={item.id} sx={{ py: 0.8 }}>
              <Typography variant="caption" sx={{ display: "block", fontWeight: 700 }}>
                [{formatTime(item.createdAt)}] [{item.category}] [{item.action}] {item.success ? "成功" : "失败"}
              </Typography>
              <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                级别: {item.level} {item.sourceId ? `| 数据源: ${item.sourceId}` : ""} {item.target ? `| 目标: ${item.target}` : ""}
              </Typography>
              <Typography variant="caption" sx={{ display: "block" }}>
                信息: {item.message}
              </Typography>
              {item.detail && (
                <Typography variant="caption" sx={{ display: "block", color: "text.secondary", whiteSpace: "pre-wrap" }}>
                  详情: {item.detail}
                </Typography>
              )}
              <Divider sx={{ mt: 0.8 }} />
            </Box>
          ))}
      </Box>
    </Box>
  );
}

function formatTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}
