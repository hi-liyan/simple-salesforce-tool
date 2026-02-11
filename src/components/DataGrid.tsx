import { QueryResult } from "../types";

// 查询结果表格组件：负责记录展示、选中与删除触发。
type Props = {
  result: QueryResult;
  selectedRecordId: string;
  onSelectRecord: (recordId: string) => void;
  onDelete: (recordId: string) => Promise<void>;
};

export function DataGrid({ result, selectedRecordId, onSelectRecord, onDelete }: Props) {
  const records = result.records;
  const columns = Array.from(
    records.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        if (key !== "attributes") set.add(key);
      });
      return set;
    }, new Set<string>())
  );

  if (records.length === 0) {
    return <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-500">暂无查询结果。</div>;
  }

  return (
    <div className="mt-4">
      <div className="mb-2 text-sm text-slate-600">总记录数：{result.totalSize}</div>
      <div className="max-h-[38vh] overflow-auto rounded-md border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-100">
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">
                  {column}
                </th>
              ))}
              <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => {
              const recordId = String(record.Id || `row-${index}`);
              const selected = recordId === selectedRecordId;

              return (
                <tr
                  key={recordId}
                  className={selected ? "bg-brand-50" : "bg-white hover:bg-slate-50"}
                  onClick={() => onSelectRecord(recordId)}
                >
                  {columns.map((column) => (
                    <td key={`${recordId}-${column}`} className="border-b border-slate-100 px-3 py-2 text-slate-700">
                      {String(record[column] ?? "")}
                    </td>
                  ))}
                  <td className="border-b border-slate-100 px-3 py-2">
                    <button
                      type="button"
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDelete(recordId);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
