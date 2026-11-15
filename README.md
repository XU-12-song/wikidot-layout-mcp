# Wikidot Layout MCP

面向 AI 客户端的 Wikidot 版式设计 MCP 服务器。它把「读页面 → 设计 CSS → 渲染整页 → 截图 → 评估 → 调整」做成了一套可被 agent 直接调用的工具。

核心能力：

- 匿名读取公开 Wikidot 页面源码与结构
- 8 个可参数化的版式原型（FTML + CSS 数据文件）
- 真实 Wikidot 整页外壳：`#header`、`#top-bar`、`#side-bar`、`#main-content`、`#footer`
- FTML 渲染、CSS 校验、artifact 导出
- 本机 Chrome/Edge 截图，支持桌面/平板/手机视口
- 主题来源目录：主题页 URL、GitHub 仓库、normalize 技巧
- 所有工具都返回 `content` + `structuredContent`，错误结构化

---

## 1. 前置要求

- Node.js >= 20
- 本机安装 Chrome、Edge 或 Chromium（截图用，不会下载 Playwright 浏览器包）
- 可访问 `*.wikidot.com`（需要时配置 HTTP/HTTPS 代理）

## 2. 安装与构建

```bash
cd <path>
npm install
npm run typecheck
npm test
npm run build
```

构建产物：

```text
dist/index.js
```

开发模式可以直接运行：

```bash
npx tsx src/index.ts
```

生产模式：

```bash
node dist/index.js
```

服务使用 stdio 传输。stdout 只用于 MCP JSON-RPC，日志全部写 stderr。

## 3. 接入 MCP 客户端

### Claude Code

```bash
claude mcp add wikidot-layout -- node "<path>/wikidot-layout-mcp/dist/index.js"
```

### JSON 配置（Claude Desktop 或兼容客户端）

```json
{
  "mcpServers": {
    "wikidot-layout": {
      "command": "node",
      "args": ["<path>/wikidot-layout-mcp/dist/index.js"],
      "env": {
        "CHROME_PATH": "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "HTTPS_PROXY": "http://127.0.0.1:7890",
        "HTTP_PROXY": "http://127.0.0.1:7890"
      }
    }
  }
}
```

说明：

- `CHROME_PATH` 可省略。服务会自动查找 Windows 的 Chrome/Edge、macOS 的 Chrome/Edge/Chromium、Linux 的 chromium/google-chrome。
- `HTTPS_PROXY` / `HTTP_PROXY` 也可省略。检测到时会同时用于 Node 抓取与 Playwright 截图。
- 修改配置后重启客户端。
- 仓库内的 `mcp.example.json` 是同样结构的示例。

### 验证连接

在 agent 里直接要求：

> 调用 wikidot-layout 的 layout_list_presets，告诉我有哪些预设。

应返回 8 个预设。也可以要求：

> 调用 wikidot_list_theme_sources，列出主题页 URL 和仓库。

---

## 4. 核心概念

### 4.1 artifact

每次渲染都会生成一个 artifact：

```text
artifacts/<artifactId>/
  index.html       完整预览 HTML
  screenshot.png   最近一次截图
  meta.json        标题、站点、视口、诊断、截图记录
```

对应资源 URI：

```text
artifact://<artifactId>/index.html
artifact://<artifactId>/screenshot.png
artifact://<artifactId>/meta.json
```

默认保留最近 100 个，可用 `WIKIDOT_LAYOUT_ARTIFACT_KEEP` 调整。

### 4.2 shell（页面外壳）

设计 topbar / sidebar 时必须渲染真实整页结构，而不只是 `#page-content`。

`shell` 参数：

| 值 | 行为 |
| --- | --- |
| `site` | 匿名抓取 `https://<site>.wikidot.com/_template`，使用真实 header/topbar/sidebar |
| `builtin` | 使用内置沙盒站结构，离线可用 |
| `none` | 只渲染正文 |
| `auto`（默认） | 含 `lay-page` 的完整原型用 `none`，普通 FTML 用 `builtin` |

返回结果中的：

```json
{
  "shell": {
    "mode": "site",
    "source": "site",
    "warning": null
  }
}
```

真实外壳包含：

```text
#container
├─ #header        h1 / h2 / #search-top-box / #top-bar / #login-status
├─ #content-wrap
│   ├─ #side-bar  .side-block / .heading / .menu-item / .collapsible-block
│   └─ #main-content
│       ├─ #page-title
│       ├─ #page-content
│       └─ #page-options-container
├─ #footer
└─ #license-area
```

`_template` 缓存 30 天；`forceRefreshShell: true` 可强制刷新。runtime 初始化在 `#container`，sidebar 中的折叠块也能交互。

### 4.3 预设、token 与区域

内置 8 个预设：

```text
article-single
docs-sidebar
docs-toc
card-grid
scp-article
component-gallery
longform-reading
blank
```

每个预设由数据文件组成：

```text
src/presets/<id>/
  preset.json   manifest：区域、token、响应式、文件索引
  page.ftml     页面源码
  layout.css    版式 CSS
  notes.md      设计说明
```

token 使用 `{{name}}` 占位，例如 `contentWidth`、`sidebarWidth`、`accent`、`paper`。区域用 `lay-region lay-region-<name>` 标记，`content` 不可移除。

## 5. 工具参考

### 5.1 `layout_list_presets`

列出全部预设。

输入：无。

输出要点：

```json
{
  "ok": true,
  "total": 8,
  "presets": [
    {
      "id": "docs-sidebar",
      "name": "左导航文档版式",
      "regions": ["topbar", "sidebar", "content", "footer"],
      "tokens": { "contentWidth": "780px" },
      "responsive": { "desktop": "two-column", "mobile": "stacked" }
    }
  ]
}
```

### 5.2 `layout_get_preset`

读取完整预设。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 预设 id |
| `tokens` | object? | 覆盖 token |

输出包含 `files`（原始文件）与 `resolvedFiles`（token 替换、本地 `@import` 内联后的文件）。

### 5.3 `layout_scaffold`

基于预设生成新页面。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `presetId` | string | 预设 id |
| `tokens` | object? | 覆盖 token |
| `regions` | string[]? | 保留的区域；`content` 不可移除 |
| `title` | string? | 覆盖 `{{pageTitle}}` |
| `addRegions` | array? | `{ name, ftml, position: "start"\|"end" }` |
| `outDir` | string? | 写入目录，必须在允许根目录内 |
| `force` | boolean? | 覆盖已存在文件 |

示例：

```json
{
  "presetId": "docs-sidebar",
  "title": "项目文档",
  "tokens": { "contentWidth": "860px", "accent": "#1f4e6b" },
  "regions": ["topbar", "sidebar", "content", "footer"]
}
```

### 5.4 `layout_validate`

校验 FTML 与 CSS。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ftml` | string | 要校验的源码 |
| `css` | string? | 自定义 CSS |
| `site` | string? | 渲染上下文站点 |

返回：

```json
{
  "ok": true,
  "valid": false,
  "errors": [{ "severity": "error", "code": "unclosed-block", "message": "...", "line": 12 }],
  "warnings": [],
  "diagnostics": []
}
```

### 5.5 `layout_render_preview`

FTML → 完整 HTML。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `ftml` | string | 页面源码 |
| `css` | string? | 自定义 CSS，最后加载 |
| `site` | string? | include 解析、链接上下文、`_template` 抓取 |
| `page` | string? | 页面名/标题上下文 |
| `viewport` | preset 或 `{width,height}`? | 记录到 artifact |
| `shell` | `site`/`builtin`/`none`/`auto`? | 页面外壳 |
| `forceRefreshShell` | boolean? | 强制刷新 `_template` 缓存 |

输出要点：

```json
{
  "ok": true,
  "artifactId": "art-...",
  "htmlPath": "C:/.../artifacts/art-.../index.html",
  "resourceUri": "artifact://art-.../index.html",
  "title": "Lab",
  "diagnostics": [],
  "warnings": [],
  "cssSources": ["wikidot.css", "sigma.css", "custom"],
  "includes": [],
  "viewport": { "width": 1440, "height": 900 },
  "shell": { "mode": "site", "source": "site", "warning": null }
}
```

### 5.6 `layout_screenshot`

对 artifact、HTML 或公开 URL 截图。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `artifactId` | string? | 已有 artifact |
| `html` | string? | 直接提供完整 HTML |
| `url` | string? | 公开 http/https URL |
| `viewport` | preset 或对象? | `desktop` / `tablet` / `mobile` / `{width,height}` |
| `fullPage` | boolean? | 整页截图 |
| `selector` | string? | 只截匹配元素 |
| `waitForSelector` | string? | 等待元素可见 |
| `waitMs` | number? | 额外等待，最大 60000 |
| `colorScheme` | `light`/`dark`/`no-preference`? | 色彩模式 |
| `reducedMotion` | `reduce`/`no-preference`? | 动效 |
| `clip` | `{x,y,width,height}`? | 裁剪区域，不能与 `selector` 同用 |

`artifactId`、`html`、`url` 只能提供一个。

输出：

```json
{
  "ok": true,
  "artifactId": "art-...",
  "screenshotPath": "C:/.../screenshot.png",
  "resourceUri": "artifact://art-.../screenshot.png",
  "width": 1440,
  "height": 1556,
  "fullPage": true,
  "viewport": { "width": 1440, "height": 900 },
  "consoleErrors": [],
  "pageErrors": [],
  "durationMs": 1234
}
```

### 5.7 `layout_preview_and_screenshot`

渲染 + 截图一步完成。参数是 `layout_render_preview` 与 `layout_screenshot` 的交集：

```json
{
  "ftml": "...",
  "css": "...",
  "site": "scpsandboxcn",
  "page": "Lab",
  "shell": "site",
  "viewport": "desktop",
  "fullPage": true
}
```

这是「生成 → 截图 → 评估 → 调整」闭环里最常用的工具。

### 5.8 `layout_export`

导出预设或 artifact。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `presetId` | string? | 与 `artifactId` 二选一 |
| `artifactId` | string? | 与 `presetId` 二选一 |
| `files` | string[]? | 只导出指定文件 |
| `outDir` | string | 目标目录 |
| `tokens` | object? | 导出预设时覆盖 token |
| `force` | boolean? | 覆盖已有文件 |

只允许写入 `WIKIDOT_LAYOUT_ALLOWED_ROOTS` 内的路径。

### 5.9 `wikidot_get_page_source`

匿名获取公开页面源码。工具参数不接受任何凭据。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `site` | string | 站点子域名，如 `scp-wiki-cn` |
| `page` | string | 页面名，如 `scp-173`、`theme:bedrock` |
| `raw` | boolean? | 只返回原始源码，不做规范化 |
| `forceRefresh` | boolean? | 跳过 5 分钟缓存 |

输出：

```json
{
  "ok": true,
  "site": "scp-wiki",
  "page": "scp-173",
  "pageId": 1956234,
  "title": "SCP-173",
  "source": "...",
  "normalizedSource": "...",
  "contentHash": "sha256:...",
  "fetchedAt": "2026-11-15T...",
  "cached": false,
  "privateAccess": false,
  "warning": null,
  "normalization": { "changed": false, "changes": 0, "diagnostics": [] }
}
```

### 5.10 `wikidot_analyze_page_structure`

源码层 + 渲染层结构分析。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `site` | string | 站点子域名 |
| `page` | string | 页面名 |
| `forceRefresh` | boolean? | 跳过源码缓存 |
| `includeDom` | boolean? | 是否额外抓取公开 HTML（默认 true） |

输出包括：

- `pageType`：article / theme / nav / component / system / fragment
- `headings`
- `blocks`：`div`、`div_`、`span`、`span_`、`collapsible`、`tabview`、`tab`、`code`、`html`、`embed`
- `includes`：同站/跨站、参数、行号
- `modules`
- `dom`：`#page-title`、`#page-content`、评分、面包屑、TOC、顶栏、侧栏、内容宽度
- `layoutHints`
- `warnings`

### 5.11 `wikidot_list_theme_sources`

返回主题目录（也可读取 Resource `wikidot://themes/catalog`）：

- Bedrock：页面 URL
- Basalt：页面 URL + `Basalt-Team/Basalt`
- Black Highlighter：页面 URL + `Nu-SCPTheme/Black-Highlighter`
- 本地 `wikidot.css`、`sigma.css` 的来源与角色
- normalize 技巧及其注意事项
- agent 使用指引（页面用 MCP 读，仓库不确定就 clone 后检索）

---

## 6. 典型工作流

### 6.1 用现成预设快速出图

给 agent 的指令：

> 用 wikidot-layout 列出预设，选 docs-sidebar。把 contentWidth 改成 860px、accent 改成 #1f4e6b，校验后在 1440×900 和 390×844 截图。

Agent 会依次调用：

```text
layout_list_presets
layout_get_preset
layout_scaffold
layout_validate
layout_preview_and_screenshot
```

产物：

```text
artifacts/<artifactId>/index.html
artifacts/<artifactId>/screenshot.png
```

### 6.2 设计真实站点 topbar / sidebar

这是版式设计的核心场景。必须使用 `shell: "site"` 或 `shell: "builtin"`，让 CSS 命中真实 DOM。

给 agent 的指令：

> 以 scpsandboxcn 的 sigma 主题为底，使用真实站点外壳（shell=site）。只修改 #top-bar 的背景和 #side-bar .side-block 的边框，不要动正文排版。渲染后截图桌面和手机视口。

工具调用示例：

```json
{
  "name": "layout_preview_and_screenshot",
  "arguments": {
    "ftml": "[[div class=\"sigma-note\"]]...[[/div]]",
    "css": "#top-bar { ... }\n#side-bar .side-block { ... }",
    "site": "scpsandboxcn",
    "page": "Lab",
    "shell": "site",
    "viewport": "desktop",
    "fullPage": true
  }
}
```

可直接运行的演示：

```bash
node scripts/demo-sigma.mjs
```

对比图：

```text
examples/sigma-demo/baseline-desktop.png
examples/sigma-demo/modified-desktop.png
examples/sigma-demo/baseline-mobile.png
examples/sigma-demo/modified-mobile.png
```

### 6.3 分析现有页面并复用版式

> 分析 scp-wiki:scp-173 的页面结构，告诉我它的区域、块嵌套、include 和 module，并推荐一个可复用的预设。

Agent 会调用：

```text
wikidot_analyze_page_structure
wikidot_get_page_source（需要完整源码时）
layout_list_presets
```

### 6.4 主题与仓库

> 查 theme:basalt 的实际实现。如果不确定选择器，clone Basalt 仓库后检索 CSS。

Agent 会调用：

```text
wikidot_list_theme_sources
wikidot_get_page_source({ site: "scp-wiki-cn", page: "theme:basalt" })
```

MCP 不代理 GitHub 抓取；工具返回的 guidance 明确要求 agent 在不确定时 clone 仓库自行检索。

### 6.5 根据截图迭代

> 读取 artifact art-xxxx 的截图，找出移动端最影响可读性的三个问题，只改 CSS，然后重新截图 390×844。

Agent 会：

```text
读取 artifact://art-xxxx/screenshot.png
修改 CSS
layout_preview_and_screenshot
对比修改前后
```

---

## 7. Resources 与 Prompts

Resources：

- `wikidot://syntax/overview`
- `wikidot://syntax/layout-blocks`
- `wikidot://structure/page-anatomy`
- `wikidot://structure/themes`
- `wikidot://themes/catalog`（JSON）
- `preset://list`
- `preset://<id>`
- `artifact://<artifactId>/index.html`
- `artifact://<artifactId>/screenshot.png`
- `artifact://<artifactId>/meta.json`

Prompts：

- `design-layout`
- `analyze-page-layout`
- `iterate-from-screenshot`

---

## 8. 源码获取、缓存与限流

- 主路径：`@ukwhatn/wikidot` 的 `Client.createAnonymous()`。
- 回退：直接调用 Wikidot AMC。
  1. GET 页面 HTML，提取 `pageId` 与 `wikidot_token7`；
  2. POST `ajax-module-connector.php`，`moduleName=viewsource/ViewSourceModule`；
  3. cheerio 解析 `div.page-source`；
  4. `wrong_token7` 自动刷新并重试一次。
- 缓存：进程内 LRU + 磁盘 JSON，TTL 5 分钟。
- 同站点并发 ≤ 2，请求超时 15 秒。
- 代理：自动检测 `HTTP(S)_PROXY`，也可用 `WIKIDOT_LAYOUT_PROXY` 显式指定。
- 规范化：`dirtToIdeal()` 修补未闭合行内标签；保留 `source` 与 `normalizedSource`。
- 内容哈希：`sha256:...`。

### 私有页面

工具参数永远不接收 `username` / `password` / `token` / `cookie`。私有页面只在服务端配置时启用：

```bash
WIKIDOT_LAYOUT_ALLOW_PRIVATE=1
WIKIDOT_USERNAME=...
WIKIDOT_PASSWORD=...
# 或使用预配置 Cookie 文件（Netscape 或 JSON）
WIKIDOT_COOKIE_FILE=/path/to/cookies.txt
```

无权限返回 `SOURCE_FORBIDDEN`，不做权限绕过。

---

## 9. 渲染顺序

生成的完整 HTML 包含：

1. `<meta charset="utf-8">` 与 viewport
2. `wikidot.css` + `sigma.css`（本地内联）
3. `[[module CSS]]` 收集的样式
4. 调用方传入的 CSS
5. 内联 `@wdprlib/runtime`，初始化 tabview / collapsible / TOC / 脚注

CSS 顺序决定覆盖关系：自定义 CSS 最后加载。

include 解析顺序：

1. `WIKIDOT_LAYOUT_INCLUDE_DIRS` 中的本地 `.ftml`
2. 匿名远程页面

失败会产生结构化诊断，不会静默忽略。

---

## 10. 截图

- 临时 HTTP 服务绑定 `127.0.0.1` 随机端口，只服务 artifact 根目录。
- 不使用 `file://`。
- 视口：`desktop` 1440×900、`tablet` 1024×768、`mobile` 390×844，`deviceScaleFactor: 1`。
- 支持 `fullPage`、`selector`、`clip`、`waitForSelector`、`waitMs`、`colorScheme`。
- 返回本地绝对路径与 `artifact://` URI，不返回 base64。
- 收集 `console` error 与 `pageerror`。
- 远程 URL 只允许 http/https，拒绝 localhost、`.local`、私网与保留地址。

---

## 11. 安全

- 截图 URL：SSRF 防护，默认拒绝本机/内网。
- `layout_export` / `scaffold.outDir`：只允许 `WIKIDOT_LAYOUT_ALLOWED_ROOTS` 内的路径，拒绝 `..`、绝对路径越界与符号链接逃逸。
- 日志只写 stderr，并遮蔽 Cookie、token、Authorization、password。
- artifact 默认保留最近 100 个。
- 私有页面凭证不进入工具 schema，也不会出现在输出中。

---

## 12. 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CHROME_PATH` | 自动查找 | 浏览器可执行文件 |
| `WIKIDOT_LAYOUT_DEBUG` | `0` | 输出 debug 日志 |
| `WIKIDOT_LAYOUT_DEFAULT_SITE` | `scp-wiki-cn` | 默认站点 |
| `WIKIDOT_LAYOUT_SOURCE_TTL_MS` | `300000` | 源码缓存 TTL |
| `WIKIDOT_LAYOUT_FETCH_TIMEOUT_MS` | `15000` | 抓取超时 |
| `WIKIDOT_LAYOUT_CONCURRENCY` | `2` | 同站点并发 |
| `WIKIDOT_LAYOUT_DISABLE_CACHE` | `0` | 设为 `1` 禁用源码缓存 |
| `WIKIDOT_LAYOUT_LAYOUT_TTL_MS` | `2592000000` | `_template` 缓存 TTL（30 天） |
| `WIKIDOT_LAYOUT_LAYOUT_CACHE_DIR` | `~/.wikidot-layout-mcp/cache/layout` | `_template` 缓存目录 |
| `WIKIDOT_LAYOUT_ARTIFACT_DIR` | `./artifacts` | 产物目录 |
| `WIKIDOT_LAYOUT_ARTIFACT_KEEP` | `100` | 保留 artifact 数量 |
| `WIKIDOT_LAYOUT_ALLOWED_ROOTS` | 项目根 + cwd | 允许导出的根目录（`path.delimiter` 分隔） |
| `WIKIDOT_LAYOUT_INCLUDE_DIRS` | `./includes` | 本地 include 目录 |
| `WIKIDOT_LAYOUT_ALLOW_REMOTE_URL` | `1` | 设为 `0` 禁止远程 URL 截图 |
| `WIKIDOT_LAYOUT_PROXY` | — | 显式代理地址 |
| `WIKIDOT_LAYOUT_USE_ENV_PROXY` | `1` | 设为 `0` 忽略 `HTTP(S)_PROXY` |
| `WIKIDOT_LAYOUT_DISABLE_PROXY` | `0` | 设为 `1` 完全禁用代理 |
| `WIKIDOT_LAYOUT_ALLOW_PRIVATE` | `0` | 启用服务端私有凭证 |
| `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD` | — | 私有访问凭证 |
| `WIKIDOT_COOKIE_FILE` | — | 私有访问 Cookie 文件 |

---

## 13. 测试

```bash
npm test
```

真实网络集成测试默认跳过：

```bash
LIVE=1 node --import tsx --test tests/live.test.ts
```

已用 `scp-wiki:scp-173` 验证匿名源码、contentHash、块/include/module 与 DOM 分析。

覆盖范围：

- 工具 schema 不含凭据字段
- MCP in-memory 调用与 Resources
- 8 个预设渲染、`div_` 配对
- 本地 include、AMC 回退与错误码
- 整页外壳 `#header` / `#top-bar` / `#side-bar`
- 路径穿越、SSRF、静态服务
- 截图尺寸、fullPage、selector、console 错误

---

## 14. 排错

### `BROWSER_NOT_FOUND`

设置：

```bash
CHROME_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe
```

### `SCREENSHOT_TIMEOUT`

- 页面可能等待远程字体/图片。检查网络或代理。
- 减少 `waitMs`，或先只截 `selector`。
- 确认 `HTTP(S)_PROXY` 对浏览器也有效。

### `NETWORK_ERROR`

- 检查能否直接访问 Wikidot。
- 配置 `HTTP_PROXY` / `HTTPS_PROXY` 或 `WIKIDOT_LAYOUT_PROXY`。
- 用 `LIVE=1` 跑一次集成测试。

### `SOURCE_FORBIDDEN`

该页面不允许匿名读取。私有页面需要服务端凭证；不要尝试绕过权限。

### `PATH_NOT_ALLOWED`

`outDir` 必须在 `WIKIDOT_LAYOUT_ALLOWED_ROOTS` 内，且不能通过 `..` 或符号链接逃逸。

### 截图有样式但布局不对

- 确认 `shell` 不是 `none`。
- 确认 CSS 针对的是真实 DOM：`#header`、`#top-bar`、`#side-bar`、`#main-content`、`#page-content`。
- 用 `layout_render_preview` 返回的 `htmlPath` 打开完整 HTML 检查。

### 接入后 agent 看不到工具

- 确认客户端配置的是 `dist/index.js` 的绝对路径。
- 重新执行 `npm run build`。
- 重启 MCP 客户端。
- 查看客户端日志中的 stderr。

---

## 15. 目录结构

```text
src/
  index.ts             MCP stdio 入口
  server.ts            工具注册
  tool-schemas.ts      zod schema
  wikidot/             匿名客户端、AMC、源码缓存、结构分析
  compat/              dirtToIdeal
  presets/             8 个版式原型 + 共享基座 CSS
  render/              FTML 渲染、整页外壳、校验
  screenshot/          浏览器、静态服务、截图
  security/            路径与 SSRF
  net/                 代理
  themes/              主题来源目录
  resources.ts         MCP Resources
  prompts.ts           MCP Prompts
tests/                 node:test + undici MockAgent + fixtures
docs/                  预设与页面结构文档
examples/sigma-demo/   sigma 主题最小修改演示
scripts/demo-sigma.mjs 演示脚本
```

更多文档：

- `docs/presets.md`
- `docs/page-structure.md`
