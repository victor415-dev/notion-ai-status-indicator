# Notion AI 对话完成指示器（Notion AI Task Indicator）

> 一个 MV3 浏览器扩展：检测 Notion AI 网页版的对话任务状态（思考中 / 输出中 / 完成），在页面内以「宠物」形式显示状态，并在任务完成时通过系统通知跨窗口提醒。

**纯扩展、无本地化组件，可上架 Chrome Web Store，代码单仓库、易迁移。**

---

## 目标

用于 Notion AI 网页版：

- **检测** 当前 AI 对话任务状态：思考中（`thinking`）/ 输出中（`responding`）/ 完成（`done`）。
- **展示** 一个页面内浮动「宠物」，随状态切换表情 / 动画。
- **提示** 任务完成时通过系统通知跨窗口提醒用户（即使切到别的 App 也能收到）。

## 方案（已定：纯扩展）

全部逻辑落在浏览器沙箱内，不引入任何原生 / 本地化组件。

### 架构

```text
content script（注入 Notion 页面）
  ├─ 复用归档器 fetch 拦截 → 状态机 idle → thinking → responding → done
  ├─ 渲染页面内浮动宠物（可拖动、记忆位置）
  └─ 上报状态 →
background service worker
  ├─ 聚合多标签状态
  ├─ chrome.notifications 弹系统通知（跨窗口、后台可达）
  └─ 更新工具栏图标角标（运行中 / 完成）
offscreen document
  └─ 播放完成提示音（MV3 service worker 不能直接放音频）
```

### 三块要点

1. **状态检测（命门）**：认准 Notion AI 的流式接口——请求发出 = `thinking`，首个 token = `responding`，流关闭 / 结束事件 = `done`；DOM 扒取仅作兜底。
2. **页面内宠物**：content script 透明浮层，绝对定位在角落，可拖动，位置存 `chrome.storage`。UI 常驻 content script，**不放 service worker**。
3. **跨窗口提醒**：`chrome.notifications` + 工具栏图标角标；声音走 offscreen document。

### 状态协议（内部消息）

content script 与 background 之间传递的状态事件建议统一为：

```json
{
  "state": "idle | thinking | responding | done",
  "conversationId": "string",
  "tabId": 0,
  "startedAt": 0,
  "finishedAt": 0
}
```

先把协议定死，后续换宠物皮肤 / 动画都不用动检测与通信层。

## 约束

- **可发布 / 易迁移优先**：上架 Chrome Web Store 且代码进 GitHub → **禁止**引入 `native messaging`、本地 WebSocket、原生桌宠等本地化内容。
- **放弃「悬浮在所有窗口之上」的桌面宠物**：浏览器沙箱物理限制，扩展画不出浏览器窗口之外的东西；跨窗口感知改由系统通知实现。
- **权限收敛**：`host_permissions` 限定 Notion 自家域名（`*://app.notion.com/*` 与 `*://*.notion.so/*`）；仅申请 `notifications` / `storage` /（如需）`offscreen`。不监听 Notion 以外的任何站点。

## 关键决策与取舍

| # | 决策 | 取舍与理由 |
|---|------|-----------|
| 1 | **纯扩展**，而非「扩展 + 原生桌宠」 | 用户约束为可发布 / 易迁移优先；原生端无法上架、需双轨发布且本地化重。代价：宠物只在 Notion 页内可见，跨窗口靠系统通知补足。 |
| 2 | 状态检测以 **fetch 拦截**为主，DOM 扒取仅兜底 | 拦截更稳、不随 Notion 改版崩；且可复用现有归档器拦截链。 |
| 3 | **不用 native messaging / 本地 WebSocket** | 这些是最重的本地化项，直接违背发布 / 迁移约束。 |
| 4 | 宠物 UI 放 **content script**，worker 只做通知 / 角标 | MV3 service worker 会休眠，UI 放 worker 会丢失。 |

## 里程碑

- [ ] **M1 状态检测验证**（命门，先做、单独验证）：拦截链先用日志打出 `thinking` / `responding` / `done`，确认准确。
- [ ] **M2 页面内宠物**：浮层 + 状态动画 + 拖动记忆位置。
- [ ] **M3 跨窗口提醒**：系统通知 + 图标角标 +（可选）提示音。
- [ ] **M4 多标签聚合 + 打磨**：worker 汇总多任务状态。
- [ ] **M5 上架流程**：manifest / 权限收敛、隐私说明、商店素材。

> M1 是命门，先单独验证检测准确性，再往下推。

## MV3 注意事项

- service worker 会休眠（约 30s 空闲）：只让它做「收事件 → 弹通知 → 改角标」，靠消息唤醒；不放宠物 UI 和长计时器。
- 声音：MV3 worker 不能直接放音频，用 offscreen document 播放。
- 多标签聚合：worker 当唯一状态汇总方，通知里可提示「还有 N 个任务在跑」。

## 目录结构（建议）

```text
.
├── manifest.json
├── src/
│   ├── content/        # 页面内宠物 + fetch 拦截 + 状态机
│   ├── background/     # service worker：通知 / 角标 / 聚合
│   ├── offscreen/      # 提示音
│   └── shared/         # 状态协议、类型、常量
├── assets/             # 宠物素材、图标
└── docs/               # 设计文档
```

## 事实源

本仓库的**决策记录（目标 / 方案 / 约束 / 关键决策）以 Notion 项目页为唯一事实源**，本 README 为其在代码仓库侧的同步副本。改动决策时以 Notion 页为准。
