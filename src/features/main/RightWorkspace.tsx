import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Divider, FormControl, IconButton, InputAdornment, MenuItem, Select, SelectChangeEvent, Stack, TextField, Typography } from "@mui/material";
import { PanelRightOpen, Play, Plus, RotateCcw, ScrollText, Search, Trash2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { Notice, TabState } from "../../types";

type RightWorkspaceProps = {
  tabs: TabState[];
  activeTabObjectName: string;
  activeTab: TabState | null;
  workspaceNotice: Notice | null;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  hasPendingChanges: boolean;
  onActivateTab: (objectName: string) => void;
  onCloseTab: (objectName: string) => void;
  onCreateRecord: () => void;
  onDeleteCheckedRecords: () => void;
  onApplyPendingChanges: () => void;
  onDiscardPendingChanges: () => void;
  onToggleDrawer: () => void;
  onToggleQueryBar: () => void;
  onToggleLogs: () => void;
  onWhereChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSortFieldChange: (value: string) => void;
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  onQuery: () => void;
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAllRecords: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  onToggleAllFields: () => void;
  onToggleFieldVisibility: (fieldName: string, checked: boolean) => void;
  onSoqlChange: (value: string) => void;
  onExecuteCustomSoql: () => void;
};

// 右侧工作区：标签页、数据表格、字段抽屉与 SOQL 面板。
export function RightWorkspace({
  tabs,
  activeTabObjectName,
  activeTab,
  workspaceNotice,
  visibleColumns,
  fieldMetadataMap,
  hasPendingChanges,
  onActivateTab,
  onCloseTab,
  onCreateRecord,
  onDeleteCheckedRecords,
  onApplyPendingChanges,
  onDiscardPendingChanges,
  onToggleDrawer,
  onToggleQueryBar,
  onToggleLogs,
  onWhereChange,
  onLimitChange,
  onSortFieldChange,
  onSortDirectionChange,
  onQuery,
  onToggleRecord,
  onToggleAllRecords,
  onEditCell,
  onShowMessage,
  onToggleAllFields,
  onToggleFieldVisibility,
  onSoqlChange,
  onExecuteCustomSoql
}: RightWorkspaceProps) {
  // 日志面板高度（可拖拽调整）。
  const [logPanelHeight, setLogPanelHeight] = useState(220);
  // 拖拽状态。
  const [draggingLogResize, setDraggingLogResize] = useState(false);
  // 拖拽起始点与起始高度。
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(220);

  useEffect(() => {
    if (!draggingLogResize) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = dragStartYRef.current - event.clientY;
      const next = dragStartHeightRef.current + delta;
      const max = Math.max(260, Math.floor(window.innerHeight * 0.72));
      setLogPanelHeight(Math.max(140, Math.min(max, next)));
    };

    const onMouseUp = () => {
      setDraggingLogResize(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingLogResize]);

  return (
    <>
      {/* 工作区全局浮动提示：用于数据源切换等非 Tab 通知。 */}
      {workspaceNotice && (
        <Alert
          severity={workspaceNotice.type === "error" ? "error" : "success"}
          sx={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 60,
            maxWidth: 560,
            boxShadow: 4
          }}
        >
          {workspaceNotice.message}
        </Alert>
      )}

      {/* Tab 标签栏。 */}
      <Box sx={{ display: "flex", overflowX: "auto", borderBottom: "1px solid", borderColor: "divider" }}>
        {tabs.length === 0 && (
          <Typography variant="caption" sx={{ px: 2, py: 1.2, color: "text.secondary" }}>
            请选择左侧 Object 打开标签页
          </Typography>
        )}
        {tabs.map((tab) => {
          const active = tab.objectName === activeTabObjectName;
          return (
            <Box
              key={tab.objectName}
              sx={{
                display: "flex",
                alignItems: "center",
                borderRight: "1px solid",
                borderColor: "divider",
                bgcolor: active ? "background.paper" : "transparent"
              }}
            >
              {/* Tab 标题按钮。 */}
              <Button
                variant="text"
                onClick={() => onActivateTab(tab.objectName)}
                sx={{ px: 1.5, py: 0.8, minWidth: 0, textTransform: "none", color: active ? "primary.main" : "text.secondary" }}
              >
                {tab.objectName}
              </Button>
              {/* 关闭 Tab 按钮。 */}
              <IconButton onClick={() => onCloseTab(tab.objectName)} sx={{ mr: 0.5 }}>
                <X size={13} />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      {/* 右侧主体内容：表格 + 抽屉。 */}
      {activeTab && (
        <Box sx={{ position: "relative", display: "flex", minHeight: 0, flex: 1, overflow: "hidden" }}>
          {/* 浮动通知：不占用标准数据流。 */}
          {activeTab.notice && (
            <Alert
              severity={activeTab.notice.type === "error" ? "error" : "success"}
              sx={{
                position: "absolute",
                top: 10,
                right: 12,
                zIndex: 40,
                maxWidth: 560,
                boxShadow: 3
              }}
            >
              {activeTab.notice.message}
            </Alert>
          )}

          {/* 表格区域。 */}
          <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
            {/* 操作工具栏：新建、删除勾选、执行更新、字段与SOQL。 */}
            <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Button
                  variant="outlined"
                  startIcon={<Plus size={14} />}
                  disabled={activeTab.loading}
                  onClick={onCreateRecord}
                  sx={{ height: 40 }}
                >
                  新建记录
                </Button>
                <Button
                  color="error"
                  variant="outlined"
                  startIcon={<Trash2 size={14} />}
                  disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                  onClick={onDeleteCheckedRecords}
                  sx={{ height: 40 }}
                >
                  删除勾选({activeTab.selectedRecordIds.length})
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Play size={14} />}
                  disabled={activeTab.loading || !hasPendingChanges}
                  onClick={onApplyPendingChanges}
                  sx={{ height: 40 }}
                >
                  执行更新
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RotateCcw size={14} />}
                  disabled={activeTab.loading || !hasPendingChanges}
                  onClick={onDiscardPendingChanges}
                  sx={{ height: 40 }}
                >
                  撤回修改
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Search size={14} />}
                  disabled={activeTab.loading}
                  onClick={onToggleQueryBar}
                  sx={{ height: 40 }}
                >
                  {activeTab.showQueryBar ? "隐藏查询栏" : "显示查询栏"}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<PanelRightOpen size={14} />}
                  disabled={activeTab.loading}
                  onClick={onToggleDrawer}
                  sx={{ height: 40 }}
                >
                  字段与SOQL
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<ScrollText size={14} />}
                  disabled={activeTab.loading}
                  onClick={onToggleLogs}
                  sx={{ height: 40 }}
                >
                  日志
                </Button>
              </Stack>
            </Box>

            {/* 查询条件栏。 */}
            {activeTab.showQueryBar && (
              <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap">
                  {/* 查询条件栏关闭按钮。 */}
                  <IconButton size="small" onClick={onToggleQueryBar}>
                    <X size={14} />
                  </IconButton>
                {/* WHERE 条件输入。 */}
                <TextField
                  label="WHERE"
                  value={activeTab.whereClause}
                  sx={{ width: 320 }}
                  onChange={(event) => onWhereChange(event.target.value)}
                  InputProps={{
                    endAdornment: activeTab.whereClause ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label="清空 WHERE 条件"
                          onClick={() => onWhereChange("")}
                          edge="end"
                        >
                          <X size={13} />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined
                  }}
                />
                {/* LIMIT 输入。 */}
                <TextField
                  label="LIMIT"
                  type="number"
                  value={activeTab.limit}
                  sx={{ width: 90 }}
                  onChange={(event) => onLimitChange(Number(event.target.value || 200))}
                />
                {/* 排序字段下拉。 */}
                <FormControl size="small" sx={{ width: 200 }}>
                  <Select value={activeTab.sortField} onChange={(event: SelectChangeEvent) => onSortFieldChange(event.target.value)}>
                    {(activeTab.describe?.fields || []).map((field) => (
                      <MenuItem key={field.name} value={field.name}>
                        {/* 字段名称文本。 */}
                        {field.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {/* 排序方向下拉。 */}
                <FormControl size="small" sx={{ width: 92 }}>
                  <Select
                    value={activeTab.sortDirection}
                    onChange={(event: SelectChangeEvent) => onSortDirectionChange(event.target.value as "ASC" | "DESC")}
                  >
                    <MenuItem value="ASC">
                      {/* 升序文本。 */}
                      ASC
                    </MenuItem>
                    <MenuItem value="DESC">
                      {/* 降序文本。 */}
                      DESC
                    </MenuItem>
                  </Select>
                </FormControl>
                {/* 查询按钮。 */}
                <Button startIcon={<Search size={14} />} disabled={activeTab.loading} sx={{ height: 35 }} onClick={onQuery}>
                  查询
                </Button>
                </Stack>
              </Box>
            )}

            {/* 数据表格区域。 */}
            <Box sx={{ minHeight: 0, flex: 1 }}>
              <DataGrid
                result={activeTab.result}
                visibleColumns={visibleColumns}
                fieldMetadataMap={fieldMetadataMap}
                dirtyCellKeys={activeTab.dirtyCellKeys}
                selectedRecordIds={activeTab.selectedRecordIds}
                onToggleRecord={onToggleRecord}
                onToggleAll={onToggleAllRecords}
                onEditCell={onEditCell}
                onShowMessage={onShowMessage}
              />
            </Box>

            {/* 日志区域：展示当前 Tab 的请求与响应日志。 */}
            {activeTab.showLogs && (
              <Box
                sx={{
                  height: logPanelHeight,
                  borderTop: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  position: "relative"
                }}
              >
                {/* 拖拽手柄：调整日志区域高度。 */}
                <Box
                  onMouseDown={(event) => {
                    event.preventDefault();
                    dragStartYRef.current = event.clientY;
                    dragStartHeightRef.current = logPanelHeight;
                    setDraggingLogResize(true);
                  }}
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 6,
                    cursor: "row-resize",
                    zIndex: 1
                  }}
                />
                <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography variant="caption" color="text.secondary">
                    操作日志（当前 Tab）
                  </Typography>
                </Box>
                <Box sx={{ minHeight: 0, flex: 1, overflow: "auto", px: 1.5, py: 1 }}>
                  {activeTab.logs.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      暂无日志。
                    </Typography>
                  )}
                  {activeTab.logs.map((log) => (
                    <Box key={log.id} sx={{ mb: 1, p: 1, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
                      <Typography variant="caption" sx={{ display: "block", mb: 0.5, color: log.success ? "success.main" : "error.main" }}>
                        {formatLogTime(log.timestamp)}  [{log.action}] {log.success ? "成功" : "失败"}
                      </Typography>
                      <Typography variant="caption" sx={{ display: "block" }}>
                        请求: {log.request}
                      </Typography>
                      <Typography variant="caption" sx={{ display: "block" }}>
                        响应: {log.summary}
                      </Typography>
                      {log.errorMessage && (
                        <Typography variant="caption" sx={{ display: "block", color: "error.main" }}>
                          错误: {log.errorMessage}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>

          {/* 右侧抽屉：字段与 SOQL。 */}
          {activeTab.showDrawer && (
            <Box sx={{ width: 360, minWidth: 360, borderLeft: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* 字段元数据区块。 */}
              <Box sx={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column", borderBottom: "1px solid", borderColor: "divider" }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Field 元数据
                  </Typography>
                  <Button variant="text" size="small" disabled={activeTab.loading || !activeTab.describe} onClick={onToggleAllFields}>
                    {activeTab.describe?.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true)
                      ? "取消全选"
                      : "全选"}
                  </Button>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  {!activeTab.describe && (
                    <Box sx={{ px: 1.5, py: 1.2 }}>
                      <Typography variant="caption" color="text.secondary">
                        正在加载字段元数据...
                      </Typography>
                    </Box>
                  )}
                  {activeTab.describe && activeTab.describe.fields.length === 0 && (
                    <Box sx={{ px: 1.5, py: 1.2 }}>
                      <Typography variant="caption" color="text.secondary">
                        未获取到字段元数据。
                      </Typography>
                    </Box>
                  )}
                  {activeTab.describe?.fields.map((field) => {
                    const checked = activeTab.columnVisibility[field.name] ?? true;
                    return (
                      <Box key={field.name} sx={{ px: 1.5, py: 0.8 }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            {/* 字段可见性复选框。 */}
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={activeTab.loading}
                              onChange={(event) => onToggleFieldVisibility(field.name, event.target.checked)}
                            />
                            <Typography variant="body2">{field.name}</Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {field.label} / {field.dataType}
                          </Typography>
                        </Stack>
                        <Divider sx={{ mt: 0.8 }} />
                      </Box>
                    );
                  })}
                </Box>
              </Box>

              {/* SOQL 执行器区块。 */}
              <Box sx={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    SOQL 执行器
                  </Typography>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0, p: 1.5, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* SOQL 输入框容器。 */}
                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      border: "1px solid",
                      borderColor: "divider",
                      bgcolor: "background.paper",
                      overflow: "hidden"
                    }}
                  >
                    {/* SOQL 文本输入区域。 */}
                    <Box
                      component="textarea"
                      value={activeTab.soqlDraft}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onSoqlChange(event.target.value)}
                      sx={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        outline: "none",
                        p: 1,
                        resize: "none",
                        overflow: "auto",
                        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
                        fontSize: 12,
                        lineHeight: 1.5,
                        boxSizing: "border-box",
                        bgcolor: "background.paper",
                        color: "text.primary"
                      }}
                    />
                  </Box>
                  <Button
                    startIcon={<Play size={14} />}
                    sx={{ mt: 1, alignSelf: "flex-start" }}
                    disabled={activeTab.loading || !activeTab.soqlDraft}
                    onClick={onExecuteCustomSoql}
                  >
                    执行 SOQL
                  </Button>
                </Box>
              </Box>
            </Box>
          )}

          {/* 全局遮罩：加载中提示。 */}
          {activeTab.loading && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                bgcolor: "rgba(255,255,255,0.68)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 1.5
              }}
            >
              <CircularProgress size={42} thickness={4.5} />
              <Typography variant="body2" color="text.secondary">
                Loading...
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </>
  );
}

function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}
