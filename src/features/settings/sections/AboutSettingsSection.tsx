import { useEffect, useState } from "react";
import { ExternalLink, Info, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../../../api";
import { checkGithubLatestVersion } from "../../../utils/versionUpdate";

const FEEDBACK_ISSUE_URL = "https://github.com/hi-liyan/simple-salesforce-tool/issues/new";

// 关于与版本更新分区。
export function AboutSettingsSection() {
  const [appVersion, setAppVersion] = useState("-");
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");
  const [releaseUrl, setReleaseUrl] = useState("");

  useEffect(() => {
    void getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion("-"));
  }, []);

  async function handleCheckUpdate() {
    setChecking(true);
    setUpdateMsg("");
    setReleaseUrl("");
    try {
      const result = await checkGithubLatestVersion();
      if (!result) {
        setUpdateMsg("未能获取最新版本信息，请检查网络或稍后再试。");
        return;
      }
      if (result.hasUpdate) {
        setUpdateMsg(`发现新版本：v${result.latestVersion}（当前 v${result.currentVersion}）`);
        setReleaseUrl(result.releasePageUrl);
      } else {
        setUpdateMsg(`当前已是最新版本（v${result.currentVersion}）。`);
      }
    } catch (err) {
      setUpdateMsg(`检查更新失败：${String(err)}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-neutral">
          <Info size={16} className="text-primary" />
          <span>关于 DataStudio</span>
        </h3>
        <p className="mt-0.5 text-[12px] text-neutral/65">多数据源桌面工作台（支持 Salesforce / MySQL / 集成终端与插件系统）。</p>
      </div>

      <div className="space-y-3 rounded-xl border border-base-300/80 bg-base-200/20 p-4 text-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-neutral/75">当前应用版本</span>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono font-semibold text-primary">v{appVersion}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1.5 rounded-lg"
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
          >
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
            <span>{checking ? "检查中..." : "检查更新"}</span>
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm gap-1.5 rounded-lg"
            onClick={() => void api.openExternalUrl(FEEDBACK_ISSUE_URL)}
          >
            <ExternalLink size={13} />
            <span>提交问题与反馈</span>
          </button>
        </div>

        {updateMsg && (
          <div className="rounded-lg border border-base-300 bg-base-100 p-2.5 text-[12px]">
            <p className="text-neutral">{updateMsg}</p>
            {releaseUrl && (
              <button
                type="button"
                className="mt-1.5 inline-flex items-center gap-1 text-primary hover:underline"
                onClick={() => void api.openExternalUrl(releaseUrl)}
              >
                <ExternalLink size={12} />
                <span>前往 Release 页面下载</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
