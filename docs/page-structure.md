# Wikidot 页面结构

## 渲染外壳

`layout_render_preview` 默认套完整 `#container` 结构（或显式 `shell: 'site'` 抓取 `_template`）。正文注入 `#page-content`，标题注入 `#page-title`；`#header`、`#top-bar`、`#side-bar`、`#main-content`、`#footer`、`#license-area` 均真实存在，CSS 应直接针对这些 ID/类设计。

`wikidot_analyze_page_structure` 同时给出源码层与渲染层信息。

## 页面类型

| 判断 | pageType | 说明 |
| --- | --- | --- |
| `theme:*` | `theme` | 主题页，定义 CSS |
| `nav:*` | `nav` | `nav:top` / `nav:side` 导航页 |
| `component:*` | `component` | 可复用 include 组件 |
| `system:*` | `system` | 系统页 |
| `_*` 或 `*:_*` | `fragment` | 片段/模板页 |
| 其他 | `article` | 普通文章 |

`category` 返回冒号前的分类名。

## 源码层

扫描器逐行处理，跳过 `[!-- --]` 注释，并在 `[[code]]`、`[[html]]`、`[[embed]]` 体内停止解析块标签。

识别的块：

- `div` / `div_`
- `span` / `span_`
- `collapsible`
- `tabview` / `tab`
- `code` / `html` / `embed`

每个块返回：

```json
{
  "tag": "div",
  "variant": "div_",
  "classes": ["lay-card"],
  "id": null,
  "depth": 2,
  "line": 12,
  "closed": true
}
```

规则：

- `div_` / `span_` 的 `tag` 归一化为 `div` / `span`，`variant` 保留原始写法；
- 闭合仍使用 `[[/div]]` / `[[/span]]`；
- 行内 `span` 同行闭合时不进入块嵌套栈；
- 未闭合块与游离闭合标签产生 `unclosed-block` / `stray-close` 警告；
- 标题从行首 `+` 到 `++++++` 提取，跳过代码块内文本。

### include

```json
{
  "target": ":scp-wiki:component:info-panel",
  "site": "scp-wiki",
  "page": "component:info-panel",
  "kind": "cross-site",
  "arguments": { "name": "示例" },
  "line": 4
}
```

- 不以 `:` 开头 → 同站；
- `:site:page` 且 `site` 与当前站点不同 → `cross-site`；
- 无法解析目标 → 警告。

### module

```json
{ "name": "Rate", "raw": "Rate", "line": 40 }
```

无法解析名称 → `module-parse-failed` 警告。

## 渲染层

另外抓取一次公开 HTML（`includeDom: false` 可关闭），用 cheerio 检查：

| 字段 | 选择器 |
| --- | --- |
| `pageTitle` | `#page-title` |
| `pageContent` | `#page-content` |
| `pageOptions` | `#page-options-container` / `.page-options-bottom` |
| `ratingModule` | `#page-rate-widget-box` / `.page-rate-widget-box` |
| `breadcrumbs` | `#breadcrumbs` |
| `toc` | `#toc` / `#toc-action-bar` |
| `topBar` | `#top-bar` / `.mobile-top-bar` |
| `sideBar` | `#side-bar`（有文本内容） |
| `contentColumnWidth` | 内联 `width` / `max-width` |

抓取失败不影响源码分析；`dom.fetched` 为 false 并附加 `dom-fetch-failed` 警告。

## layoutHints

```json
{
  "hasTopBar": true,
  "hasSideBar": false,
  "hasToc": false,
  "contentColumnWidth": "780px"
}
```

合并源码线索（`nav:top`、`nav:side`、`[[toc]]`、CSS 宽度）与渲染层结果。

## 输出示例

```json
{
  "ok": true,
  "site": "scp-wiki",
  "page": "scp-173",
  "title": "SCP-173",
  "pageType": "article",
  "category": null,
  "sourceMeta": {
    "contentHash": "sha256:...",
    "cached": true,
    "fetchedAt": "2026-11-15T01:00:00.000Z"
  },
  "headings": [{ "level": 2, "text": "Description", "line": 20 }],
  "blocks": [{ "tag": "div", "variant": null, "classes": ["block"], "id": null, "depth": 1, "line": 12, "closed": true }],
  "includes": [{ "target": "component:info-panel", "site": null, "page": "component:info-panel", "kind": "local", "arguments": {}, "line": 4 }],
  "modules": [{ "name": "rate", "raw": "rate", "line": 40 }],
  "dom": { "fetched": true, "...": "..." },
  "layoutHints": { "hasTopBar": true, "hasSideBar": false, "hasToc": false, "contentColumnWidth": "780px" },
  "warnings": []
}
```
