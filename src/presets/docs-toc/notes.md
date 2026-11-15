# 左导航 + 右侧目录（docs-toc）

- 用途：长文档、手册、需要频密跳读的规范页。
- 区域：`topbar` / `sidebar` / `content` / `toc` / `footer`。
- 关键 token：`contentWidth` 740px、`sidebarWidth` 220px、`tocWidth` 210px。
- 1440px 三栏；≤1100px 目录移到正文上方横向排列；≤760px 全部堆叠。
- 右栏使用 Wikidot `[[toc]]`，无 JS 也可用；交互由 `@wdprlib/runtime` 接管。

注意：

- `[[toc]]` 必须放在正文可解析的位置；本预设放在独立右栏容器中。
- 若页面禁用目录，可移除 `toc` 区域。
