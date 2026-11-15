# 复古版式实战笔记（normalize + Sigma-9 外壳）

本文件记录一次「基于 Sigma-9 的复古版式」设计过程中实际踩到的问题与处理方式，供后续 agent 复用。结论先行：**用 normalize 重做版式时，不能只 import 就当作白纸，Sigma-9 的区域几何规则仍然残留，必须显式复位。**

## 1. FTML 嵌套 div 的换行要求

错误写法（会报 `inline-block-element`，并连带出现 unclosed-block）：

```ftml
[[div class="retro"]]
[[div class="retro-head"]]
[[div class="retro-kicker"]]THE ARCHIVE[[/div]]
[[/div]]
[[/div]]
```

正确写法：开标签、内容、闭标签各自独占行，前后留空行。

```ftml
[[div class="retro"]]

[[div class="retro-head"]]

[[div class="retro-kicker"]]

THE ARCHIVE

[[/div]]

[[/div]]

[[/div]]
```

首次渲染出现 6 条 `inline-block-element` + 3 条 `unclosed-block`，全部由这个原因引起。`layout_validate` / 预览诊断可提前发现。

## 2. normalize 之后 Sigma-9 仍残留的关键规则

`normalize-min.css` 会把大部分站点样式 unset，但以下与本项目相关的规则在实测中仍然生效，直接导致 header / top-bar 布局错乱：

```css
/* sigma.css 残留 */
#header{ height:140px; padding-bottom:22px;
         background:url(logo.png) 10px 40px no-repeat; }
#header h1,#header h2{ float:left; margin-left:120px; max-height:95px; }
#header h1 a{ padding:80px 0 25px; max-height:0; line-height:0; }
#header h2 span{ padding:19px 0; }
#top-bar{ position:absolute; top:140px; height:21px; }
#top-bar ul li a{ max-height:1px; overflow:hidden; line-height:1px; }
```

表现：

- 标题文字被压扁 / 位置偏右，header 高度被固定为 140px；
- 顶栏导航被挤到 header 底边并裁切，链接几乎不可见（截图里只剩上半截）；
- 给 `#header` 单独写 `height:auto` 不够，因为子元素仍是浮动且带巨量 padding。

必须成套复位：

```css
#header{ height:auto; overflow:visible; }
#header h1, #header h2{ float:none; max-height:none; margin:0; }
#header h1 a{ display:inline; padding:0; max-height:none; line-height:inherit; }
#header h2 span{ display:inline; padding:0; max-height:none; line-height:inherit; }
#top-bar{ position:static; height:auto; overflow:visible; clear:both; }
#top-bar ul li a{ max-height:none; overflow:visible; line-height:1.4;
                  padding:11px 0; border:0; }
```

这是本次耗时最多的一段。判断方法：对可疑区域用 `layout_screenshot({ selector: "#header" })` 单独截取，比看整页更快定位裁切。

## 3. 引用 blockquote 的残留底色与边框

Sigma-9 的引用块带浅色底和虚线边框，normalize 后仍可见。自定义样式需要显式清空：

```css
#page-content blockquote{
  background:transparent;
  border:0;
  border-top:1px solid #b9a583;
  border-bottom:1px solid #b9a583;
}
```

只写 `border-top/bottom` 不够，左右边框和背景会保留。

## 4. normalize 的位置与基础排版

- `@import url("https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css");` 必须是自定义 CSS 的**第一行**，且在所有普通规则之前。
- import 之后字号、行高、标题层级会被清空，需要重新定义 `body` / `h1-h4` / `p` / `a` / `ul` / `img` 的基础样式，否则正文会退回浏览器默认排版。
- 全幅深色 masthead 与定宽正文的左右对齐，用同一套计算：

```css
max-width:1120px;
padding-left:max(40px, calc((100vw - 1120px) / 2));
padding-right:max(40px, calc((100vw - 1120px) / 2));
```

## 5. 侧边栏图标与「管理专用」红块

- 预览环境的 `nav:side` 图标来自外站，离线时会触发 `ERR_CONNECTION_CLOSED`，出现破图 alt 文本。复古方案本身不需要图标，直接隐藏即可：

```css
#side-bar .menu-item img{ display:none; }
```

- 「管理专用」区块的粉色背景来自站点 `nav:side` 里的**内联样式** `style="background-color:#fff0f0"`，不是版式 CSS 的问题。需要在预览里压掉时用 `!important`；**真实 Wikidot 站点上不存在此问题，可忽略，不必为它写兼容规则。**

## 6. 截图工具的副作用

- `layout_screenshot({ artifactId })` 会把截图写回该 artifact 的同一个 `screenshot.png`。对已有 artifact 做单选元素截图会覆盖之前的整页截图。
- 建议：需要局部检查时接受覆盖，或重新跑一次 `layout_preview_and_screenshot` 生成新 artifact 作为最终交付图。

## 7. 预览环境的网络噪声

builtin 外壳会加载站点 logo、侧栏图标等外链资源，离线/代理不通时 console 出现多条 `ERR_CONNECTION_CLOSED`。这些不影响 CSS 布局结论，但会干扰视觉判断（破图、缺 logo），评估时应先忽略。

## 8. 复古设计的最小 token

本次方案只用了这几个值，后续可直接复用：

| 用途 | 值 |
| --- | --- |
| 页面底色 | `#ded4b8` |
| 纸张 | `#f4ecd8` |
| 次级纸块 | `#efe4ca` / `#f2e9d3` |
| 墨色 | `#3a2f26` |
| 次要文字 | `#7d6a4f` / `#8a7659` |
| 线条 | `#b9a583` / `#c9b696` |
| masthead | `#2b2219` |
| 强调/链接 | `#7a4a2e` |
| 字体 | `Georgia, "Songti SC", "Noto Serif SC", serif` |

装饰语言：双线分隔、dashed 细分隔线、零圆角、无阴影（仅用 1px 硬偏移边框）。
