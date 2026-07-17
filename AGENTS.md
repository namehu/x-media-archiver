# AGENTS.md

本文件为在 `x-media-archiver` 仓库中工作的自动化代理提供项目级约束和执行入口。开始改动前先阅读本文件与任务直接涉及模块的 `README` / `docs` 文档。

## 项目概览

`x-media-archiver` 是本地优先的 X/Twitter 媒体归档工具。主流程为：

```text
浏览器扩展或本地文件收集 tweet URL
  -> Postgres 中的 archive_runs / archive_run_items 队列
  -> Python CLI / FastAPI worker 下载、回填与校验
  -> React WebUI 查看与操作归档数据
```

核心原则：

- 媒体文件落在 `archive/media/<author_id>/<tweet_id>/`，目录稳定标识使用 `author_id`，不使用易变化的用户名。
- API、WebUI 和 CLI 共享数据库任务模型；TXT/JSONL 文件仅是输入适配器，不是运行时队列。
- 下载、回填、校验等写操作必须保持可恢复、可审计；全量磁盘扫描必须是显式维护动作。
- 不提交 cookies、生产连接串、下载出的媒体文件或其他用户隐私数据。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `cli/xarchiver/` | Python 3.12 CLI、归档内核、FastAPI API 与共享 services |
| `cli/tests/` | Python 单元测试及集成测试 |
| `cli/xarchiver/alembic/` | Alembic 数据库迁移 |
| `webui/` | Vite + React + TypeScript + Tailwind 管理界面 |
| `extension/` | WXT + React 浏览器采集扩展 |
| `docs/` | 部署、备份、下载契约与设计文档 |
| `examples/` | 可导入的示例 TXT / JSONL |
| `archive/` | 本地运行输出，不应放入源代码资产 |
| `secrets/` | 本地凭证目录，实际凭证不得提交 |

## 开发与运行命令

### Python CLI / API

优先通过 Docker Compose 使用与实际运行一致的环境：

```bash
docker-compose build xarchiver
docker-compose run --rm xarchiver init /app/archive
docker-compose run --rm xarchiver db migrate
docker-compose run --rm --service-ports xarchiver serve
```

API 默认地址为 `http://127.0.0.1:18000`。数据库和归档目录配置见 `.env.example` 与 `docker-compose.yml`。

### WebUI

```bash
cd webui
npm install
npm run dev
npm run build
```

开发服务器默认监听 `http://127.0.0.1:5173`，并将 `/api` 与 `/health` 代理到本地 API。

### 浏览器扩展

```bash
cd extension
npm install
npm run dev
npm run typecheck
npm run build
npm run zip
```

扩展只面向 `x.com` 与 `twitter.com` 页面采集当前浏览器可见的 tweet 信息。文案同时维护 `extension/public/_locales/en/messages.json` 与 `extension/public/_locales/zh_CN/messages.json`。

## 实现约束

### 后端与数据

- CLI 与 API 可共用的业务流程放在 `cli/xarchiver/services/`；避免在 HTTP 路由或 CLI 命令中重复实现归档规则。
- API 写操作当前由进程内锁串行化；新增写入口必须保持此行为或明确更新其并发策略和测试。
- 常规归档流程应使用 scoped 下载、回填与校验；不要将全库扫描隐式加入普通请求。
- 修改数据库结构时只新增 Alembic revision。禁止修改已发布的历史 revision 来变更现状。
- 数据库查询与 DML（`select` / `insert` / `update` / `delete` / `upsert`）默认使用 SQLAlchemy Core，表定义集中在 `cli/xarchiver/tables.py`，编译入口使用 `cli/xarchiver/sql_builder.py`。
- 查询结果在 service 边界优先映射为 `cli/xarchiver/row_models.py` 中的 Pydantic row model；API page 响应返回前应转换为普通 `dict`，避免 response schema 直接接收内部 row model。
- 固定 SQL 字符串仅允许用于 Alembic 迁移、Postgres advisory lock、SQLAlchemy Core 难以合理表达的数据库特性，或已有历史代码的渐进迁移场景；新增固定 SQL 必须在代码旁说明原因。不要为追求 ORM 化而引入 SQLAlchemy ORM / SQLModel。
- 数据库查询、API 响应和日志中不得暴露 `COOKIE_FILE` 内容、生产 `DATABASE_URL` 或其他凭据。

### WebUI

- API 请求集中在 `webui/src/lib/api.ts`，页面保持以展示、筛选和用户交互为主。
- 复用 `webui/src/components/ui/` 的已有组件和 `AppLayout`，保持后台界面的信息密度与交互风格一致。
- 用户触发 full backfill、full verify 或媒体物理删除时必须保留显式确认语义。媒体删除必须按 `media_assets.id` 精确执行，限制在 `archive/media` 内，保留 Tweet 与任务历史并记录删除审计；禁止目录通配或隐式递归删除。
- **WebUI 不使用国际化机制**：当前界面仅维护中文文案，用户可见文案直接写在对应页面或组件中。
- 禁止新增或恢复 `locales`、翻译 key、`I18nProvider`、`useI18n` 等 WebUI 国际化基础设施；除非用户明确提出重新引入国际化并单独确认技术方案。
- **组件文件命名规范**：所有 React 组件文件（`.tsx`）必须采用 kebab-case 小写横杠命名格式，仅包含小写英文字母、数字与横杠（`-`），禁止使用 PascalCase 大写驼峰、下划线或混合命名。组件内导出的具名导出（如 `export function`）仍使用 PascalCase，文件路径使用 kebab-case，两者独立。
- **pages 目录层级规范**：`webui/src/pages/` 下的一级子目录均为独立页面，每个页面目录必须包含 `index.tsx` 作为页面入口文件。页面私有的子组件、面板、标签页等统一放入对应页面目录下的 `components/` 文件夹；页面专用的 hooks、types、utils 等模块可保留在页面目录根级别。不得在页面目录根级别散落组件文件。

### Extension

- 仅收集和导出 tweet URL / 元数据，不在扩展内实现归档下载逻辑。
- 保持 TXT、JSONL 和扫描统计输出格式与 CLI / WebUI 输入契约兼容。
- 修改内容脚本选择器或自动滚动行为时，优先考虑 X 页面 DOM 变化和重复采集的去重行为。

## 测试与交付检查

默认验证策略：

- 代理完成代码改动后，默认只运行轻量检查，例如 `git diff --check`、局部 `typecheck` 或非常小的定向测试；不要静默执行全量验证。
- 下表中的后端完整单测、WebUI build 与 API/WebUI 真实联调属于完整交付验证，默认由代理按需执行，不要求用户本地先默认跑一遍。
- 如果用户判断某次改动风险较高、希望自己先验证，会明确说明原因；未明确说明前，不假设用户需要先跑全量检查。

完整交付验证基线：

| 改动范围 | 最低验证 |
| --- | --- |
| `cli/xarchiver/`、`cli/tests/` | `docker-compose run --rm --entrypoint python xarchiver -m unittest discover -s /app/tests` |
| `webui/` | 在 `webui/` 运行 `npm run build` |
| `extension/` | 在 `extension/` 运行 `npm run typecheck` 与 `npm run build` |
| API 与 WebUI 联动 | 启动 API 与 WebUI，检查涉及页面及对应 API 流程 |

涉及状态流转、任务重试、下载文件路径、迁移或维护命令的改动，应补充或更新测试。涉及界面的改动，应在桌面及窄屏视口检查布局、加载态、空态和错误态。

## 文档同步

出现以下变更时同步更新 `README.md` 或 `docs/` 中对应说明：

- 新增或调整 CLI 命令、API endpoint、环境变量或 Docker 启动方式。
- 修改归档文件路径、状态规则、队列行为、来源扫描或输入/输出格式。
- 新增数据库迁移、部署要求、备份恢复步骤或安全注意事项。

## 工作准则

- 先检查当前工作树状态，保留用户已有改动，不擅自重置或覆盖无关文件。
- 将改动限定在任务需要的模块；避免夹带无关格式化、依赖更新或重构。
- 不对真实 X 账号执行批量请求或下载测试，除非用户明确要求并提供可用的本地配置。
- 不把 `archive/`、`secrets/`、`.env` 或扩展导出的真实用户数据纳入提交。
