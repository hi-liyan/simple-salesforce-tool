import type { ContextMenuEntry } from "../../../../components/ContextMenu.tsx";
import { getDataSourceDriver } from "../../../../drivers/registry.ts";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import type { QueryTreeNode } from "../types/tree.ts";

export type SourceTreeContextMenuHandlers = {
  // 打开对象数据 Tab。
  onOpenObjectData: (source: SalesforceSource, objectItem: SalesforceObject) => void;
  // 新建查询控制台（可选附带初始 SQL）。
  onOpenConsole: (source: SalesforceSource, initialSql?: string) => void;
  // 刷新整个数据源结构。
  onRefreshSource: (source: SalesforceSource) => void;
  // 刷新指定分组列表。
  onRefreshGroup?: (source: SalesforceSource, groupType: string) => void;
  // 测试数据源连接。
  onTestSourceConnection: (source: SalesforceSource) => void;
  // 折叠指定数据源下的所有展开节点。
  onCollapseSource: (sourceId: string) => void;
  // 编辑数据源连接配置。
  onEditSource?: (source: SalesforceSource) => void;
  // 复制数据源连接配置。
  onDuplicateSource?: (source: SalesforceSource) => void;
  // 删除数据源连接。
  onDeleteSource?: (source: SalesforceSource) => void;
  // 打开 OAuth 授权窗口（仅支持驱动）。
  onOpenAuthWindow: () => void;
  // 刷新单表/单对象元数据与 DDL。
  onRefreshObject: (source: SalesforceSource, objectName: string) => void;
  // 复制文本到剪贴板。
  onCopyText: (text: string, label: string) => void;
  // 复制建表 DDL（仅支持驱动）。
  onCopyObjectDdl: (source: SalesforceSource, objectName: string) => void;
  // 打开云端列表页（仅支持驱动）。
  onOpenCloudListPage: (source: SalesforceSource, objectItem: SalesforceObject) => void;
  // 打开云端对象管理页（仅支持驱动）。
  onOpenCloudEditPage: (source: SalesforceSource, objectItem: SalesforceObject) => void;
  // 打开新建表设计器（仅支持表设计器的驱动）。
  onCreateTable?: (source: SalesforceSource) => void;
  // 打开编辑表结构设计器（仅支持表设计器的驱动）。
  onEditTable?: (source: SalesforceSource, tableName: string) => void;
  // 打开多格式全表导出弹窗。
  onExportTableData?: (source: SalesforceSource, tableName: string) => void;
  // 打开整库备份弹窗（仅支持备份的驱动）。
  onBackupDatabase?: (source: SalesforceSource) => void;
  // 打开单表备份弹窗（仅支持备份的驱动）。
  onBackupTable?: (source: SalesforceSource, tableName: string) => void;
  // 查看存储过程/函数、触发器或定时事件的 DDL 定义。
  onViewSchemaObjectDdl?: (
    source: SalesforceSource,
    objectKind: "routine" | "trigger" | "event",
    objectName: string,
    routineType?: string
  ) => void;
  // 新建本地虚拟视图。
  onCreateVirtualView?: (source: SalesforceSource) => void;
  // 编辑本地虚拟视图。
  onEditVirtualView?: (
    source: SalesforceSource,
    viewNode: Extract<QueryTreeNode, { kind: "virtual-view" }>
  ) => void;
  // 删除本地虚拟视图。
  onDeleteVirtualView?: (
    source: SalesforceSource,
    viewNode: Extract<QueryTreeNode, { kind: "virtual-view" }>
  ) => void;
};

type BuildTreeContextMenuInput = {
  node: QueryTreeNode;
  source: SalesforceSource;
  objectItem?: SalesforceObject | null;
  handlers: SourceTreeContextMenuHandlers;
};

// 根据节点层级与驱动能力生成 DBX 风格右键上下文菜单（禁止硬编码数据源分支）。
export function buildSourceTreeContextMenuEntries({
  node,
  source,
  objectItem,
  handlers
}: BuildTreeContextMenuInput): ContextMenuEntry[] {
  const driver = getDataSourceDriver(source.sourceType);

  if (node.kind === "source") {
    const entries: ContextMenuEntry[] = [
      {
        id: "source-open-console",
        label: "新建查询控制台",
        onClick: () => handlers.onOpenConsole(source)
      },
      {
        id: "source-refresh",
        label: "刷新数据源结构",
        onClick: () => handlers.onRefreshSource(source)
      },
      {
        id: "source-test",
        label: "测试连接",
        onClick: () => handlers.onTestSourceConnection(source)
      },
      {
        id: "source-collapse",
        label: "折叠全部子节点",
        onClick: () => handlers.onCollapseSource(source.id)
      },
      { id: "source-manage-sep", type: "separator" },
      ...(handlers.onEditSource
        ? [
            {
              id: "source-edit",
              label: "编辑连接",
              onClick: () => handlers.onEditSource?.(source)
            }
          ]
        : []),
      ...(handlers.onDuplicateSource
        ? [
            {
              id: "source-duplicate",
              label: "复制连接",
              onClick: () => handlers.onDuplicateSource?.(source)
            }
          ]
        : []),
      ...(handlers.onDeleteSource
        ? [
            {
              id: "source-delete",
              label: "删除连接",
              onClick: () => handlers.onDeleteSource?.(source)
            }
          ]
        : [])
    ];

    if (driver.capabilities.supportsBackup && handlers.onBackupDatabase) {
      entries.push(
        { id: "source-backup-sep", type: "separator" },
        {
          id: "source-backup-db",
          label: "备份数据库 (.sql)",
          onClick: () => handlers.onBackupDatabase?.(source)
        }
      );
    }

    if (driver.capabilities.supportsAuthWindow) {
      entries.push(
        { id: "source-auth-sep", type: "separator" },
        {
          id: "source-oauth",
          label: "重新授权 (OAuth)",
          onClick: () => handlers.onOpenAuthWindow()
        }
      );
    }
    return entries;
  }

  if (node.kind === "group") {
    const groupEntries: ContextMenuEntry[] = [
      {
        id: "group-refresh",
        label: "刷新列表",
        onClick: () =>
          handlers.onRefreshGroup
            ? handlers.onRefreshGroup(source, node.groupType)
            : handlers.onRefreshSource(source)
      },
      {
        id: "group-open-console",
        label: "新建查询控制台",
        onClick: () => handlers.onOpenConsole(source)
      }
    ];
    if (node.groupType === "tables" && driver.capabilities.supportsTableDesigner && handlers.onCreateTable) {
      groupEntries.push(
        { id: "group-designer-sep", type: "separator" },
        {
          id: "group-create-table",
          label: "新建表",
          onClick: () => handlers.onCreateTable?.(source)
        }
      );
    }
    if (node.groupType === "virtual-views" && handlers.onCreateVirtualView) {
      groupEntries.push(
        { id: "group-virtual-view-sep", type: "separator" },
        {
          id: "group-create-virtual-view",
          label: "新建虚拟视图...",
          onClick: () => handlers.onCreateVirtualView?.(source)
        }
      );
    }
    return groupEntries;
  }

  if (node.kind === "object-folder") {
    return [
      {
        id: "object-folder-refresh",
        label: "刷新表结构",
        onClick: () => handlers.onRefreshObject(source, node.objectName)
      },
      {
        id: "object-folder-open-console",
        label: "新建查询控制台",
        onClick: () => handlers.onOpenConsole(source, `SELECT * FROM ${node.objectName} LIMIT 100;`)
      }
    ];
  }

  if (node.kind === "key") {
    return [
      {
        id: "key-copy-name",
        label: "复制键名",
        onClick: () => handlers.onCopyText(node.keyName, `键 ${node.keyName}`)
      }
    ];
  }

  if (node.kind === "index") {
    return [
      {
        id: "index-copy-name",
        label: "复制索引名",
        onClick: () => handlers.onCopyText(node.indexName, `索引 ${node.indexName}`)
      }
    ];
  }

  if (node.kind === "column") {
    return [
      {
        id: "column-copy-name",
        label: "复制字段名",
        onClick: () => handlers.onCopyText(node.columnName, `字段 ${node.columnName}`)
      },
      {
        id: "column-copy-select",
        label: "复制 SELECT 片段",
        onClick: () =>
          handlers.onCopyText(
            `SELECT ${node.columnName} FROM ${node.objectName};`,
            "SELECT 语句"
          )
      }
    ];
  }

  if (node.kind === "collation") {
    return [
      {
        id: "collation-copy-name",
        label: "复制排序规则名",
        onClick: () => handlers.onCopyText(node.collationName, `排序规则 ${node.collationName}`)
      },
      {
        id: "collation-copy-charset",
        label: "复制字符集名",
        onClick: () => handlers.onCopyText(node.charset, `字符集 ${node.charset}`)
      }
    ];
  }

  if (node.kind === "user") {
    return [
      {
        id: "user-copy-account",
        label: "复制账号名",
        onClick: () => handlers.onCopyText(node.accountLabel, `账号 ${node.accountLabel}`)
      },
      {
        id: "user-show-grants",
        label: "新建查询控制台 (SHOW GRANTS)",
        onClick: () => handlers.onOpenConsole(source, `SHOW GRANTS FOR ${node.accountLabel};`)
      }
    ];
  }

  if (node.kind === "routine") {
    const isFunc = node.routineType.toUpperCase() === "FUNCTION";
    const callSnippet = isFunc ? `SELECT ${node.routineName}();` : `CALL ${node.routineName}();`;
    return [
      ...(handlers.onViewSchemaObjectDdl
        ? [
            {
              id: "routine-view-ddl",
              label: "查看定义 DDL",
              onClick: () =>
                handlers.onViewSchemaObjectDdl?.(source, "routine", node.routineName, node.routineType)
            }
          ]
        : []),
      {
        id: "routine-open-call",
        label: "新建调用查询",
        onClick: () => handlers.onOpenConsole(source, callSnippet)
      },
      { id: "routine-copy-sep", type: "separator" },
      {
        id: "routine-copy-name",
        label: "复制名称",
        onClick: () => handlers.onCopyText(node.routineName, node.routineName)
      }
    ];
  }

  if (node.kind === "trigger") {
    return [
      ...(handlers.onViewSchemaObjectDdl
        ? [
            {
              id: "trigger-view-ddl",
              label: "查看定义 DDL",
              onClick: () => handlers.onViewSchemaObjectDdl?.(source, "trigger", node.triggerName)
            }
          ]
        : []),
      {
        id: "trigger-copy-name",
        label: "复制触发器名",
        onClick: () => handlers.onCopyText(node.triggerName, `触发器 ${node.triggerName}`)
      }
    ];
  }

  if (node.kind === "event") {
    return [
      ...(handlers.onViewSchemaObjectDdl
        ? [
            {
              id: "event-view-ddl",
              label: "查看定义 DDL",
              onClick: () => handlers.onViewSchemaObjectDdl?.(source, "event", node.eventName)
            }
          ]
        : []),
      {
        id: "event-copy-name",
        label: "复制事件名",
        onClick: () => handlers.onCopyText(node.eventName, `事件 ${node.eventName}`)
      }
    ];
  }

  if (node.kind === "virtual-view") {
    return [
      {
        id: "virtual-view-open-console",
        label: "在查询控制台打开",
        onClick: () => handlers.onOpenConsole(source, node.sqlText)
      },
      ...(handlers.onEditVirtualView
        ? [
            {
              id: "virtual-view-edit",
              label: "编辑虚拟视图...",
              onClick: () => handlers.onEditVirtualView?.(source, node)
            }
          ]
        : []),
      {
        id: "virtual-view-copy-sql",
        label: "复制 SQL",
        onClick: () => handlers.onCopyText(node.sqlText, `虚拟视图 ${node.viewName} SQL`)
      },
      ...(handlers.onDeleteVirtualView
        ? [
            { id: "virtual-view-delete-sep", type: "separator" as const },
            {
              id: "virtual-view-delete",
              label: "删除虚拟视图",
              onClick: () => handlers.onDeleteVirtualView?.(source, node)
            }
          ]
        : [])
    ];
  }

  // Object / Table 节点菜单。
  const targetObject: SalesforceObject = objectItem || {
    name: node.objectName,
    label: node.label,
    queryable: node.queryable,
    createable: false,
    updateable: false,
    deletable: false
  };

  const objectEntries: ContextMenuEntry[] = [
    {
      id: "object-open-data",
      label: "打开表数据",
      disabled: !targetObject.queryable,
      onClick: () => handlers.onOpenObjectData(source, targetObject)
    },
    {
      id: "object-open-console",
      label: "新建查询控制台",
      onClick: () =>
        handlers.onOpenConsole(
          source,
          `SELECT * FROM ${targetObject.name} LIMIT 100;`
        )
    },
    {
      id: "object-refresh",
      label: "刷新表结构",
      onClick: () => handlers.onRefreshObject(source, targetObject.name)
    },
    { id: "object-copy-sep", type: "separator" },
    {
      id: "object-copy-name",
      label: "复制表名",
      onClick: () => handlers.onCopyText(targetObject.name, `表名 ${targetObject.name}`)
    },
    {
      id: "object-copy-select",
      label: "复制 SELECT 语句",
      onClick: () =>
        handlers.onCopyText(
          `SELECT * FROM ${targetObject.name} LIMIT 100;`,
          "SELECT 语句"
        )
    }
  ];

  if (driver.capabilities.supportsDdl) {
    objectEntries.push({
      id: "object-copy-ddl",
      label: "复制建表 DDL",
      onClick: () => handlers.onCopyObjectDdl(source, targetObject.name)
    });
  }

  if (driver.capabilities.supportsTableDesigner && handlers.onEditTable && node.objectGroupType !== "views") {
    objectEntries.push({
      id: "object-edit-table",
      label: "编辑表结构",
      onClick: () => handlers.onEditTable?.(source, targetObject.name)
    });
  }

  if (handlers.onExportTableData || (driver.capabilities.supportsBackup && handlers.onBackupTable)) {
    objectEntries.push({ id: "object-export-backup-sep", type: "separator" });
    if (handlers.onExportTableData) {
      objectEntries.push({
        id: "object-export-data",
        label: "导出表数据...",
        disabled: !targetObject.queryable,
        onClick: () => handlers.onExportTableData?.(source, targetObject.name)
      });
    }
    if (driver.capabilities.supportsBackup && handlers.onBackupTable) {
      objectEntries.push({
        id: "object-backup-table",
        label: "备份表 (.sql)",
        onClick: () => handlers.onBackupTable?.(source, targetObject.name)
      });
    }
  }

  if (driver.gridAdapter.supportsOpenRecordPage) {
    objectEntries.push(
      { id: "object-cloud-sep", type: "separator" },
      {
        id: "object-cloud-list",
        label: "打开云端列表页",
        disabled: !targetObject.queryable,
        onClick: () => handlers.onOpenCloudListPage(source, targetObject)
      },
      {
        id: "object-cloud-edit",
        label: "打开对象管理页",
        onClick: () => handlers.onOpenCloudEditPage(source, targetObject)
      }
    );
  }

  return objectEntries;
}
