import { Box, Button, FormControl, IconButton, MenuItem, Select, SelectChangeEvent, Stack, Typography } from "@mui/material";
import { Plus, RefreshCw } from "lucide-react";
import { ObjectList } from "../../components/ObjectList";
import { SalesforceObject, SalesforceSource } from "../../types";

type LeftSidebarProps = {
  sources: SalesforceSource[];
  selectedSourceId: string;
  pageLoading: boolean;
  onOpenAuthWindow: () => void;
  onChangeSource: (sourceId: string) => void;
  onRefreshSources: () => void;
  objects: SalesforceObject[];
  activeTabObjectName: string;
  onOpenObject: (item: SalesforceObject) => void;
};

// 左侧栏：数据源与对象列表区域。
export function LeftSidebar({
  sources,
  selectedSourceId,
  pageLoading,
  onOpenAuthWindow,
  onChangeSource,
  onRefreshSources,
  objects,
  activeTabObjectName,
  onOpenObject
}: LeftSidebarProps) {
  return (
    <>
      {/* 数据源区域头部。 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        {/* 数据源标题与操作按钮行。 */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* 数据源标题。 */}
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            DATA SOURCE
          </Typography>
          {/* 新增认证按钮。 */}
          <IconButton aria-label="新增 Salesforce 认证" onClick={onOpenAuthWindow} disabled={pageLoading}>
            <Plus size={14} />
          </IconButton>
        </Box>
        {/* 数据源选择与刷新按钮行。 */}
        <Stack direction="row" spacing={1} sx={{ mt: 0.8 }}>
          {/* 数据源下拉选择器。 */}
          <FormControl fullWidth size="small">
            <Select value={selectedSourceId} onChange={(event: SelectChangeEvent) => onChangeSource(event.target.value)}>
              <MenuItem value="">请选择数据源</MenuItem>
              {sources.map((source) => (
                <MenuItem key={source.id} value={source.id}>
                  {/* 数据源名称文本。 */}
                  {source.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {/* 刷新按钮：同步 CLI 数据源。 */}
          <Button onClick={onRefreshSources} disabled={pageLoading} startIcon={<RefreshCw size={14} />}>
            刷新
          </Button>
        </Stack>
      </Box>

      {/* 对象列表标题栏。 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          OBJECTS
        </Typography>
      </Box>

      {/* 对象列表主体。 */}
      <Box sx={{ minHeight: 0, flex: 1, p: 1.5, pt: 1 }}>
        <ObjectList objects={objects} activeObjectName={activeTabObjectName} onOpenObject={onOpenObject} />
      </Box>
    </>
  );
}
