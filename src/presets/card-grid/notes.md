# 卡片网格首页（card-grid）

- 用途：站点首页、专题聚合、内容入口。
- 区域：`topbar` / `hero` / `content` / `footer`。
- 关键 token：`contentWidth` 1180px、`cardMin` 250px。
- 卡片最小宽度由 `cardMin` 控制，配合 `auto-fit` 自动得到 1–4 栏。
- 卡片不叠加阴影，只使用 1px 边框与表面色区分层级。

可调项：

- 入口更多时把 `cardMin` 降到 210px，可多容纳一列。
- 首页更偏“目录”时，移除 `hero` 区域，仅保留 `topbar` + `content` + `footer`。
