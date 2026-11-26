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
        onClick: () => handlers.onRefreshSource(source)
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

  if (driver.capabilities.supportsTableDesigner && handlers.onEditTable) {
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
