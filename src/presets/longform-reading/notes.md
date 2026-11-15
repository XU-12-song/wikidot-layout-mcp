# 长文阅读（longform-reading）

- 用途：长篇叙事、非虚构、访谈整理。
- 区域：`topbar` / `content` / `footer`。
- 关键 token：`readingWidth` 680px、`lineHeight` 1.85、`fontSerif`。
- 正文使用衬线字体，章节标题使用无衬线小字距标题，形成节奏对比。
- 使用 `div_` 做紧贴上下文的旁注（无额外段落包裹）。

建议：

- `readingWidth` 保持在 620–720px；超过 760px 需要更大字号与行距。
- 移动端不强制衬线，可按需在 `@media` 中切回无衬线。
