import { type LucideIcon, ArrowLeftRight, Braces, ChevronRight, Languages, QrCode, Wrench } from "lucide-react";
import { useAppStore, type ToolsPanelActiveToolId } from "../../../store/useAppStore";
import { JsonFormatterTool } from "./components/JsonFormatterTool";
import { TextDiffTool } from "./components/TextDiffTool";
import { JsonDiffTool } from "./components/JsonDiffTool";
import { QrCodeTool } from "./components/QrCodeTool";
import { UnicodeConverterTool } from "./components/UnicodeConverterTool";

// 工具标识：当前面板已实现的工具集合。
type ToolItemId = Exclude<ToolsPanelActiveToolId, null>;

// 工具入口定义：驱动平铺入口卡片渲染。
type ToolDefinition = {
  // 工具唯一标识。
  id: ToolItemId;
  // 工具名称。
  title: string;
  // 工具说明。
  description: string;
  // 工具状态标签。
  statusText: string;
  // 工具图标。
  icon: LucideIcon;
};

// 当前可用工具列表：后续新增工具时可继续扩展。
const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: "json-formatter",
    title: "JSON 格式化",
    description: "提供多 Tab JSON 格式化、树形查看、节点折叠、全部展开、全部收起与复制结果能力。",
    statusText: "已上线",
    icon: Braces
  },
  {
    id: "text-diff",
    title: "Text Diff",
    description: "提供左右双栏文本差异对比，支持多 Tab 持续编辑、拖拽排序、重命名与懒恢复。",
    statusText: "已上线",
    icon: ArrowLeftRight
  },
  {
    id: "json-diff",
    title: "JSON Diff",
    description: "提供 JSON 语义对比与双栏差异高亮，支持多 Tab、拖拽排序、重命名与懒恢复。",
    statusText: "已上线",
    icon: Braces
  },
  {
    id: "qr-code",
    title: "二维码生成",
    description: "提供文本转二维码、参数配置、预览复制下载，以及带持久化能力的历史记录管理。",
    statusText: "已上线",
    icon: QrCode
  },
  {
    id: "unicode-converter",
    title: "Unicode 编码转换",
    description: "提供 Unicode/中文/ASCII 双向转换，支持 `\\uXXXX` 与 HTML 实体双格式、结果持久化与历史记录管理。",
    statusText: "已上线",
    icon: Languages
  }
];

// 工具面板：入口页平铺展示工具卡片，点击后进入对应工具页。
export function ToolsPanel() {
  // 当前激活工具：切换到其他 panel 再返回时，仍保留本次运行期最近一次工具页。
  const activeToolId = useAppStore((state) => state.toolsPanelActiveToolId);
  // 更新当前激活工具：返回入口页时清空，进入工具页时写入目标标识。
  const setToolsPanelActiveToolId = useAppStore((state) => state.setToolsPanelActiveToolId);

  if (activeToolId === "json-formatter") {
    return <JsonFormatterTool onBack={() => setToolsPanelActiveToolId(null)} />;
  }

  if (activeToolId === "text-diff") {
    return <TextDiffTool onBack={() => setToolsPanelActiveToolId(null)} />;
  }

  if (activeToolId === "json-diff") {
    return <JsonDiffTool onBack={() => setToolsPanelActiveToolId(null)} />;
  }

  if (activeToolId === "qr-code") {
    return <QrCodeTool onBack={() => setToolsPanelActiveToolId(null)} />;
  }

  if (activeToolId === "unicode-converter") {
    return <UnicodeConverterTool onBack={() => setToolsPanelActiveToolId(null)} />;
  }

  return (
    // 工具入口页：以卡片网格平铺展示全部工具。
    <div className="flex h-full w-full flex-col overflow-hidden bg-base-200/45">
      {/* 页面头部：概述工具面板定位。 */}
      <div className="border-b border-base-300 bg-base-100 px-6 py-5">
        <div className="flex items-center gap-3">
          {/* 头部图标。 */}
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wrench size={20} />
          </div>
          <div>
            {/* 页面标题。 */}
            <h2 className="text-[18px] font-semibold text-neutral">Tools Panel</h2>
            {/* 页面说明。 */}
            <p className="mt-1 text-[12px] text-neutral/65">这里集中放置常用小工具入口，点击卡片即可进入对应工具页面。</p>
          </div>
        </div>
      </div>
      {/* 工具平铺区域。 */}
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {TOOL_DEFINITIONS.map((tool) => (
            <button
              key={tool.id}
              // 工具入口卡片：点击后进入具体工具页。
              type="button"
              className="group flex min-h-[184px] flex-col rounded-3xl border border-base-300 bg-base-100 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              onClick={() => setToolsPanelActiveToolId(tool.id)}
            >
              {/* 卡片头部：图标与状态徽标。 */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition group-hover:bg-primary/15">
                  <tool.icon size={20} />
                </div>
                <span className="rounded-full bg-success/10 px-3 py-1 text-[11px] font-medium text-success">{tool.statusText}</span>
              </div>
              {/* 卡片正文：工具名称与简介。 */}
              <div className="mt-6 flex-1">
                <h3 className="text-[16px] font-semibold text-neutral">{tool.title}</h3>
                <p className="mt-3 text-[13px] leading-6 text-neutral/65">{tool.description}</p>
              </div>
              {/* 卡片底部：强调可进入性。 */}
              <div className="mt-4 flex items-center justify-between border-t border-base-300 pt-4 text-[12px] text-primary">
                <span>进入工具</span>
                <ChevronRight size={16} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
