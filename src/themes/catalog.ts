/**
 * 主题来源目录：给 agent 的结构化“页面 URL / 仓库 / 本地 CSS / normalize 技巧”。
 *
 * 页面本身可通过 wikidot_get_page_source / wikidot_analyze_page_structure 匿名读取；
 * 仓库不通过 MCP 抓取——agent 可以按这里的 repo 地址自行 clone 后检索 CSS。
 */

export interface ThemeSource {
  id: string;
  name: string;
  page: string;
  url: string;
  repo: string | null;
  notes: string[];
}

export interface ThemeCatalog {
  defaults: {
    wikidotCss: { local: string; role: string; note: string };
    sigmaCss: {
      local: string;
      upstream: string;
      role: string;
      alwaysLoaded: boolean;
      note: string;
    };
    normalizeOverride: {
      css: string;
      purpose: string;
      usage: string;
      caveat: string;
    };
  };
  themes: ThemeSource[];
  guidance: string[];
}

export const THEME_CATALOG: ThemeCatalog = {
  defaults: {
    wikidotCss: {
      local: 'wikidot.css',
      role: 'wikidot-default',
      note: 'Wikidot 默认站点样式，作为基础重置与兼容层。',
    },
    sigmaCss: {
      local: 'sigma.css',
      upstream: 'https://sigma9.scpwikicn.com/cn/cn/sigma9_ch_sandbox.min.css',
      role: 'scp-cn-site-theme',
      alwaysLoaded: true,
      note: 'SCP-CN / 沙盒站当前主题，渲染时会与 wikidot.css 一起加载。',
    },
    normalizeOverride: {
      css: '@import url("https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css");',
      purpose: '覆盖 sigma.css，把绝大多数站点样式变为 unset。',
      usage: '放在自定义 CSS 最前面，之后只写自己的版式规则；它必须在所有普通规则之前。',
      caveat:
        '会同时去掉站点默认排版与可读性（字号、行距、标题层级），使用后必须重新定义基础文本样式，并保留评分/导航等必要模块的可交互结构。',
    },
  },
  themes: [
    {
      id: 'bedrock',
      name: 'Bedrock',
      page: 'theme:bedrock',
      url: 'https://scp-wiki-cn.wikidot.com/theme:bedrock',
      repo: null,
      notes: ['先读主题页源码；若需要理解变量与选择器，再按页面中的引用继续查找。'],
    },
    {
      id: 'basalt',
      name: 'Basalt',
      page: 'theme:basalt',
      url: 'https://scp-wiki-cn.wikidot.com/theme:basalt',
      repo: 'https://github.com/Basalt-Team/Basalt',
      notes: ['主题页网络不稳定时，以仓库中的 CSS/变量为准。'],
    },
    {
      id: 'black-highlighter',
      name: 'Black Highlighter',
      page: 'theme:black-highlighter-theme',
      url: 'https://scp-wiki-cn.wikidot.com/theme:black-highlighter-theme',
      repo: 'https://github.com/Nu-SCPTheme/Black-Highlighter',
      notes: ['主题页与仓库都可用于确认实际选择器与变量名。'],
    },
  ],
  guidance: [
    '页面信息：可直接调用 wikidot_get_page_source 或 wikidot_analyze_page_structure 读取上面列出的主题页，不需要登录。',
    '仓库信息：MCP 不代抓 GitHub。如果不确定主题的实现、变量或选择器，先 clone 对应 repo，再在仓库中搜索 CSS 选择器、自定义属性与 @import。',
    '不要凭记忆硬编码主题类名；以主题页源码和仓库中的实际 CSS 为准。',
    'normalize 是“从零建立版式”的技巧，不是默认步骤；它会把 sigma 的样式 unset 掉，必须自行补回基础排版。',
    '改版式时优先覆盖 #header、#top-bar、#side-bar、#main-content、#page-content 等真实 DOM 区域，而不是只改正文。',
  ],
};

/** 供 wikidot://structure/themes 使用的 Markdown 片段。 */
export function themeCatalogMarkdown(): string {
  const lines: string[] = [];
  lines.push('## 主题页面与仓库');
  lines.push('');
  lines.push('| 主题 | 页面 URL | 仓库 |');
  lines.push('| --- | --- | --- |');
  for (const theme of THEME_CATALOG.themes) {
    lines.push(`| ${theme.name} | ${theme.url} | ${theme.repo ?? '—'} |`);
  }
  lines.push('');
  lines.push('默认样式来源：');
  lines.push('');
  lines.push(`- \`wikidot.css\`：${THEME_CATALOG.defaults.wikidotCss.note}`);
  lines.push(
    `- \`sigma.css\`：${THEME_CATALOG.defaults.sigmaCss.note} 上游：${THEME_CATALOG.defaults.sigmaCss.upstream}`
  );
  lines.push('');
  lines.push('## normalize 技巧');
  lines.push('');
  lines.push('```css');
  lines.push(THEME_CATALOG.defaults.normalizeOverride.css);
  lines.push('```');
  lines.push('');
  lines.push(`- 作用：${THEME_CATALOG.defaults.normalizeOverride.purpose}`);
  lines.push(`- 用法：${THEME_CATALOG.defaults.normalizeOverride.usage}`);
  lines.push(`- 注意：${THEME_CATALOG.defaults.normalizeOverride.caveat}`);
  lines.push('');
  lines.push('## Agent 工作方式');
  lines.push('');
  for (const item of THEME_CATALOG.guidance) lines.push(`- ${item}`);
  return lines.join('\n');
}
