# Design System Tokens — 白蓝清爽风 (Pixiv-like)

> 版本: v1.0  
> 日期: 2026-05-28  
> 主文档: [phase-4-ui-revamp-plan.md](./phase-4-ui-revamp-plan.md)  
> 配套: [webui-component-inventory.md](./webui-component-inventory.md)

本文档定义 Phase 4 重构使用的全部设计 token,作为 `webui/src/styles.css` 与 `webui/tailwind.config.js` 修改的权威依据。所有 ui-next 组件必须只引用本文档定义的 token,不允许内联颜色/字号/阴影/动效魔数。

---

## 一、设计原则:白蓝风的设计立场

参考 Pixiv 的视觉处方:

| 原则 | 落地 |
|---|---|
| 白底为主 | 缩略图与媒体内容是绝对主角,UI chrome 让位 |
| 单色主导 | Pixiv 蓝(`hsl(206 100% 49%)` ≈ `#0096FA`)作唯一品牌色 |
| 高密度 + 字号层次 | 不靠装饰,靠字重/字号/留白制造呼吸感 |
| 扁平 + 必要 elevation | 默认无阴影,仅在 elevation 必要处加 1px 阴影 |
| 暗色等同质量 | 暗色不是凑数版本,token 完整对应,首次启动支持选择 |

**色彩立场**: 放弃当前深绿(`168 61% 28%`) + 米色(`42 24% 98%`)的"绿茶感"组合。新主色采用更鲜亮的电光蓝,辅以青蓝同色系层次,状态色四档(success/warning/danger/info)独立,**不复用 brand**。

---

## 二、色彩 Token

### 2.1 完整表

所有颜色用 HSL 表示(便于 `hsl(var(--token) / <alpha>)` 灵活叠加透明度)。

| Token | Light 值 | Dark 值 | 用途 |
|---|---|---|---|
| `--bg-base` | `0 0% 100%` | `215 28% 9%` | 页面底色(body) |
| `--bg-surface` | `210 20% 98%` | `215 24% 12%` | 卡片底 |
| `--bg-elevated` | `0 0% 100%` | `215 22% 16%` | Dialog/Popover/Sheet 浮层底 |
| `--bg-muted` | `214 32% 96%` | `215 20% 18%` | 输入框、tag 弱底、disabled 底 |
| `--border-subtle` | `214 22% 92%` | `215 18% 22%` | 卡片描边、分隔线默认 |
| `--border-strong` | `214 16% 84%` | `215 16% 30%` | 输入边框、hover 描边 |
| `--fg-primary` | `215 28% 17%` | `210 20% 96%` | 主文本(标题、正文) |
| `--fg-secondary` | `215 16% 38%` | `215 12% 70%` | 次文本(label、metadata) |
| `--fg-tertiary` | `215 12% 56%` | `215 10% 50%` | 弱文本(placeholder、提示) |
| `--brand` | `206 100% 49%` | `206 92% 60%` | **Pixiv 蓝**,主色(按钮、链接、icon) |
| `--brand-hover` | `206 100% 42%` | `206 92% 66%` | hover 时的加深(亮)/提亮(暗) |
| `--brand-soft` | `206 100% 49%` (用 `/.08`) | `206 92% 60%` (用 `/.12`) | 主色弱底(选中态、tag 底) |
| `--accent` | `196 88% 56%` | `196 82% 65%` | 青蓝,同色系层次(Live、最新) |
| `--success` | `152 60% 42%` | `152 56% 52%` | verified、成功 |
| `--warning` | `38 92% 50%` | `38 88% 58%` | retry、警告 |
| `--danger` | `354 76% 52%` | `354 72% 60%` | failed、destructive |
| `--info` | (同 brand) | (同 brand) | 信息态 |

### 2.2 CSS 变量代码模板

将以下内容写入 [`webui/src/styles.css`](../../webui/src/styles.css)(替代当前 1-34 行):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* === Background === */
  --bg-base: 0 0% 100%;
  --bg-surface: 210 20% 98%;
  --bg-elevated: 0 0% 100%;
  --bg-muted: 214 32% 96%;

  /* === Border === */
  --border-subtle: 214 22% 92%;
  --border-strong: 214 16% 84%;

  /* === Foreground === */
  --fg-primary: 215 28% 17%;
  --fg-secondary: 215 16% 38%;
  --fg-tertiary: 215 12% 56%;

  /* === Brand & Accent === */
  --brand: 206 100% 49%;
  --brand-hover: 206 100% 42%;
  --brand-soft: 206 100% 49%;        /* 透明度由 utility 决定 */
  --accent: 196 88% 56%;

  /* === Status === */
  --success: 152 60% 42%;
  --warning: 38 92% 50%;
  --danger: 354 76% 52%;
  --info: 206 100% 49%;

  /* === Elevation (shadow) === */
  --shadow-1: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-2: 0 4px 12px rgba(15, 23, 42, 0.06);
  --shadow-3: 0 12px 32px rgba(15, 23, 42, 0.10);

  /* === Motion === */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 360ms;

  /* === Typography === */
  font-family:
    "Inter", "Noto Sans SC", ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-feature-settings: "tnum", "ss01";
  color: hsl(var(--fg-primary));
  background: hsl(var(--bg-base));
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

.dark {
  --bg-base: 215 28% 9%;
  --bg-surface: 215 24% 12%;
  --bg-elevated: 215 22% 16%;
  --bg-muted: 215 20% 18%;

  --border-subtle: 215 18% 22%;
  --border-strong: 215 16% 30%;

  --fg-primary: 210 20% 96%;
  --fg-secondary: 215 12% 70%;
  --fg-tertiary: 215 10% 50%;

  --brand: 206 92% 60%;
  --brand-hover: 206 92% 66%;
  --brand-soft: 206 92% 60%;
  --accent: 196 82% 65%;

  --success: 152 56% 52%;
  --warning: 38 88% 58%;
  --danger: 354 72% 60%;
  --info: 206 92% 60%;

  /* 暗色阴影几乎不可见,改用 inset 高光 + border */
  --shadow-1: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --shadow-2: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 4px 12px rgba(0, 0, 0, 0.32);
  --shadow-3: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 12px 32px rgba(0, 0, 0, 0.48);
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: hsl(var(--bg-base));
  color: hsl(var(--fg-primary));
}

a { color: inherit; }
button, input, select, textarea { font: inherit; }
.tabular-nums { font-variant-numeric: tabular-nums; }
```

### 2.3 Tailwind 配置扩展

[`webui/tailwind.config.js`](../../webui/tailwind.config.js) 扩展:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // bg
        "bg-base": "hsl(var(--bg-base))",
        "bg-surface": "hsl(var(--bg-surface))",
        "bg-elevated": "hsl(var(--bg-elevated))",
        "bg-muted": "hsl(var(--bg-muted))",
        // border
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        // fg
        "fg-primary": "hsl(var(--fg-primary))",
        "fg-secondary": "hsl(var(--fg-secondary))",
        "fg-tertiary": "hsl(var(--fg-tertiary))",
        // brand
        brand: {
          DEFAULT: "hsl(var(--brand))",
          hover: "hsl(var(--brand-hover))",
          soft: "hsl(var(--brand-soft) / 0.08)",
        },
        accent: "hsl(var(--accent))",
        // status
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        danger: "hsl(var(--danger))",
        info: "hsl(var(--info))",
      },
      borderRadius: {
        md: "6px",
        lg: "10px",
        xl: "14px",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "360ms",
      },
      fontSize: {
        xs: ["11px", { lineHeight: "1.55" }],
        sm: ["13px", { lineHeight: "1.55" }],
        base: ["14px", { lineHeight: "1.55" }],
        lg: ["16px", { lineHeight: "1.5" }],
        xl: ["20px", { lineHeight: "1.4" }],
        "2xl": ["28px", { lineHeight: "1.25" }],
        "3xl": ["36px", { lineHeight: "1.1" }],
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        breathe: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.55" } },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        breathe: "breathe 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
```

### 2.4 兼容旧 token(过渡期)

为不破坏 [`components/ui/`](../../webui/src/components/ui/) 旧组件,**保留旧 token 一段时间** 并在 `:root` / `.dark` 加映射:

```css
:root {
  /* legacy tokens (deprecated, removed after M3) */
  --border: var(--border-subtle);
  --background: var(--bg-base);
  --foreground: var(--fg-primary);
  --muted: var(--bg-muted);
  --muted-foreground: var(--fg-secondary);
  --primary: var(--brand);
  --primary-foreground: 0 0% 100%;
  --accent-foreground: 0 0% 100%;
  --destructive: var(--danger);
}
```

M3 完成后(所有页面已切换到 ui-next),删除 legacy 部分。

---

## 三、字体系统

### 3.1 字族

| 角色 | 字体 |
|---|---|
| 英文 + 数字 | `Inter` |
| 中文 fallback | `"Noto Sans SC"`(系统通常已装,无需 webfont) |
| 等宽(ID、code) | `JetBrains Mono`, `ui-monospace`, `SFMono-Regular` |

不需要新增 webfont 包,全部走系统字体回退即可。

### 3.2 字重三档

| Class | 字重 | 用途 |
|---|---|---|
| `font-medium` (500) | 默认 | 正文、按钮、表单 |
| `font-semibold` (600) | 强调 | 标题、卡片 title |
| `font-bold` (700) | 突出 | Hero 大数字、品牌字 |

### 3.3 字号七档

| Class | 像素 | 行高 | 用途 |
|---|---|---|---|
| `text-xs` | 11px | 1.55 | metadata、徽章、tooltip |
| `text-sm` | 13px | 1.55 | 表单 label、辅助文本 |
| `text-base` | 14px | 1.55 | 正文默认 |
| `text-lg` | 16px | 1.5 | 卡片标题 |
| `text-xl` | 20px | 1.4 | 区块小标题 |
| `text-2xl` | 28px | 1.25 | StatCard 数字、页面 H1 |
| `text-3xl` | 36px | 1.1 | Hero 主数字 |

### 3.4 数字策略

- 全局 `font-feature-settings: "tnum", "ss01"`(已在 `:root` 中设置)
- 统计数字额外加 `tabular-nums` class 强制等宽数字,避免动态变化时跳动:

```jsx
<div className="text-3xl font-bold tabular-nums">{count}</div>
```

---

## 四、间距与圆角

### 4.1 间距

严格只使用以下 Tailwind 档(`p-*` / `m-*` / `gap-*` / `space-*`):

```
1 → 4px    2 → 8px    3 → 12px    4 → 16px    6 → 24px    8 → 32px    12 → 48px
```

禁止 `p-5`、`p-7`、`p-9` 等"奇数"档,以维持节奏感。

### 4.2 圆角三档

| Class | 像素 | 用途 |
|---|---|---|
| `rounded-md` | 6px | Button / Input / Badge / Tooltip |
| `rounded-lg` | 10px | Card / Sheet 内部块 |
| `rounded-xl` | 14px | Dialog / Sheet 容器 / CommandPalette |

**当前全局 `rounded-md` 过单调** — 卡片升 `rounded-lg` 是立即提升精致感的最低成本改动。

---

## 五、Elevation 体系

### 5.1 亮色三档

| Class | 阴影值 | 用途 |
|---|---|---|
| `shadow-1` | `0 1px 2px rgba(15,23,42,.04)` | Card 默认 |
| `shadow-2` | `0 4px 12px rgba(15,23,42,.06)` | Card hover / Popover / Tooltip |
| `shadow-3` | `0 12px 32px rgba(15,23,42,.10)` | Dialog / Sheet / Toast |

### 5.2 暗色策略

暗色下阴影几乎不可见,改用:

- `inset 0 1px 0 rgba(255,255,255,.04)` 内高光做边缘提亮
- `border-subtle` 描边补层次感
- 极轻 `bg-gradient-to-b from-white/[.02] to-transparent` 模拟分层(可选,慎用)

token 已在 `.dark` 段中对应替换,组件层只需 `shadow-1/2/3` 即可,无需感知亮暗。

### 5.3 使用规则

- Card 默认 `shadow-1`,hover `shadow-2`
- 浮层(Dialog / Sheet / Popover)用 `shadow-3`
- 不要在按钮/输入框上加阴影 — 它们靠 border 区分

---

## 六、Motion 规范

### 6.1 时长与 easing

| Token | 值 | 用途 |
|---|---|---|
| `duration-fast` | 120ms | hover / focus / 状态切换 |
| `duration-base` | 200ms | 展开 / 淡入 / 缩略图过渡 |
| `duration-slow` | 360ms | 页面过渡 / Sheet 入场 |
| `ease-out` | `cubic-bezier(.16,1,.3,1)` | 默认 easing |
| `ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Dialog / Sheet / 弹出感 |

### 6.2 微交互模式 (Pattern)

| 元素 | 默认 | hover | active | focus |
|---|---|---|---|---|
| Button | `shadow-none border-subtle` | `bg-brand-hover -translate-y-px brightness-105` | `translate-y-0` | `ring-2 ring-brand/50` |
| Card | `shadow-1 border-subtle` | `shadow-2 border-strong` | — | — |
| List item | `bg-bg-surface` | `bg-bg-muted` | `bg-brand-soft` | — |
| Badge | 静态 | — | — | — |
| Status dot | 静态(`bg-success`/`warning`/`danger`) | — | — | running 态 `animate-breathe` |
| 数字变化 | — | — | — | count-up 200-400ms(用 `react-countup` 或自实现) |

### 6.3 焦点环统一

所有可交互元素必须有可见 focus-ring:

```jsx
className="focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2"
```

---

## 七、主题切换实现

### 7.1 CSS class 机制

Tailwind `darkMode: "class"`,通过给 `<html>` 加 `.dark` 切换。

### 7.2 用户偏好持久化

```ts
// webui/src/lib/theme.ts
type Theme = "light" | "dark" | "system";
const KEY = "x-archiver-theme";

export function getStoredTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || "system";
}

export function applyTheme(t: Theme) {
  const isDark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  localStorage.setItem(KEY, t);
}
```

入口 `main.tsx` 顶部立即执行 `applyTheme(getStoredTheme())`,避免主题闪烁(FOUC)。

### 7.3 首次启动提示

首次进入应用(localStorage 无 key),默认 `system`,顶栏 ThemeSwitcher 高亮 1.5s + Tooltip 提示"已根据系统色板选用浅色 / 深色,可手动切换"。

---

## 八、可访问性自检清单

实施时必须逐项验证:

- ☐ **对比度**:
  - `fg-primary` on `bg-base` ≥ 7:1(AAA)
  - `fg-secondary` on `bg-base` ≥ 4.5:1(AA)
  - `brand` on `bg-base` ≥ 4.5:1(AA,Pixiv 蓝在白底约 4.6:1,临界值,实施时用 [contrast-checker](https://webaim.org/resources/contrastchecker/) 验证)
- ☐ **焦点可见**: 所有可交互元素 Tab 后能看到 `ring-2 ring-brand/50`
- ☐ **键盘导航**: Dialog/Sheet ESC 关闭 + focus trap
- ☐ **ARIA**: Dialog 用 `role="dialog"` + `aria-labelledby`;状态徽章用 `aria-label` 说明
- ☐ **媒体替代**: `<img>` 必须有 `alt`(空字符串也行,但属性不能省)
- ☐ **运动减弱**: `@media (prefers-reduced-motion)` 下禁用 `animate-shimmer`/`animate-breathe`

---

## 九、Token 命名约定 (供 ui-next 实施)

| 类别 | 前缀 | 例 |
|---|---|---|
| 背景 | `bg-` | `bg-base`, `bg-surface`, `bg-muted` |
| 文本 | `fg-` | `fg-primary`, `fg-secondary` |
| 边框 | `border-` | `border-subtle`, `border-strong` |
| 品牌 | `brand` / `brand-hover` / `brand-soft` | `bg-brand`, `text-brand`, `bg-brand-soft` |
| 状态 | 语义名 | `text-success`, `bg-warning`, `border-danger` |
| 阴影 | `shadow-N` | `shadow-1/2/3` |
| 圆角 | `rounded-{md\|lg\|xl}` | `rounded-lg` |
| 动效 | `duration-{fast\|base\|slow}` + `ease-{out\|spring}` | `duration-base ease-out` |

ui-next 组件源码中**禁止出现** `#0096FA` / `hsl(206 100% 49%)` / `0.5rem` 等魔数,必须走 token。

---

## 十、变更与版本

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-05-28 | 初版,白蓝清爽风定调,17 个色 token、7 档字号、3 档圆角、3 档阴影、3 档动效 |
