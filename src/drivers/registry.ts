import type { DataSourceDriver } from "./types.ts";
import { mysqlDriver } from "./mysql/index.ts";
import { salesforceDriver } from "./salesforce/index.ts";

// 前端数据源驱动注册表。
const driverRegistry = new Map<string, DataSourceDriver>();

// 注册数据源驱动。
export function registerDataSourceDriver(driver: DataSourceDriver): void {
  driverRegistry.set(driver.kind.toLowerCase(), driver);
}

// 获取数据源驱动（未知类型时回退到第一个已注册驱动，避免 UI 崩溃）。
export function getDataSourceDriver(sourceType?: string): DataSourceDriver {
  const normalized = (sourceType || "salesforce").trim().toLowerCase();
  return driverRegistry.get(normalized) || salesforceDriver;
}

// 列出全部已注册驱动。
export function listDataSourceDrivers(): DataSourceDriver[] {
  return Array.from(driverRegistry.values());
}

// 默认注册内置驱动。
registerDataSourceDriver(salesforceDriver);
registerDataSourceDriver(mysqlDriver);
