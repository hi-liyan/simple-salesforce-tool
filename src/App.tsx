import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Divider,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme
} from "@mui/material";
import { PanelRightOpen, Play, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api } from "./api";
import { DataGrid } from "./components/DataGrid";
import { ObjectList } from "./components/ObjectList";
import { ObjectDescribe, QueryResult, SalesforceObject, SalesforceSource } from "./types";

type Notice = {
  type: "error" | "success";
  message: string;
};

type TabState = {
  objectName: string;
  label: string;
  describe: ObjectDescribe | null;
  result: QueryResult;
  whereClause: string;
  limit: number;
  sortField: string;
  sortDirection: "ASC" | "DESC";
  selectedRecordIds: string[];
  currentSoql: string;
  soqlDraft: string;
  showDrawer: boolean;
  columnVisibility: Record<string, boolean>;
  notice: Notice | null;
  loading: boolean;
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0176d3" },
    background: { default: "#f6f9fe", paper: "#ffffff" },
    divider: "#d8e5f5"
  },
  shape: { borderRadius: 0 },
  typography: {
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    fontSize: 12
  },
  components: {
    MuiButton: { defaultProps: { size: "small", variant: "contained" } },
    MuiIconButton: { defaultProps: { size: "small" } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } }
  }
});

// 主应用：Material UI + 桌面分割线风格。
export default function App() {
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabObjectName, setActiveTabObjectName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const noticeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeTab = useMemo(
    () => tabs.find((item) => item.objectName === activeTabObjectName) || null,
    [tabs, activeTabObjectName]
  );

  useEffect(() => {
    void refreshSources(true);
  }, []);

  useEffect(() => {
    // 组件卸载时清理所有通知定时器，避免内存泄漏。
    return () => {
      Object.values(noticeTimersRef.current).forEach((timer) => clearTimeout(timer));
      noticeTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      setObjects([]);
      setTabs([]);
      setActiveTabObjectName("");
      return;
    }

    setTabs([]);
    setActiveTabObjectName("");
    void refreshObjects(selectedSourceId);
  }, [selectedSourceId]);

  async function refreshSources(syncCli: boolean) {
    setLoading(true);
    try {
      const list = syncCli ? await api.syncCliSources() : await api.listSources();
      setSources(list);

      if (list.length === 0) {
        setSelectedSourceId("");
      } else if (!list.some((item) => item.id === selectedSourceId)) {
        setSelectedSourceId(list[0].id);
      }
    } catch (error) {
      patchActiveTabNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function refreshObjects(sourceId: string) {
    setLoading(true);
    try {
      const list = await api.listObjects(sourceId);
      setObjects(list);
    } catch (error) {
      patchActiveTabNotice({ type: "error", message: `拉取对象失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function patchTab(objectName: string, updater: (tab: TabState) => TabState) {
    let shouldAutoCloseNotice = false;

    setTabs((current) =>
      current.map((tab) => {
        if (tab.objectName !== objectName) return tab;

        const next = updater(tab);
        const noticeChanged =
          (tab.notice?.type ?? "") !== (next.notice?.type ?? "") ||
          (tab.notice?.message ?? "") !== (next.notice?.message ?? "");

        if (next.notice && noticeChanged) {
          shouldAutoCloseNotice = true;
        }

        if (!next.notice && noticeTimersRef.current[objectName]) {
          clearTimeout(noticeTimersRef.current[objectName]);
          delete noticeTimersRef.current[objectName];
        }

        return next;
      })
    );

    // 只要出现新的通知，就在 3 秒后自动关闭。
    if (shouldAutoCloseNotice) {
      if (noticeTimersRef.current[objectName]) {
        clearTimeout(noticeTimersRef.current[objectName]);
      }
      noticeTimersRef.current[objectName] = setTimeout(() => {
        setTabs((current) =>
          current.map((tab) =>
            tab.objectName === objectName
              ? {
                  ...tab,
                  notice: null
                }
              : tab
          )
        );
        delete noticeTimersRef.current[objectName];
      }, 3000);
    }
  }

  function patchActiveTabNotice(nextNotice: Notice) {
    if (!activeTabObjectName) return;
    patchTab(activeTabObjectName, (item) => ({ ...item, notice: nextNotice }));
  }

  async function openObjectTab(objectItem: SalesforceObject) {
    if (!selectedSourceId) return;

    const existed = tabs.find((tab) => tab.objectName === objectItem.name);
    if (existed) {
      setActiveTabObjectName(objectItem.name);
      return;
    }

    const newTab: TabState = {
      objectName: objectItem.name,
      label: objectItem.label,
      describe: null,
      result: { totalSize: 0, records: [] },
      whereClause: "",
      limit: 200,
      sortField: "Id",
      sortDirection: "DESC",
      selectedRecordIds: [],
      currentSoql: "",
      soqlDraft: "",
      showDrawer: false,
      columnVisibility: {},
      notice: null,
      loading: true
    };

    setTabs((current) => [...current, newTab]);
    setActiveTabObjectName(objectItem.name);

    try {
      const describe = await api.describeObject(selectedSourceId, objectItem.name);
      const defaultSortField = describe.fields.find((field) => field.name === "LastModifiedDate")
        ? "LastModifiedDate"
        : describe.fields.find((field) => field.name === "CreatedDate")
          ? "CreatedDate"
          : describe.fields.find((field) => field.name === "Name")
            ? "Name"
            : "Id";

      patchTab(objectItem.name, (tab) => ({
        ...tab,
        describe,
        sortField: defaultSortField,
        columnVisibility: loadColumnVisibility(selectedSourceId, objectItem.name, describe)
      }));

      await queryTabData(objectItem.name, describe, "", defaultSortField, 200, "DESC");
    } catch (error) {
      patchTab(objectItem.name, (tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `打开对象失败：${String(error)}` }
      }));
    }
  }

  async function queryTabData(
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC"
  ) {
    if (!selectedSourceId) return;
    const tab = tabs.find((item) => item.objectName === objectName);
    if (!tab && !describeOverride) return;

    const describe = describeOverride ?? tab?.describe;
    if (!describe) return;

    const whereClause = (whereOverride ?? tab?.whereClause ?? "").trim();
    const limit = Math.max(1, Math.min(2000, limitOverride ?? tab?.limit ?? 200));
    const sortField = sortFieldOverride ?? tab?.sortField ?? "Id";
    const sortDirection = directionOverride ?? tab?.sortDirection ?? "DESC";
    const visibility = tab?.columnVisibility ?? {};
    const selectedFields = describe.fields
      .map((field) => field.name)
      .filter((name) => (visibility[name] ?? true) === true);

    if (selectedFields.length === 0) {
      patchTab(objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `${objectName} 至少要勾选一个字段。` },
        loading: false
      }));
      return;
    }

    patchTab(objectName, (item) => ({ ...item, loading: true, whereClause, limit, sortField, sortDirection }));

    try {
      const soql = buildQuerySoql(objectName, selectedFields, whereClause, sortField, sortDirection, limit);
      const result = await api.queryRecords(selectedSourceId, soql);

      patchTab(objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: soql,
        soqlDraft: soql,
        notice: { type: "success", message: `${objectName} 查询成功，共 ${result.totalSize} 条。` }
      }));
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `${objectName} 查询失败：${String(error)}` }
      }));
    }
  }

  async function deleteCheckedRecords() {
    if (!selectedSourceId || !activeTab) return;
    if (activeTab.selectedRecordIds.length === 0) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: "请先勾选要删除的记录。" }
      }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));

    try {
      await Promise.all(
        activeTab.selectedRecordIds.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId))
      );

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "success", message: `已删除 ${activeTab.selectedRecordIds.length} 条记录。` }
      }));
      await queryTabData(activeTab.objectName);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `批量删除失败：${String(error)}` }
      }));
    }
  }

  async function executeCustomSoql() {
    if (!selectedSourceId || !activeTab) return;
    if (!activeTab.soqlDraft.trim()) {
      patchTab(activeTab.objectName, (item) => ({ ...item, notice: { type: "error", message: "SOQL 不能为空。" } }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      const result = await api.queryRecords(selectedSourceId, activeTab.soqlDraft);
      const nextVisibility = buildVisibilityFromSoql(activeTab.soqlDraft, activeTab.describe, activeTab.columnVisibility);

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility,
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` }
      }));
      saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行 SOQL 失败：${String(error)}` }
      }));
    }
  }

  function closeTab(objectName: string) {
    if (noticeTimersRef.current[objectName]) {
      clearTimeout(noticeTimersRef.current[objectName]);
      delete noticeTimersRef.current[objectName];
    }
    setTabs((current) => {
      const next = current.filter((item) => item.objectName !== objectName);
      if (activeTabObjectName === objectName) {
        setActiveTabObjectName(next[0]?.objectName || "");
      }
      return next;
    });
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: "100vh", width: "100vw", display: "grid", gridTemplateColumns: "320px 1fr", overflow: "hidden" }}>
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid", borderColor: "divider" }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              DATA SOURCE
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.8 }}>
              <FormControl fullWidth size="small">
                <Select value={selectedSourceId} onChange={(event: SelectChangeEvent) => setSelectedSourceId(event.target.value)}>
                  <MenuItem value="">请选择数据源</MenuItem>
                  {sources.map((source) => (
                    <MenuItem key={source.id} value={source.id}>
                      {source.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button onClick={() => void refreshSources(true)} disabled={loading} startIcon={<RefreshCw size={14} />}>
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
            <ObjectList objects={objects} activeObjectName={activeTabObjectName} onOpenObject={(item) => void openObjectTab(item)} />
          </Box>
        </Box>

        <Box sx={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                  <Button
                    variant="text"
                    onClick={() => setActiveTabObjectName(tab.objectName)}
                    sx={{ px: 1.5, py: 0.8, minWidth: 0, textTransform: "none", color: active ? "primary.main" : "text.secondary" }}
                  >
                    {tab.objectName}
                  </Button>
                  <IconButton onClick={() => closeTab(tab.objectName)} sx={{ mr: 0.5 }}>
                    <X size={13} />
                  </IconButton>
                </Box>
              );
            })}
          </Box>

          {activeTab?.notice && (
            <Alert severity={activeTab.notice.type === "error" ? "error" : "success"} sx={{ borderRadius: 0 }}>
              {activeTab.notice.message}
            </Alert>
          )}

          {activeTab && (
            <Box sx={{ position: "relative", display: "flex", minHeight: 0, flex: 1, overflow: "hidden" }}>
              <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
                <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap">
                    <TextField
                      label="WHERE"
                      value={activeTab.whereClause}
                      sx={{ width: 320 }}
                      onChange={(event) => {
                        const nextWhere = event.target.value;
                        const selectedFields = (activeTab.describe?.fields || [])
                          .map((field) => field.name)
                          .filter((name) => (activeTab.columnVisibility[name] ?? true) === true);
                        const nextSoql = buildQuerySoql(
                          activeTab.objectName,
                          selectedFields,
                          nextWhere,
                          activeTab.sortField,
                          activeTab.sortDirection,
                          activeTab.limit
                        );
                        patchTab(activeTab.objectName, (item) => ({ ...item, whereClause: nextWhere, soqlDraft: nextSoql }));
                      }}
                    />
                    <TextField
                      label="LIMIT"
                      type="number"
                      value={activeTab.limit}
                      sx={{ width: 90 }}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value || 200);
                        patchTab(activeTab.objectName, (item) => ({ ...item, limit: nextLimit }));
                      }}
                    />
                    <FormControl size="small" sx={{ width: 200 }}>
                      <Select
                        value={activeTab.sortField}
                        onChange={(event: SelectChangeEvent) =>
                          patchTab(activeTab.objectName, (item) => ({ ...item, sortField: event.target.value }))
                        }
                      >
                        {(activeTab.describe?.fields || []).map((field) => (
                          <MenuItem key={field.name} value={field.name}>
                            {field.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ width: 92 }}>
                      <Select
                        value={activeTab.sortDirection}
                        onChange={(event: SelectChangeEvent) =>
                          patchTab(activeTab.objectName, (item) => ({
                            ...item,
                            sortDirection: event.target.value as "ASC" | "DESC"
                          }))
                        }
                      >
                        <MenuItem value="ASC">ASC</MenuItem>
                        <MenuItem value="DESC">DESC</MenuItem>
                      </Select>
                    </FormControl>
                    <Button
                      startIcon={<Search size={14} />}
                      disabled={activeTab.loading}
                      onClick={() =>
                        void queryTabData(
                          activeTab.objectName,
                          activeTab.describe || undefined,
                          activeTab.whereClause,
                          activeTab.sortField,
                          activeTab.limit,
                          activeTab.sortDirection
                        )
                      }
                    >
                      查询
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<PanelRightOpen size={14} />}
                      disabled={activeTab.loading}
                      onClick={() => patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: !item.showDrawer }))}
                    >
                      字段与 SOQL
                    </Button>
                    <Button
                      color="error"
                      variant="outlined"
                      startIcon={<Trash2 size={14} />}
                      disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                      onClick={() => void deleteCheckedRecords()}
                    >
                      删除已勾选({activeTab.selectedRecordIds.length})
                    </Button>
                  </Stack>
                </Box>

                <Box sx={{ minHeight: 0, flex: 1 }}>
                  <DataGrid
                    result={activeTab.result}
                    visibleColumns={getVisibleColumns(activeTab)}
                    selectedRecordIds={activeTab.selectedRecordIds}                    onToggleRecord={(recordId, checked) => {
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        selectedRecordIds: checked
                          ? Array.from(new Set([...item.selectedRecordIds, recordId]))
                          : item.selectedRecordIds.filter((id) => id !== recordId)
                      }));
                    }}
                    onToggleAll={(checked, recordIds) => {
                      patchTab(activeTab.objectName, (item) => ({ ...item, selectedRecordIds: checked ? recordIds : [] }));
                    }}
                  />
                </Box>
              </Box>

              {activeTab.showDrawer && activeTab.describe && (
                <Box sx={{ width: 360, minWidth: 360, borderLeft: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column" }}>
                  <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Field 元数据
                    </Typography>
                    <Button
                      variant="text"
                      size="small"
                      disabled={activeTab.loading}
                      onClick={() => {
                        const allSelected = activeTab.describe!.fields.every(
                          (field) => (activeTab.columnVisibility[field.name] ?? true) === true
                        );
                        const nextChecked = !allSelected;
                        const nextVisibility = activeTab.describe!.fields.reduce((acc, field) => {
                          acc[field.name] = nextChecked;
                          return acc;
                        }, {} as Record<string, boolean>);

                        const selectedFields = nextChecked ? activeTab.describe!.fields.map((item) => item.name) : [];
                        const nextSoql = buildQuerySoql(
                          activeTab.objectName,
                          selectedFields,
                          activeTab.whereClause,
                          activeTab.sortField,
                          activeTab.sortDirection,
                          activeTab.limit
                        );

                        patchTab(activeTab.objectName, (item) => ({ ...item, columnVisibility: nextVisibility, soqlDraft: nextSoql }));
                        if (selectedSourceId) {
                          saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                        }
                      }}
                    >
                      {activeTab.describe!.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true)
                        ? "取消全选"
                        : "全选"}
                    </Button>
                  </Box>

                  <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                    {activeTab.describe.fields.map((field) => {
                      const checked = activeTab.columnVisibility[field.name] ?? true;
                      return (
                        <Box key={field.name} sx={{ px: 1.5, py: 0.8 }}>
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={activeTab.loading}
                                onChange={(event) => {
                                  const nextVisibility = { ...activeTab.columnVisibility, [field.name]: event.target.checked };
                                  const selectedFields = activeTab.describe!.fields
                                    .map((item) => item.name)
                                    .filter((name) => (nextVisibility[name] ?? true) === true);
                                  const nextSoql = buildQuerySoql(
                                    activeTab.objectName,
                                    selectedFields,
                                    activeTab.whereClause,
                                    activeTab.sortField,
                                    activeTab.sortDirection,
                                    activeTab.limit
                                  );

                                  patchTab(activeTab.objectName, (item) => ({
                                    ...item,
                                    columnVisibility: nextVisibility,
                                    soqlDraft: nextSoql
                                  }));
                                  if (selectedSourceId) {
                                    saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                                  }
                                }}
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

                  <Box sx={{ borderTop: "1px solid", borderColor: "divider", p: 1.5, display: "flex", flexDirection: "column", minHeight: 220 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", mb: 1 }}>
                      SOQL 执行器
                    </Typography>
                    <TextField
                      multiline
                      minRows={6}
                      value={activeTab.soqlDraft}
                      onChange={(event) => patchTab(activeTab.objectName, (item) => ({ ...item, soqlDraft: event.target.value }))}
                      sx={{ flex: 1 }}
                    />
                    <Button startIcon={<Play size={14} />} sx={{ mt: 1, alignSelf: "flex-start" }} onClick={() => void executeCustomSoql()}>
                      执行 SOQL
                    </Button>
                  </Box>
                </Box>
              )}

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
        </Box>
      </Box>
    </ThemeProvider>
  );
}

function getVisibilityStorageKey(sourceId: string, objectName: string): string {
  return `column_visibility:${sourceId}:${objectName}`;
}

function loadColumnVisibility(sourceId: string, objectName: string, describe: ObjectDescribe): Record<string, boolean> {
  const key = getVisibilityStorageKey(sourceId, objectName);
  const defaults = describe.fields.reduce(
    (acc, field) => ({ ...acc, [field.name]: true }),
    {} as Record<string, boolean>
  );

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function saveColumnVisibility(sourceId: string, objectName: string, visibility: Record<string, boolean>) {
  const key = getVisibilityStorageKey(sourceId, objectName);
  localStorage.setItem(key, JSON.stringify(visibility));
}

function getVisibleColumns(tab: TabState): string[] {
  if (!tab.describe) return [];
  return tab.describe.fields
    .map((field) => field.name)
    .filter((name) => (tab.columnVisibility[name] ?? true) === true);
}

function buildVisibilityFromSoql(
  soql: string,
  describe: ObjectDescribe | null,
  fallback: Record<string, boolean>
): Record<string, boolean> {
  if (!describe) return fallback;
  const selected = extractSelectedFields(soql);
  if (selected.length === 0) return fallback;

  const selectedSet = new Set(selected.map((name) => name.toLowerCase()));
  return describe.fields.reduce((acc, field) => {
    acc[field.name] = selectedSet.has(field.name.toLowerCase());
    return acc;
  }, {} as Record<string, boolean>);
}

function extractSelectedFields(soql: string): string[] {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^select\s+(.+?)\s+from\s+/i);
  if (!match) return [];

  const fieldSegment = match[1].trim();
  if (!fieldSegment || fieldSegment === "*") return [];
  if (/^count\(/i.test(fieldSegment)) return [];

  return fieldSegment
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const withoutAlias = item.split(/\s+/)[0];
      const dotParts = withoutAlias.split(".");
      return dotParts[dotParts.length - 1];
    });
}

function extractWhereClause(soql: string, objectName: string): string | null {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const objectEscaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`\\sfrom\\s+${objectEscaped}\\s*(.*)$`, "i"));
  if (!match) return null;
  const tail = match[1].trim();

  const whereMatch = tail.match(/^where\s+(.+?)(\s+order\s+by\s+|\s+limit\s+|$)/i);
  if (!whereMatch) return "";
  return whereMatch[1].trim();
}

function buildQuerySoql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  const whereSegment = whereClause.trim() ? ` WHERE ${whereClause.trim()}` : "";
  return `SELECT ${fields.join(", ")} FROM ${objectName}${whereSegment} ORDER BY ${sortField} ${sortDirection} LIMIT ${limit}`;
}




