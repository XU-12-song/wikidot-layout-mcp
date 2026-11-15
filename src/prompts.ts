/** MCP Prompts：设计、分析、基于截图迭代。 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'design-layout',
    {
      title: '设计一个 Wikidot 版式',
      description: '从内置原型出发，生成 FTML + CSS，并渲染截图。',
      argsSchema: {
        presetId: z.string().optional().describe('起始原型 id；不填则先列出预设'),
        requirements: z.string().describe('页面类型、区域、配色、内容规模等要求'),
      },
    },
    ({ presetId, requirements }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              '你是 Wikidot 版式设计师。请完成以下任务：',
              '',
              `需求：${requirements}`,
              presetId ? `起始原型：${presetId}` : '起始原型：先调用 layout_list_presets 选择最接近的一个。',
              '',
              '工作步骤：',
              '1. 调用 layout_get_preset 读取 FTML 与 CSS，理解区域与 token。',
              '   若需要主题实现细节，调用 wikidot_list_theme_sources；不确定选择器时 clone 对应 GitHub 仓库检索 CSS。',
              '2. 调用 layout_scaffold 覆盖 token / 区域，生成页面文件。',
              '3. 调用 layout_validate，确保 errors 为空。',
              '4. 调用 layout_preview_and_screenshot，分别使用 1440x900、1024x768、390x844。',
              '5. 根据截图中的间距、层级、换行问题调整 CSS，重复 3–4 步。',
              '6. 只使用 lay- 前缀类名；不要用阴影+圆角叠加的浮层外观。',
              '',
              '最终输出：FTML、CSS、三个视口的截图路径，以及关键设计决策。',
            ].join('\n'),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'analyze-page-layout',
    {
      title: '分析 Wikidot 页面版式',
      description: '匿名获取源码与结构，给出可复用的版式建议。',
      argsSchema: {
        site: z.string().describe('站点子域名，如 scp-wiki-cn'),
        page: z.string().describe('页面名'),
      },
    },
    ({ site, page }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `分析 ${site}:${page} 的版式结构。`,
              '',
              '步骤：',
              '1. 调用 wikidot_analyze_page_structure 获取源码层与渲染层结构。',
              '2. 必要时调用 wikidot_get_page_source 阅读完整源码。',
              '3. 总结：页面类型、区域划分、块嵌套深度、include/module 依赖、目录与导航。',
              '4. 指出版式问题（行宽、层级、嵌套、移动端风险）。',
              '5. 推荐 1–2 个内置预设，并说明需要覆盖的 token。',
              '',
              '注意：只读取公开页面；不要请求或使用任何凭据。',
            ].join('\n'),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    'iterate-from-screenshot',
    {
      title: '根据截图迭代版式',
      description: '查看现有截图，提出并执行一轮具体修正。',
      argsSchema: {
        artifactId: z.string().describe('layout_render_preview / layout_screenshot 返回的 artifactId'),
        goal: z.string().optional().describe('希望改善的目标，例如“移动端更紧凑”'),
      },
    },
    ({ artifactId, goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `基于 artifact ${artifactId} 的渲染结果做一轮迭代。`,
              goal ? `目标：${goal}` : '目标：找出最影响可读性的三个问题并修复。',
              '',
              '步骤：',
              '1. 读取 artifact://${artifactId}/screenshot.png 与 artifact://${artifactId}/index.html。',
              '2. 列出具体问题：哪一条规则、哪个区域、在哪个视口。',
              '3. 只改必要的 CSS，不要重写整个版式。',
              '4. 重新渲染并截图 1440 / 1024 / 390；对比修改前后。',
              '5. 输出：问题 → 修改 → 验证结果。',
            ].join('\n'),
          },
        },
      ],
    })
  );
}
