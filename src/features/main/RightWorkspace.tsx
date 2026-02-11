import { ChangeEvent } from "react";
import { Alert, Box, Button, CircularProgress, Divider, FormControl, IconButton, MenuItem, Select, SelectChangeEvent, Stack, TextField, Typography } from "@mui/material";
import { PanelRightOpen, Play, Plus, Search, Trash2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { TabState } from "../../types";

type RightWorkspaceProps = {
  tabs: TabState[];
  activeTabObjectName: string;
  activeTab: TabState | null;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  hasPendingChanges: boolean;
  onActivateTab: (objectName: string) => void;
  onCloseTab: (objectName: string) => void;
  onCreateRecord: () => void;
  onDeleteCheckedRecords: () => void;
  onApplyPendingChanges: () => void;
  onToggleDrawer: () => void;
  onWhereChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSortFieldChange: (value: string) => void;
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  onQuery: () => void;
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAllRecords: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: string) => void;
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
  visibleColumns,
  fieldMetadataMap,
  hasPendingChanges,
  onActivateTab,
  onCloseTab,
  onCreateRecord,
  onDeleteCheckedRecords,
  onApplyPendingChanges,
  onToggleDrawer,
  onWhereChange,
  onLimitChange,
  onSortFieldChange,
  onSortDirectionChange,
  onQuery,
  onToggleRecord,
  onToggleAllRecords,
  onEditCell,
  onToggleAllFields,
  onToggleFieldVisibility,
  onSoqlChange,
  onExecuteCustomSoql
}: RightWorkspaceProps) {
  return (
    <>
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

      {/* 顶部通知条。 */}
      {activeTab?.notice && (
        <Alert severity={activeTab.notice.type === "error" ? "error" : "success"} sx={{ borderRadius: 0 }}>
          {activeTab.notice.message}
        </Alert>
      )}

      {/* 右侧主体内容：表格 + 抽屉。 */}
      {activeTab && (
        <Box sx={{ position: "relative", display: "flex", minHeight: 0, flex: 1, overflow: "hidden" }}>
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
                  startIcon={<PanelRightOpen size={14} />}
                  disabled={activeTab.loading}
                  onClick={onToggleDrawer}
                  sx={{ height: 40 }}
                >
                  字段与SOQL
                </Button>
              </Stack>
            </Box>

            {/* 查询条件栏。 */}
            <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap">
                {/* WHERE 条件输入。 */}
                <TextField label="WHERE" value={activeTab.whereClause} sx={{ width: 320 }} onChange={(event) => onWhereChange(event.target.value)} />
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
              />
            </Box>
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
