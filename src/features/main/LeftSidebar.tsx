import { Box, Button, CircularProgress, FormControl, IconButton, MenuItem, Select, SelectChangeEvent, Stack, Typography } from "@mui/material";
import { Plus, RefreshCw } from "lucide-react";
import { ObjectList } from "../../components/ObjectList";
import { SalesforceObject, SalesforceSource } from "../../types";

type LeftSidebarProps = {
  sources: SalesforceSource[];
  selectedSourceId: string;
  pageLoading: boolean;
  objectsLoading: boolean;
  onOpenAuthWindow: () => void;
  onChangeSource: (sourceId: string) => void;
  onRefreshSources: () => void;
  objects: SalesforceObject[];
  activeTabObjectName: string;
  onOpenObject: (item: SalesforceObject) => void;
};

export function LeftSidebar({
  sources,
  selectedSourceId,
  pageLoading,
  objectsLoading,
  onOpenAuthWindow,
  onChangeSource,
  onRefreshSources,
  objects,
  activeTabObjectName,
  onOpenObject
}: LeftSidebarProps) {
  return (
    <>
      <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            DATA SOURCE
          </Typography>
          <IconButton aria-label="新增 Salesforce 认证" onClick={onOpenAuthWindow} disabled={pageLoading}>
            <Plus size={14} />
          </IconButton>
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 0.8 }}>
          <FormControl fullWidth size="small">
            <Select value={selectedSourceId} onChange={(event: SelectChangeEvent) => onChangeSource(event.target.value)}>
              <MenuItem value="">请选择数据源</MenuItem>
              {sources.map((source) => (
                <MenuItem key={source.id} value={source.id}>
                  {source.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button onClick={onRefreshSources} disabled={pageLoading} startIcon={<RefreshCw size={14} />}>
            刷新
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          OBJECTS
        </Typography>
      </Box>

      <Box sx={{ minHeight: 0, flex: 1, p: 1.5, pt: 1 }}>
        {objectsLoading ? (
          <Stack alignItems="center" justifyContent="center" spacing={1.2} sx={{ height: "100%", color: "text.secondary" }}>
            <CircularProgress size={18} />
            <Typography variant="caption">拉取 Object 列表中...</Typography>
          </Stack>
        ) : (
          <ObjectList objects={objects} activeObjectName={activeTabObjectName} onOpenObject={onOpenObject} />
        )}
      </Box>
    </>
  );
}
