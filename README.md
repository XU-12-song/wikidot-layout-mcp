# Wikidot Layout MCP

一个面向 AI 客户端的 Wikidot 版式设计 MCP 服务器：匿名读取公开页面源码、分析页面结构、基于 8 个内置原型生成 FTML + CSS、渲染完整 HTML，并用本机 Chrome/Edge 截图，形成「生成 → 截图 → 评估 → 调整」闭环。

## 快速开始

```bash
npm install
npm run typecheck
npm test

# 开发运行（stdio）
npx tsx src/index.ts

# 构建
npm run build
node dist/index.js
```

MCP 客户端配置：

```json
{
  "mcpServers": {
    "wikidot-layout": {
      "command": "node",
      "args": ["C:/Users/Administrator/wikidotLayoutMCP/dist/index.js"],
      "env": {
        "CHROME_PATH": "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
      }
    }
  }
}
```

`CHROME_PATH` 可省略；服务会自动查找 Windows 的 Chrome/Edge、macOS 的 Chrome/Edge/Chromium、Linux 的 chromium/google-chrome。

## 工具

| 工具 | 作用 |
| --- | --- |
| `layout_list_presets` | 列出 8 个内置版式（区域、token、响应式） |
| `layout_get_preset` | 读取完整 FTML/CSS/notes 与 token 解析结果 |
| `layout_scaffold` | 覆盖 token、裁剪/追加区域，生成新页面文件 |
| `layout_validate` | 校验 FTML 块闭合、渲染诊断、CSS 语法与 @import 顺序 |
| `layout_export` | 导出预设或 artifact 到允许目录 |
| `layout_render_preview` | FTML → 完整 HTML（主题 CSS + module CSS + runtime） |
| `layout_screenshot` | 对 artifact / HTML / 公开 URL 截图 |
| `layout_preview_and_screenshot` | 一步完成渲染 + 截图 |
| `wikidot_get_page_source` | 匿名获取公开页面源码（不接受任何凭据） |
| `wikidot_analyze_page_structure` | 源码层 + 渲染层页面结构分析 |
| `wikidot_list_theme_sources` | 主题页 URL、GitHub 仓库、本地 CSS 与 normalize 技巧 |

所有工具返回 `content` 与 `structuredContent`。错误统一为：

```json
{
  "ok": false,
  "error": {
    "code": "SOURCE_FORBIDDEN",
    "message": "没有读取权限",
    "hint": "不要尝试绕过权限；私有页面需服务端预配置凭证。",
    "retryable": false
  }
}
```

错误码：`INVALID_INPUT`、`PAGE_NOT_FOUND`、`SOURCE_FORBIDDEN`、`SOURCE_PARSE_FAILED`、`NETWORK_ERROR`、`RENDER_FAILED`、`SCREENSHOT_TIMEOUT`、`BROWSER_NOT_FOUND`、`PATH_NOT_ALLOWED`、`PRESET_NOT_FOUND`、`EXPORT_FAILED`、`INTERNAL_ERROR`。

## 源码获取

- 默认使用 `@ukwhatn/wikidot` 的 `Client.createAnonymous()`。
- 客户端失败时回退直接调用 Wikidot AMC：
  1. GET 页面 HTML，提取 `pageId` 和 `wikidot_token7`；
  2. POST `ajax-module-connector.php`，`moduleName=viewsource/ViewSourceModule`；
  3. cheerio 解析 `div.page-source`；
  4. `wrong_token7` 自动刷新并重试一次。
- 缓存：进程内 LRU + 磁盘 JSON，TTL 5 分钟；同站点并发 ≤ 2；请求超时 15 秒。
- 代理：Node 内置 fetch 默认不读取 `HTTPS_PROXY`。服务启动时会自动检测 `HTTP(S)_PROXY` 并启用 `EnvHttpProxyAgent`（遵守 `NO_PROXY`）；也可用 `WIKIDOT_LAYOUT_PROXY` 显式指定。Playwright 截图使用系统代理。
- 源码进入渲染前用 `dirtToIdeal()` 修复未闭合行内标签，保留原始与规范化两个字段。
- `contentHash = sha256:...`，用于缓存键和变更检测。

### 私有页面

工具参数**永远不接收** `username` / `password` / `token` / `cookie`。私有页面只在服务端显式配置时启用：

```bash
WIKIDOT_LAYOUT_ALLOW_PRIVATE=1
WIKIDOT_USERNAME=...
WIKIDOT_PASSWORD=...
# 或使用预配置 Cookie 文件（Netscape 或 JSON）
WIKIDOT_COOKIE_FILE=/path/to/cookies.txt
```

无权访问返回 `SOURCE_FORBIDDEN`，不做任何权限绕过。

## 主题来源

`wikidot_list_theme_sources` / `wikidot://themes/catalog` 暴露：

- Bedrock：`https://scp-wiki-cn.wikidot.com/theme:bedrock`
- Basalt：`https://scp-wiki-cn.wikidot.com/theme:basalt`，仓库 `Basalt-Team/Basalt`
- Black Highlighter：`https://scp-wiki-cn.wikidot.com/theme:black-highlighter-theme`，仓库 `Nu-SCPTheme/Black-Highlighter`
- 本地 `wikidot.css`（默认）与 `sigma.css`（SCP-CN 站点主题，始终加载）
- normalize 技巧：`@import url("https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css");`

主题页源码可直接用 `wikidot_get_page_source` / `wikidot_analyze_page_structure` 读取。MCP 不代抓 GitHub；不确定实现时按仓库地址 clone 后检索 CSS 选择器与变量（工具返回的 guidance 中已明确告知 agent）。

## 整页外壳（版式设计的关键）

版式不是只作用于正文。渲染时会套真实的 Wikidot 整页结构：

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

`shell` 参数：

- `site`：匿名抓取 `https://<site>.wikidot.com/_template`，真实 header/topbar/sidebar；
- `builtin`：内置沙盒站结构，离线可用；
- `none`：只渲染正文；
- `auto`（默认）：含 `lay-page` 的完整原型用 `none`，普通 FTML 用 `builtin`。

`layout_render_preview` / `layout_preview_and_screenshot` 返回 `shell: { mode, source, warning }`。`_template` 缓存 30 天，可用 `forceRefreshShell: true` 强制刷新。runtime 初始化在 `#container`，因此 sidebar 中的折叠块也能交互。

示例：`examples/sigma-demo/`，运行 `node scripts/demo-sigma.mjs` 查看 sigma 主题下 topbar/sidebar 的最小修改前后对比。

## 渲染

管线：

```ts
const doc = await processWikitext(ftml, { page, settings, dataProvider });
const { html, styles } = await renderWikitext(doc, { styleMode: 'separate' });
```

生成的完整文档包含：

1. `<meta charset="utf-8">` 与 viewport；
2. `wikidot.css` + `sigma.css`（本地内联，`@import` 提到最前）；
3. `[[module CSS]]` 收集的样式；
4. 调用方 `layout.css`；
5. 内联 `@wdprlib/runtime`，初始化 tabview / collapsible / TOC / 脚注等交互。

include 解析顺序：`WIKIDOT_LAYOUT_INCLUDE_DIRS` 中的本地 `.ftml` → 匿名远程页面。失败返回占位并产生结构化诊断。

## 截图

- 启动临时 HTTP 服务，绑定 `127.0.0.1` 随机端口，只服务 artifact 根目录（防路径穿越）；不使用 `file://`。
- 视口：`desktop` 1440×900、`tablet` 1024×768、`mobile` 390×844，`deviceScaleFactor: 1`。
- 支持 `fullPage`、`selector`、`clip`、`waitForSelector`、`waitMs`、`colorScheme`。
- 返回本地绝对路径与 `artifact://<artifactId>/screenshot.png`，不返回 base64。
- 收集 `console` error 与 `pageerror`。
- 远程 URL 只允许 `http/https`，拒绝 localhost、`.local`、私网/保留地址（含 DNS 解析检查）。

## 安全

- 截图 URL：SSRF 防护，默认拒绝本机/内网。
- `layout_export` / `scaffold.outDir`：只能写入 `WIKIDOT_LAYOUT_ALLOWED_ROOTS` 内的路径，拒绝 `..`、绝对路径越界与符号链接逃逸。
- 日志只写 stderr，并遮蔽 Cookie、token、Authorization、password。
- artifact 默认保留最近 100 个。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CHROME_PATH` | 自动查找 | 浏览器可执行文件 |
| `WIKIDOT_LAYOUT_DEBUG` | `0` | 输出 debug 日志 |
| `WIKIDOT_LAYOUT_DEFAULT_SITE` | `scp-wiki-cn` | 默认站点 |
| `WIKIDOT_LAYOUT_SOURCE_TTL_MS` | `300000` | 源码缓存 TTL |
| `WIKIDOT_LAYOUT_FETCH_TIMEOUT_MS` | `15000` | 抓取超时 |
| `WIKIDOT_LAYOUT_CONCURRENCY` | `2` | 同站点并发 |
| `WIKIDOT_LAYOUT_DISABLE_CACHE` | `0` | 设为 `1` 禁用源码缓存 |
| `WIKIDOT_LAYOUT_ARTIFACT_DIR` | `./artifacts` | 产物目录 |
| `WIKIDOT_LAYOUT_ARTIFACT_KEEP` | `100` | 保留 artifact 数量 |
| `WIKIDOT_LAYOUT_ALLOWED_ROOTS` | 项目根 + cwd | 允许导出的根目录（`path.delimiter` 分隔） |
| `WIKIDOT_LAYOUT_INCLUDE_DIRS` | `./includes` | 本地 include 目录 |
| `WIKIDOT_LAYOUT_ALLOW_REMOTE_URL` | `1` | 设为 `0` 禁止远程 URL 截图 |
| `WIKIDOT_LAYOUT_PROXY` | — | 显式代理地址，如 `http://127.0.0.1:7890` |
| `WIKIDOT_LAYOUT_USE_ENV_PROXY` | `1` | 设为 `0` 忽略 `HTTP(S)_PROXY` |
| `WIKIDOT_LAYOUT_DISABLE_PROXY` | `0` | 设为 `1` 完全禁用代理 |
| `WIKIDOT_LAYOUT_ALLOW_PRIVATE` | `0` | 启用服务端私有凭证 |
| `WIKIDOT_USERNAME` / `WIKIDOT_PASSWORD` | — | 私有访问凭证 |
| `WIKIDOT_COOKIE_FILE` | — | 私有访问 Cookie 文件 |

## MCP Resources 与 Prompts

Resources：

- `wikidot://syntax/overview`
- `wikidot://syntax/layout-blocks`
- `wikidot://structure/page-anatomy`
- `wikidot://structure/themes`
- `wikidot://themes/catalog`（主题页 URL / 仓库 / normalize，JSON）
- `preset://list`
- `preset://<id>`
- `artifact://<artifactId>/screenshot.png`（也支持 `index.html` / `meta.json`）

Prompts：

- `design-layout`
- `analyze-page-layout`
- `iterate-from-screenshot`

## 测试

```bash
npm test

# 真实公开页面集成测试（默认跳过；自动使用环境代理）
LIVE=1 node --import tsx --test tests/live.test.ts
```

真实网络测试已验证 `scp-wiki:scp-173`：匿名客户端源码、contentHash、块/include/module 扫描与渲染层 DOM 分析。

覆盖：schema 凭据字段断言、MCP stdio/in-memory 调用、8 个预设渲染、`div_` 配对、本地 include、AMC 回退与错误码、路径穿越、SSRF、静态服务、截图尺寸/fullPage/selector/console 错误。

## 目录

```
src/
  index.ts             MCP stdio 入口
  server.ts            工具注册
  tool-schemas.ts      zod schema（含安全断言用导出）
  wikidot/             匿名客户端、AMC、源码缓存、结构分析
  compat/              dirtToIdeal
  presets/             8 个版式原型 + 共享基座 CSS
  render/              FTML 渲染、完整文档、校验
  screenshot/          浏览器、静态服务、截图
  security/            路径与 SSRF
  resources.ts         MCP Resources
  prompts.ts           MCP Prompts
tests/                 node:test + undici MockAgent + fixtures
docs/                  预设与页面结构文档
```

更多：`docs/presets.md`、`docs/page-structure.md`。
