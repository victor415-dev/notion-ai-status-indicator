# M1：状态检测验证（命门）

M1 的唯一目标：**确认能准确识别 Notion AI 的 `thinking` / `responding` / `done`**，其余功能都建立在它之上。

## 步骤

1. 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选本仓库根目录。
2. 打开 `https://www.notion.so` 并触发一次 Notion AI 对话。
3. 打开页面 DevTools 的 Console，观察 `[NAI-Indicator]` 日志：
   - 请求发出 → `thinking`
   - 首个流式 chunk → `responding`
   - 流结束 → `done`

## 需要人工确认的点

- `src/content/interceptor.js` 里的 `AI_URL_HINTS` 是否命中了**真正的** Notion AI 流式端点。
  - 若 AI 对话没触发、或命中了无关请求：在 Network 面板找到实际的 AI 流式请求 URL，把其特征串补进 `AI_URL_HINTS` 并收敛匹配。
- 判定时机是否准确（有没有过早/过晚报 `done`）。

确认无误后再推进 M2（页面内宠物动画）与 M3（跨窗口通知）。

> 决策与方案以 Notion 项目页为唯一事实源，本文档为仓库侧执行说明。
