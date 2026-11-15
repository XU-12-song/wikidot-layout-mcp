/** MCP Resources 使用的内置文档。 */

import { themeCatalogMarkdown } from './themes/catalog.js';

export const SYNTAX_OVERVIEW = `# Wikidot 语法速览

## 标题

行首写 \`+\`，最多 6 级：

\`\`\`
+ 一级标题
++ 二级标题
+++ 三级标题
\`\`\`

标题必须独占一行。

## 行内

- \`**粗体**\`、\`//斜体//\`、\`__下划线__\`、\`--删除线--\`
- \`{{等宽}}\`、\`^^上标^^\`、\`,,下标,,\`
- 行内公式 \`[[$ ... $]]\`
- 转义：\`\\\` 前缀

## 链接与图片

\`\`\`
[[[page-name|显示文字]]]      站内链接
[[[category:page|显示文字]]]
[http://example.com 外部链接]
[# 页内锚点]
[[image URL caption="说明" width="300px"]]
\`\`\`

注意站内链接是三对方括号；外部链接是一对方括号。

## 列表与表格

\`\`\`
* 无序项
  * 子项
# 有序项

||~ 表头 ||~ 表头 ||
|| 单元格 || 单元格 ||
\`\`\`

表格必须使用双竖线 \`||\`，不是 Markdown 的单竖线。

## 块级标签

行首的 \`[[div]]\`、\`[[/div]]\` 等必须独占一行，行尾不能有多余空格或文字。

\`\`\`
[[div class="box"]]
内容
[[/div]]
\`\`\`

## 注释

\`\`\`
[!-- 这是注释，不会输出 --]
\`\`\`

## 水平线

\`\`\`
----
\`\`\`

## include 与 module

\`\`\`
[[include :scp-wiki-cn:component:info-panel name=示例]]
[[module Rate]]
[[module CSS]]
...
[[/module]]
\`\`\`

include 与 module 都必须从行首开始；前导空格会让 Wikidot 忽略整行。
`;

export const LAYOUT_BLOCKS = `# 版式块与配对规则

## div / span

\`\`\`
[[div class="lay-card"]]
...
[[/div]]

[[span class="lay-badge"]]Draft[[/span]]
\`\`\`

\`div\` 是块级容器，会包裹段落。\`span\` 是行内容器。

## div_ / span_（无段落包裹变体）

\`\`\`
[[div_ class="lay-note"]]
紧贴上下文的块，不额外生成段落包裹。
[[/div]]

[[span_ class="lay-mark"]]行内注记[[/span]]
\`\`\`

- \`div_\` 闭合仍然写 \`[[/div]]\`；
- \`span_\` 闭合仍然写 \`[[/span]]\`；
- 不要把 \`div_\` 当成独立标签名，它只是 \`div\` 的变体。

## 折叠块

\`\`\`
[[collapsible show="展开" hide="收起"]]
内容
[[/collapsible]]
\`\`\`

## 标签页

\`\`\`
[[tabview]]
[[tab 标题一]]
内容一
[[/tab]]
[[tab 标题二]]
内容二
[[/tab]]
[[/tabview]]
\`\`\`

## 代码与原始 HTML

\`\`\`
[[code type="css"]]
.lay-example { color: red; }
[[/code]]

[[html]]
<div>原样输出的 HTML</div>
[[/html]]
\`\`\`

\`[[code]]\`、\`[[html]]\`、\`[[embed]]\` 体内的 \`[[/div]]\` 等伪标签不会参与外层配对。

## include

\`\`\`
[[include page-name]]
[[include :site:page |a=1 |b=2]]
[[include component:info-panel name=示例]]
\`\`\`

- 不以 \`:\` 开头的目标是同站 include；
- \`:site:page\` 是跨站 include；
- 变量用 \`|\` 分隔，可写成 \`key=value\`。

## 常见错误

1. 标签不在行首，或行首有空格。
2. \`[[/div]]\` 忘写，导致后续内容被吞进容器。
3. 把 \`div_\` 的闭合写成 \`[[/div_]]\`。
4. 在 \`[[code]]\` / \`[[html]]\` 中使用块标签，误以为会被解析。
5. 表格误用 Markdown 语法。
`;

export const PAGE_ANATOMY = `# Wikidot 页面结构

## 页面类型

| 前缀 | 类型 | 典型用途 |
| --- | --- | --- |
| 无 | 普通页 | 文章、条目 |
| \`theme:\` | 主题页 | 定义站点 CSS |
| \`nav:top\` / \`nav:side\` | 导航页 | 顶栏、侧栏 |
| \`component:\` | 组件页 | 可复用 include 片段 |
| \`system:\` | 系统页 | 特殊功能页 |
| \`_default:\` / \`_template\` | 模板 | 分类默认内容 |

## 常见 DOM 节点

- \`#page-title\`：页面标题
- \`#page-content\`：正文容器
- \`#page-options-container\` / \`.page-options-bottom\`：编辑、历史等操作区
- \`#breadcrumbs\`：面包屑
- \`#side-bar\` / \`#top-bar\`：站点导航
- \`#page-rate-widget-box\` / \`.page-rate-widget-box\`：评分模块
- \`#toc\` / \`#toc-action-bar\`：页内目录
- \`#main-content\`、\`#content-wrap\`：站点主题的布局容器

## 版式区域

一个可复用版式通常拆成：

1. \`topbar\`：品牌与主导航
2. \`sidebar\`：章节导航
3. \`content\`：正文
4. \`toc\`：页内目录
5. \`footer\`：版权与元信息

区域用 \`[[div class="lay-region lay-region-<name>"]]\` 包裹，便于分析和增删。

## 响应式检查点

- 1440×900：桌面主布局
- 1024×768：平板，侧栏收窄或目录下移
- 390×844：手机，全部堆叠为单列

## 结构分析输出

\`wikidot_analyze_page_structure\` 同时返回：

- 源码层：标题、块、include、module、未闭合警告
- 渲染层：真实页面 HTML 中的页级节点与导航区域
`;

export const THEMES = `# 主题与 CSS

## 主题来源

- Wikidot 默认样式：本仓库根目录 \`wikidot.css\`
- SCP-CN 常用主题：本仓库根目录 \`sigma.css\`
- 主题页通常位于 \`theme:<name>\`，通过 \`[[module CSS]]\` 或站点管理设置加载
- 常见主题仓库：
  - Basalt：\`https://github.com/Basalt-Team/Basalt\`
  - Black Highlighter：\`https://github.com/Nu-SCPTheme/Black-Highlighter\`

## 版式 CSS 约定

- 所有类名以 \`lay-\` 前缀开头，避免与主题规则冲突。
- 只用边框、表面色、outline 与留白建立层级；不要用叠加阴影与圆角的浮层外观。
- 变量集中在 \`:root\`，通过 token 覆盖调整栏宽、断点、配色与字体。
- 不覆盖站点评分、导航、授权区域的交互结构。

## 渲染顺序

预览文档中的样式顺序：

1. 主题 CSS（\`wikidot.css\` + \`sigma.css\`）
2. \`[[module CSS]]\` 收集的模块样式
3. 调用方自定义 CSS（\`layout.css\`）

后加载的规则优先。版式 CSS 最后加载，因此可以覆盖主题的排版默认值。

## 常用 token

- \`contentWidth\` / \`sidebarWidth\` / \`tocWidth\` / \`gutter\`
- \`paper\` / \`surface\` / \`ink\` / \`muted\` / \`line\` / \`accent\`
- \`radius\` / \`lineHeight\` / \`fontSans\` / \`fontSerif\`

## 发布前检查

1. 1440 / 1024 / 390 三个视口截图。
2. 检查长标题、空内容、超长代码块。
3. 确认没有全局选择器污染站点主题。
4. 主题中的远程字体或图标加载失败时，布局仍应可读。

${themeCatalogMarkdown()}
`;
