# 左导航文档版式（docs-sidebar）

- 用途：知识库、规则页、长文档。
- 区域：`topbar` / `sidebar` / `content` / `footer`。
- 关键 token：`contentWidth` 780px、`sidebarWidth` 240px、`gutter` 24px。
- 桌面为两栏，≤760px 堆叠；侧栏在移动端移到正文之后。
- 导航使用 Wikidot 页面链接，不绑定站点域名。

可调项：

- `sidebarWidth` 建议 200–280px；再宽会压缩正文。
- `contentWidth` 超过 860px 时请同步提高 `lineHeight`，否则行长过大。
