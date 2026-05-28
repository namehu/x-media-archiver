# P3.4 — WebUI Shell & Interaction System

## Context

P3.0–P3.3 已完成：CI 工程化、分页、OpenAPI 类型同步、SSE 实时刷新。
当前 WebUI 存在两个明显短板：
1. **布局**：顶部横向导航，无侧边栏分组，信息架构扁平
2. **组件缺口**：缺少 Dialog/Toast/Skeleton/EmptyState 等基础交互组件

P3.4 目标：补齐这两块，使 WebUI 达到可交付的交互完整度。

---

## 范围

### 任务 1 — 主题 Token

**文件**：`webui/tailwind.config.js`、`webui/src/styles.css`

- 将现有硬编码 HSL 颜色提取为 CSS 变量（`:root` / `.dark`）
- 支持 light / dark / auto（跟随系统）三档
- TopBar 增加主题切换按钮
- 不改动业务逻辑

### 任务 2 — 基础 UI 组件

**目录**：`webui/src/components/ui/`（已有 Button/Card/Input/Select/Badge）

新增（全部用 Tailwind 实现，与现有风格一致，不引入新依赖）：

| 组件 | 用途 |
|------|------|
| `Dialog` / `ConfirmDialog` | 危险操作二次确认（如 Full Scan） |
| `Toast` / `ToastProvider` | 全局操作反馈 |
| `Skeleton` | 加载占位 |
| `EmptyState` | 空列表提示 |
| `ErrorState` | 请求失败提示 |

### 任务 3 — AppShell 重构（布局）

**文件**：`webui/src/components/layout/AppLayout.tsx`、`webui/src/main.tsx`

当前：水平 NavBar，7 个路由平铺。
目标：左侧 Sidebar，按功能分组：

```
Operations   → /queue, /sources
Data         → /library, /failures, /duplicates
Maintenance  → /operations
```

顶部 TopBar 保留：worker 状态指示、语言切换、全局 Toast 挂载点。

---

## 关键文件

| 文件 | 改动类型 |
|------|---------|
| `webui/src/components/layout/AppLayout.tsx` | 重构为 Sidebar 布局 |
| `webui/src/main.tsx` | 路由不变，但 AppLayout 内部结构变化 |
| `webui/src/components/ui/Dialog.tsx` | 新增 |
| `webui/src/components/ui/Toast.tsx` | 新增 |
| `webui/src/components/ui/Skeleton.tsx` | 新增 |
| `webui/src/components/ui/EmptyState.tsx` | 新增 |
| `webui/src/components/ui/ErrorState.tsx` | 新增 |
| `webui/tailwind.config.js` | 提取 CSS 变量引用 |
| `webui/src/styles.css` | 添加 CSS 变量 + `.dark` 主题 |

---

## 执行顺序

1. 任务 1（主题 Token）— 基础，其他组件依赖 token
2. 任务 2（UI 组件）— 独立，并行
3. 任务 3（AppShell）— 依赖 Toast 组件和 token

---

## 验证

- `npm run check`（webui）：TypeScript 无错误
- `npm run build`（webui）：构建成功
- 浏览器验证：Sidebar 分组正确、Toast 弹出、Dialog 确认流程、dark mode 切换

---

## 不在本阶段范围内

- i18n en.ts 补全（由用户自行完成）
- P3.5：`/api/v1/*` router 拆分、E2E 测试、移除 legacy `/api/*` 别名
