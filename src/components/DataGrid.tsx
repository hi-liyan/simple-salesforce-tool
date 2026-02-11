import { QueryResult } from "../types";

type Props = {
  result: QueryResult;
  visibleColumns: string[];
  selectedRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
};

// 查询结果表格：展示全字段列，支持勾选与全选。
export function DataGrid({ result, visibleColumns, selectedRecordIds, onToggleRecord, onToggleAll }: Props) {
  const records = result.records;
  const rawColumns = Array.from(
    records.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        if (key !== "attributes") set.add(key);
      });
      return set;
    }, new Set<string>())
  );
  // 保证 Id 字段固定在第一列，其他列保持原有顺序。
  const columns = rawColumns.includes("Id")
    ? ["Id", ...rawColumns.filter((column) => column !== "Id")]
    : rawColumns;
  const displayColumns = visibleColumns.length > 0
    ? (visibleColumns.includes("Id")
      ? ["Id", ...visibleColumns.filter((column) => column !== "Id")]
      : visibleColumns)
    : columns;

  const selectableIds = records
    .map((item, index) => String(item.Id || `row-${index}`))
    .filter((id) => !id.startsWith("row-"));
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedRecordIds.includes(id));

  if (records.length === 0) {
    return <div className="p-4 text-xs text-sky-600">暂无查询结果。</div>;
  }

  return (
    <div className="h-full p-2">
      <div className="mb-2 text-xs text-sky-700">Rows: {result.totalSize}</div>

      <div className="max-h-[100%] overflow-auto border border-sky-200 bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-sky-50">
            <tr>
              <th className="border-b border-sky-200 px-2 py-1 text-left text-sky-800">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={(event) => onToggleAll(event.target.checked, selectableIds)}
                />
              </th>
              <th className="border-b border-sky-200 px-2 py-1 text-left text-sky-800">#</th>
              {displayColumns.map((column) => (
                <th key={column} className="border-b border-sky-200 px-2 py-1 text-left text-sky-800">
                  {column}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {records.map((record, index) => {
              const recordId = String(record.Id || `row-${index}`);
              const checked = selectedRecordIds.includes(recordId);

              return (
                <tr key={recordId} className={checked ? "bg-sky-100" : "hover:bg-sky-50"}>
                  <td className="border-b border-sky-100 px-2 py-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={recordId.startsWith("row-")}
                      onChange={(event) => onToggleRecord(recordId, event.target.checked)}
                    />
                  </td>
                  <td className="border-b border-sky-100 px-2 py-1 text-sky-500">{index + 1}</td>
                  {displayColumns.map((column) => (
                    <td key={`${recordId}-${column}`} className="border-b border-sky-100 px-2 py-1 text-sky-900">
                      {String(record[column] ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
