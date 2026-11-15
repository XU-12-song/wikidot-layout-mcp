# 内置版式原型

所有原型位于 `src/presets/<id>/`，由 `preset.json`、`page.ftml`、`layout.css`、`notes.md` 四个数据文件组成。工具函数不硬编码 HTML。

共享基座：`src/presets/_shared/base.css`，通过相对 `@import` 引入；读取时递归内联，保证导出与渲染自包含。

## 通用约定

- 类名前缀：`lay-`
- 区域标记：`lay-region lay-region-<name>`
- 层级：边框 + 表面色 + outline + 留白，不使用阴影/圆角浮层
- 视口：1440×900、1024×768、390×844
- token 占位：`{{tokenName}}`，在 scaffold / render 前替换

## 1. article-single

- 名称：单栏文章页
- 区域：`topbar` / `content` / `footer`
- token：`contentWidth` 760px、`gutter` 28px、`paper`、`ink`、`accent`
- 单栏、首字下沉、行内注记（`span_`）、编辑注与结束线
- 适合随笔、公告、独立文章

## 2. docs-sidebar

- 名称：左导航文档版式
- 区域：`topbar` / `sidebar` / `content` / `footer`
- token：`contentWidth` 780px、`sidebarWidth` 240px、`gutter` 24px
- 桌面两栏；≤760px 侧栏移到正文之后
- 含 Wikidot 双竖线表格与 `[[collapsible]]`

## 3. docs-toc

- 名称：左导航 + 右侧目录
- 区域：`topbar` / `sidebar` / `content` / `toc` / `footer`
- token：`contentWidth` 740px、`sidebarWidth` 220px、`tocWidth` 210px
- 1440px 三栏；≤1100px 目录移至正文上方横向排列；≤760px 堆叠
- 右栏使用 Wikidot `[[toc]]`

## 4. card-grid

- 名称：卡片网格首页
- 区域：`topbar` / `hero` / `content` / `footer`
- token：`contentWidth` 1180px、`cardMin` 250px
- `auto-fit` 自适应 1 / 2 / 3–4 栏
- 大标题 + 数字侧栏 + 6 个入口卡片

## 5. scp-article

- 名称：SCP 条目页
- 区域：`topbar` / `content` / `footer`
- token：`contentWidth` 820px、`accent` 深红、`paper` 档案纸色
- 标题区 + 项目信息面板并排；≤760px 堆叠
- 含收容程序、描述、图示、折叠实验记录与评分槽位
- 正式发布时把手工评分块替换为 `[[module Rate]]`

## 6. component-gallery

- 名称：组件/主题展示页
- 区域：`topbar` / `content` / `footer`
- token：`contentWidth` 1180px、`cardMin` 220px
- 色板、按钮/徽标/提示框、代码样本、主题对比
- 代码使用 `[[code type="css"]]`，不会被当作 FTML 解析

## 7. longform-reading

- 名称：长文阅读
- 区域：`topbar` / `content` / `footer`
- token：`readingWidth` 680px、`lineHeight` 1.85、`fontSerif`
- 窄栏衬线正文、无衬线章节标签、旁注（`div_`）、图示与脚注
- 建议 `readingWidth` 保持 620–720px

## 8. blank

- 名称：空白画布
- 区域：`topbar` / `content` / `footer`
- token：`contentWidth` 1100px、`gutter` 28px
- 最小外壳 + 可见网格；用于从零设计
- 正式发布前删除 `.lay-blank-grid`

## 区域增删

`layout_scaffold({ presetId, regions })`：

- `content` 为受保护区域，不可移除；
- 其他区域通过删除带 `lay-region-<name>` 的 div 块实现（按 div 嵌套计数，不误伤嵌套内容）；
- `addRegions` 可以在页面开头或末尾追加自定义区域。

## token 覆盖

```json
{
  "presetId": "docs-sidebar",
  "tokens": {
    "contentWidth": "860px",
    "accent": "#1f4e6b",
    "sidebarWidth": "260px"
  }
}
```

未知 token 返回 `INVALID_INPUT` 并列出可用 token。
