import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PanelRightOpen, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
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
  dirtyCellKeys: string[];
  baselineRecords: Record<string, Record<string, unknown>>;
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
function MainApp() {
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
    let active = true;
    const setup = async () => {
      const unlisten = await listen<{ orgId: string }>("sf:login-success", async (event) => {
        if (!active) return;
        setLoading(true);
        try {
          const list = await api.syncCliSources();
          setSources(list);

          const preferredId = event.payload?.orgId ? `cli-${event.payload.orgId}` : "";
          if (preferredId && list.some((item) => item.id === preferredId)) {
            setSelectedSourceId(preferredId);
          } else if (list.length > 0) {
            setSelectedSourceId(list[0].id);
          } else {
            setSelectedSourceId("");
          }
        } catch (error) {
          patchActiveTabNotice({ type: "error", message: `同步数据源失败：${String(error)}` });
        } finally {
          setLoading(false);
        }
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setup().then((unlisten) => {
      cleanup = unlisten;
    });
    return () => {
      active = false;
      cleanup?.();
    };
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

  function openAuthWindow() {
    api
      .openAuthWindow()
      .catch((error) => patchActiveTabNotice({ type: "error", message: `打开登录窗口失败：${String(error)}` }));
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
      dirtyCellKeys: [],
      baselineRecords: {},
      notice: null,
      loading: true
    };

    setTabs((current) => [...current, newTab]);
    setActiveTabObjectName(objectItem.name);

    try {
      const describe = await api.describeObject(selectedSourceId, objectItem.name);
      const persistedVisibility = await loadColumnVisibilityFromDb(selectedSourceId, objectItem.name, describe);
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
        columnVisibility: persistedVisibility
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
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
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
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` }
      }));
      await persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行 SOQL 失败：${String(error)}` }
      }));
    }
  }

  async function toggleDrawerForActiveTab() {
    if (!activeTab || !selectedSourceId) return;

    const nextOpen = !activeTab.showDrawer;
    if (!nextOpen) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: false }));
      return;
    }

    if (activeTab.describe) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true }));
      return;
    }

    // 抽屉打开时兜底拉取字段元数据，避免出现空白面板。
    patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true, loading: true }));
    try {
      const describe = await api.describeObject(selectedSourceId, activeTab.objectName);
      const visibility = await loadColumnVisibilityFromDb(selectedSourceId, activeTab.objectName, describe);
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        describe,
        columnVisibility: visibility,
        loading: false
      }));
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `加载字段元数据失败：${String(error)}` }
      }));
    }
  }

  function createRecordQuickly() {
    if (!activeTab) return;

    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchTab(activeTab.objectName, (item) => ({
      ...item,
      result: {
        ...item.result,
        records: [{ __localId: tempId, __isNew: true }, ...item.result.records]
      },
      notice: { type: "success", message: "已新增一行，请填写后点击执行更新。" }
    }));
  }

  async function applyPendingChanges() {
    if (!selectedSourceId || !activeTab || !activeTab.describe) return;
    if (!hasPendingChanges(activeTab)) return;

    const editableFields = new Set(activeTab.describe.fields.map((field) => field.name));
    const dirtyCellSet = new Set(activeTab.dirtyCellKeys);

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      for (let rowIndex = 0; rowIndex < activeTab.result.records.length; rowIndex += 1) {
        const record = activeTab.result.records[rowIndex];
        const recordKey = getRecordKey(record, rowIndex);
        const isNewRow = Boolean(record.__isNew);

        if (isNewRow) {
          const values: Record<string, unknown> = {};
          Object.entries(record).forEach(([field, raw]) => {
            if (field.startsWith("__") || field === "Id" || !editableFields.has(field)) return;
            if (raw === null || raw === undefined || String(raw).trim() === "") return;
            values[field] = raw;
          });
          await api.createRecord({
            sourceId: selectedSourceId,
            objectName: activeTab.objectName,
            values
          });
          continue;
        }

        const recordId = String(record.Id ?? "");
        if (!recordId) continue;

        const values: Record<string, unknown> = {};
        dirtyCellSet.forEach((cellKey) => {
          const splitIndex = cellKey.indexOf(":");
          if (splitIndex < 0) return;
          const key = cellKey.slice(0, splitIndex);
          const field = cellKey.slice(splitIndex + 1);
          if (key !== recordKey || field === "Id" || !editableFields.has(field)) return;
          values[field] = record[field];
        });

        if (Object.keys(values).length > 0) {
          await api.updateRecord(selectedSourceId, activeTab.objectName, recordId, values);
        }
      }

      await queryTabData(activeTab.objectName);
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "success", message: "执行更新成功，变更已提交。" }
      }));
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行更新失败：${String(error)}` }
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

  // 从后端 SQLite 读取字段勾选配置，并与当前对象字段做默认值合并。
  async function loadColumnVisibilityFromDb(
    sourceId: string,
    objectName: string,
    describe: ObjectDescribe
  ): Promise<Record<string, boolean>> {
    const defaults = buildDefaultVisibility(describe);
    try {
      const stored = await api.getColumnVisibility(sourceId, objectName);
      return { ...defaults, ...stored };
    } catch {
      return defaults;
    }
  }

  // 将字段勾选状态持久化到 SQLite，失败时给当前 Tab 提示，但不阻塞 UI 交互。
  async function persistColumnVisibility(sourceId: string, objectName: string, visibility: Record<string, boolean>) {
    try {
      await api.saveColumnVisibility(sourceId, objectName, visibility);
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `保存字段勾选配置失败：${String(error)}` }
      }));
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: "100vh", width: "100vw", display: "grid", gridTemplateColumns: "320px 1fr", overflow: "hidden" }}>
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid", borderColor: "divider" }}>
          <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                DATA SOURCE
              </Typography>
              <IconButton aria-label="新增 Salesforce 认证" onClick={openAuthWindow} disabled={loading}>
                <Plus size={14} />
              </IconButton>
            </Box>
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
                {/* 操作工具栏：新建、删除勾选、执行更新、字段与SOQL */}
                <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <Button
                      variant="outlined"
                      startIcon={<Plus size={14} />}
                      disabled={activeTab.loading}
                      onClick={() => createRecordQuickly()}
                      sx={{ height: 40 }}
                    >
                      新建记录
                    </Button>
                    <Button
                      color="error"
                      variant="outlined"
                      startIcon={<Trash2 size={14} />}
                      disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                      onClick={() => void deleteCheckedRecords()}
                      sx={{ height: 40 }}
                    >
                      删除勾选({activeTab.selectedRecordIds.length})
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<Play size={14} />}
                      disabled={activeTab.loading || !hasPendingChanges(activeTab)}
                      onClick={() => void applyPendingChanges()}
                      sx={{ height: 40 }}
                    >
                      执行更新
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<PanelRightOpen size={14} />}
                      disabled={activeTab.loading}
                      onClick={() => void toggleDrawerForActiveTab()}
                      sx={{ height: 40 }}
                    >
                      字段与SOQL
                    </Button>
                  </Stack>
                </Box>

                <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="nowrap">
                    <TextField
                      label="WHERE"
                      value={activeTab.whereClause}
                      sx={{ width: 320 }}
                      onChange={(event) => {
                        const nextWhere = event.target.value;
                        patchTab(activeTab.objectName, (item) => ({ ...item, whereClause: nextWhere }));
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
                      sx={{ height: 35 }}
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
                  </Stack>
                </Box>

                <Box sx={{ minHeight: 0, flex: 1 }}>
                  <DataGrid
                    result={activeTab.result}
                    visibleColumns={getVisibleColumns(activeTab)}
                    dirtyCellKeys={activeTab.dirtyCellKeys}
                    selectedRecordIds={activeTab.selectedRecordIds}
                    onToggleRecord={(recordId, checked) => {
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
                    onEditCell={(rowIndex, columnName, value) => {
                      patchTab(activeTab.objectName, (item) => {
                        const nextRecords = [...item.result.records];
                        const target = nextRecords[rowIndex];
                        if (!target) return item;

                        const nextRecord = { ...target, [columnName]: value };
                        const recordKey = getRecordKey(nextRecord, rowIndex);
                        const cellKey = `${recordKey}:${columnName}`;
                        const dirtySet = new Set(item.dirtyCellKeys);
                        const isNewRow = Boolean(nextRecord.__isNew);
                        if (isNewRow) {
                          dirtySet.add(cellKey);
                        } else {
                          const baselineValue = stringifyComparableValue(item.baselineRecords[recordKey]?.[columnName]);
                          const nextValue = stringifyComparableValue(value);
                          if (baselineValue === nextValue) {
                            dirtySet.delete(cellKey);
                          } else {
                            dirtySet.add(cellKey);
                          }
                        }

                        nextRecords[rowIndex] = nextRecord;
                        return {
                          ...item,
                          result: { ...item.result, records: nextRecords },
                          dirtyCellKeys: Array.from(dirtySet)
                        };
                      });
                    }}
                  />
                </Box>
              </Box>

              {activeTab.showDrawer && (
                <Box sx={{ width: 360, minWidth: 360, borderLeft: "1px solid", borderColor: "divider", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <Box sx={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column", borderBottom: "1px solid", borderColor: "divider" }}>
                    <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Field 元数据
                      </Typography>
                      <Button
                        variant="text"
                        size="small"
                        disabled={activeTab.loading || !activeTab.describe}
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
                          patchTab(activeTab.objectName, (item) => ({ ...item, columnVisibility: nextVisibility }));
                          if (selectedSourceId) {
                            void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                          }
                        }}
                      >
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
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={activeTab.loading}
                                  onChange={(event) => {
                                    const nextVisibility = { ...activeTab.columnVisibility, [field.name]: event.target.checked };
                                    const selectedFields = activeTab.describe!.fields
                                      .map((item) => item.name)
                                      .filter((name) => (nextVisibility[name] ?? true) === true);
                                    patchTab(activeTab.objectName, (item) => ({
                                      ...item,
                                      columnVisibility: nextVisibility
                                    }));
                                    if (selectedSourceId) {
                                      void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
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
                  </Box>

                  <Box sx={{ flex: "1 1 50%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                    <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        SOQL 执行器
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minHeight: 0, p: 1.5, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                        <Box
                          component="textarea"
                          value={activeTab.soqlDraft}
                          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                            patchTab(activeTab.objectName, (item) => ({ ...item, soqlDraft: event.target.value }))
                          }
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
                        onClick={() => void executeCustomSoql()}
                      >
                        执行 SOQL
                      </Button>
                    </Box>
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

function AuthWindow() {
  const [instanceUrl, setInstanceUrl] = useState<string>("https://login.salesforce.com");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  async function loginWithCli() {
    const normalized = normalizeInstanceUrl(instanceUrl);
    if (!normalized) {
      setError("请输入 Instance URL。");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const orgId = await api.loginCliOrg(normalized);
      await emit("sf:login-success", { orgId });
      WebviewWindow.getCurrent().close();
    } catch (loginError) {
      setError(`登录失败：${String(loginError)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">连接 Salesforce</Typography>
          <Typography variant="body2" color="text.secondary">
            请输入 Instance URL，点击登录后将在浏览器完成 OAuth 授权。
          </Typography>
          <TextField
            autoFocus
            label="Instance URL"
            value={instanceUrl}
            onChange={(event) => setInstanceUrl(event.target.value)}
            error={Boolean(error)}
            helperText={error || "示例：https://login.salesforce.com 或 https://test.salesforce.com"}
            fullWidth
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loginWithCli();
              }
            }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={() => void api.closeAuthWindow()} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void loginWithCli()} disabled={busy}>
              {busy ? "登录中..." : "登录"}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </ThemeProvider>
  );
}

export default function App() {
  return window.location.pathname === "/auth" ? <AuthWindow /> : <MainApp />;
}

function buildDefaultVisibility(describe: ObjectDescribe): Record<string, boolean> {
  return describe.fields.reduce((acc, field) => ({ ...acc, [field.name]: true }), {} as Record<string, boolean>);
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

function hasPendingChanges(tab: TabState): boolean {
  const hasNewRows = tab.result.records.some((record) => Boolean(record.__isNew));
  return hasNewRows || tab.dirtyCellKeys.length > 0;
}

function buildBaselineRecords(records: Record<string, unknown>[]): Record<string, Record<string, unknown>> {
  const baseline: Record<string, Record<string, unknown>> = {};
  records.forEach((record, index) => {
    baseline[getRecordKey(record, index)] = { ...record };
  });
  return baseline;
}

function normalizeInstanceUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function getRecordKey(record: Record<string, unknown>, rowIndex: number): string {
  if (record.__localId) return String(record.__localId);
  if (record.Id) return String(record.Id);
  return `row-${rowIndex}`;
}

function stringifyComparableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
