# 独立插件开发工作区（`plugins/`）

本目录专门用于按 `.sstplugin` 规范开发独立可安装插件，每个子目录对应一个独立插件：

- `plugins/json-formatter/` (`com.sst.json-formatter`)
- `plugins/json-diff/` (`com.sst.json-diff`)
- `plugins/text-diff/` (`com.sst.text-diff`)
- `plugins/qr-code/` (`com.sst.qr-code`)
- `plugins/unicode-converter/` (`com.sst.unicode-converter`)
- `plugins/command-library/` (`com.sst.command-library`)

## 一键打包全部插件为 `.sstplugin`

```bash
node plugins/pack-all.mjs
```

打包产物默认输出到 `plugins/out/`（`.sstplugin` 文件），可在主程序右上角 **插件中心 -> 安装 .sstplugin** 直接选择安装。
