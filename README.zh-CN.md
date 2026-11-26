# 墨牍 Modu

[English](README.md)

墨牍是一款 macOS 本地 RSS 阅读器。把喜欢的博客和科技资讯订阅到一个地方，按自己的节奏读。

![墨牍浅色主题下的三栏阅读界面](docs/images/modu-light.jpg)

## 下载安装

**需要搭载 Apple 芯片的 Mac，系统为 macOS 12 或更高版本。**

从 [最新正式版](https://github.com/Yunz93/Modu/releases/latest) 下载 DMG，将 `墨牍.app` 拖入「应用程序」。安装包尚未经过 Apple 公证。

也可以一键安装。若墨牍正在运行，先按 ⌘Q 退出，再在终端运行：

```sh
(set -o pipefail; curl -fsSL https://raw.githubusercontent.com/Yunz93/Modu/main/scripts/install-macos.sh | /bin/bash)
```

脚本会校验下载的安装包，将应用安装到「应用程序」，并保留原有阅读库。之后可在「设置 → 关于与更新」检查和安装新版。

## 特色功能

- **订阅与整理。** 支持 RSS 和 Atom，可从网站链接发现订阅源，也可导入导出带分组的 OPML。新阅读库预置 5 个科技订阅，包括潮流周刊，刷新即可获取文章。
- **查找并接着读。** 在三栏界面里切换订阅和文章，从当前列表或全库搜索正文。喜欢的文章可以收藏，下次打开会回到上次的阅读位置。专注模式为正文留出更多空间。
- **阅读技术文章。** 订阅只提供摘要时，可按需获取全文。支持代码高亮和一键复制、数学公式、图片，以及兼容的音视频内容。
- **自定义阅读外观。** 支持明暗主题和自定义主题色，界面与正文的字体和字号可分别设置。界面提供简体中文和英文。
- **阅读库保存在本机。** 离线查看已缓存的文章，可导出完整备份，带走订阅、收藏和阅读进度。

![墨牍深色主题下的文章阅读界面](docs/images/modu-dark.jpg)

## 从源码构建

需要 Node.js 22+ 与 npm。

**Web 预览** 在 `dist/client` 生成静态站点（`dist/server` 为 SPA 回退 Worker）。浏览器版使用本地演示数据，支持 OPML/文件导入，但不支持联网刷新订阅与应用内更新。

```sh
npm ci
npm run build
npm run preview
npm run test:sites
```

**Windows 桌面版** 生成 NSIS 安装包。推荐 Rust + MSVC 目标 + Visual Studio C++ 构建工具；使用 GNU 工具链也可构建：

```sh
npm ci
npm run tauri:build:windows
```

若本机只有 MinGW-w64，需显式切换到 GNU 目标（Windows 打包配置见 `src-tauri/tauri.windows.conf.json`）：

```sh
MODU_WINDOWS_TARGET=gnu npm run tauri:build:windows
```

安装包输出在 `src-tauri/target/<target>/release/bundle/nsis/`。Windows 构建不需要 macOS 的更新签名私钥；Windows 端已关闭应用内更新，「设置 → 关于与更新」提供发布页链接供手动下载。旧版 `shidu` 存储键与 `com.yunz.shidu` 迁移路径为兼容性保留。

Windows 图标由现有 PNG 通过 `node scripts/make-windows-icon.mjs` 生成。

## 开源协议

墨牍采用 [Apache License 2.0](LICENSE)。另见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [更新日志](CHANGELOG.md)。
