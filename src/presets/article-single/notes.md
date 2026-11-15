# 单栏文章页（article-single）

- 用途：随笔、公告、独立文章。
- 区域：`topbar` / `content` / `footer`。
- 关键 token：`contentWidth`（默认 760px）、`gutter`、`paper`、`ink`、`accent`。
- 行宽控制在约 65–75 字符；移动端自动收为单列。
- 版本 1440 / 1024 / 390 均已验证。

调整建议：

- 想更“杂志”一些：把 `contentWidth` 提到 820px，并加宽 `gutter`。
- 想更紧密：把 `lineHeight` 降到 1.6，同时略减段落间距。
