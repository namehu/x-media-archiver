# Phase 4 后端独立任务清单 (委派指南)

> 版本: v1.0  
> 日期: 2026-05-28  
> 主文档: [phase-4-ui-revamp-plan.md](./phase-4-ui-revamp-plan.md)  
> 适用对象: 接手 Phase 4 后端改造的开发者

本文档把 Phase 4 主计划第六节「后端架构优化(克制版 P0/P1)」拆成 5 个**独立可委派**的工程任务,**完全不依赖 WebUI 重构**,可与前端并行推进。每项任务自成 PR、独立验收、独立合入。

---

## 一、整体说明

### 1.1 背景

x-media-archiver 是本地优先的 X/Twitter 媒体归档系统。后端 Python 3.12 + FastAPI + PostgreSQL,P3 阶段已完成 API 收口与 SSE 事件流,本次 P4 阶段顺手收掉若干稳定性 / 一致性隐患。

**明确不做**:Redis / RQ / arq / Celery / pgbouncer / 消息队列 / 分布式锁 / 企业级速率限制 — 当前是单用户本地工具,这些都用不上。

### 1.2 推荐执行顺序

| 顺序 | 任务 | 工作量 | 依赖 | 可并行? |
|---|---|---|---|---|
| 1 | T1: API 契约 CI 校验 | S(0.5–1 天) | 无 | ✅ 与 T2/T3 可并行 |
| 2 | T2: 媒体代理流式 + Range | S(1 天) | 无 | ✅ 与 T1/T3 可并行 |
| 3 | T3: psycopg_pool 连接池 | S(0.5 天) | 无 | ✅ 与 T1/T2 可并行 |
| 4 | T4: Worker lease 持久化 | M(2–3 天) | 建议在 T3 后 | ⚠️ 含 DB 迁移,串行 |
| 5 | T5: 写锁分粒度 | M(2 天) | 建议在 T4 后 | ⚠️ 改 services 调用面,串行 |

**总工作量**:5–7.5 人日。

**最低可上线集合**:T1 + T2 + T3(2 天内可全部 ship,前端 M2 重构开始前就位)。  
T4 / T5 是 P0/P1 真痛点,稍晚但不影响前端工作。

---

## 二、任务详情

### T1 — API 契约 CI 校验 🔥 (优先,S 级,~0.5–1 天)

**优先级**:P0 · **可并行**:✅

#### 现状

- 前端 [`webui/src/api/generated.ts`](../../webui/src/api/generated.ts) 由 [`webui/package.json`](../../webui/package.json) 中的 `npm run generate:api-types` 手动生成
- 后端改 schema 时,如果忘记跑该命令,前后端类型会漂移,但 CI 不会拦截
- Phase 4 前端要大量改类型相关代码,这个隐患必须先收

#### 交付物

- `.github/workflows/api-contract.yml`(新增)
- 校验脚本(放在 `scripts/check_api_contract.sh` 或类似路径)

#### 实施步骤

1. CI workflow 中:
   - 启动 backend(可用现有 `docker-compose -f docker-compose.yml run --rm xarchiver` 或直接 Python 调用 `create_app().openapi()`)
   - dump 当前 `openapi.json` 到临时文件
   - 用 `openapi-typescript` 重新生成一份临时 `generated.ts`
   - `diff` 临时生成的 vs 仓库里现有的 `webui/src/api/generated.ts`
   - diff 非空 → `exit 1`,CI fail
2. PR 描述里给出修复指引:"运行 `cd webui && npm run generate:api-types` 后重新提交"

#### 关键文件参考

- 现有生成命令在 [`webui/package.json:8`](../../webui/package.json) 的 `generate:openapi` 与 `sync-types`
- FastAPI app 入口 [`cli/xarchiver/api/app.py`](../../cli/xarchiver/api/app.py)

#### 验收

- ☐ 故意修改一个 Pydantic 模型字段不重生 `generated.ts` → 提 PR → CI fail,错误信息可读
- ☐ 重新跑 `generate:api-types` 提交后 → CI 通过
- ☐ workflow 在主线 PR 上稳定 < 90 秒

---

### T2 — 媒体代理流式 + Range 支持 🔥 (优先,S 级,~1 天)

**优先级**:P1 · **可并行**:✅ · **WebUI M2 需要**

#### 现状

- 媒体文件代理 endpoint(`GET /api/v1/media-file/{path}`)位于 [`cli/xarchiver/api/v1/misc.py`](../../cli/xarchiver/api/v1/misc.py),疑似全量加载入内存后返回
- WebUI Library 重构(M2)要做缩略图网格 + 4K 视频预览,**没有 Range 支持视频会卡顿、缩略图加载会慢**

#### 交付物

- 改造 media-file endpoint 为 `StreamingResponse` + 分块迭代 + `Range` header 处理

#### 实施步骤

1. 路径安全检查保留(防目录穿越)
2. 解析 `Range: bytes=N-M` header(允许 `bytes=N-`、`bytes=-M`、`bytes=N-M`)
3. 用 `aiofiles` 或同步 `open(...,'rb')` + `iter_bytes(chunk_size=64*1024)`
4. 命中 Range → 返回 `206 Partial Content`,`Content-Range: bytes N-M/total`,`Content-Length: M-N+1`
5. 未命中 → 返回 `200`,完整 `Content-Length`
6. `Accept-Ranges: bytes` header 永远带上
7. `Content-Type` 按文件后缀推断(`mimetypes.guess_type`)
8. 不引入新依赖,FastAPI 自带 `StreamingResponse` 即可

#### 验收

- ☐ `curl -v -H "Range: bytes=0-1023" http://localhost:8000/api/v1/media-file/<path>` 返回 `206 Partial Content` + `Content-Range`
- ☐ 不带 Range header 时返回 `200` + 完整文件
- ☐ Chrome `<video>` 标签播放 4K 视频,Network 面板显示多个分段请求,可拖动进度条边播边加载
- ☐ 路径穿越攻击(`../../../etc/passwd`)被拒绝
- ☐ 无新增 dependencies(检查 `cli/pyproject.toml` 不变)

#### 关键文件参考

- [`cli/xarchiver/api/v1/misc.py`](../../cli/xarchiver/api/v1/misc.py)(media-file endpoint)
- [`cli/xarchiver/archive.py`](../../cli/xarchiver/archive.py)(本地路径解析参考)

---

### T3 — psycopg_pool 连接池 (S 级,~0.5 天)

**优先级**:P1 · **可并行**:✅

#### 现状

- [`cli/xarchiver/db.py`](../../cli/xarchiver/db.py) 直接用 `psycopg.connect()`,无连接池
- API 高并发(SSE 长连接 + 多页面同时打开)时会频繁开关连接,影响性能

#### 交付物

- 接入 `psycopg_pool.ConnectionPool`,配置 `min_size=2, max_size=10`
- 提供 `get_pool_stats()` 工具函数(暴露 active / idle / waiting)以便 T4 之后接入 Operations 页

#### 实施步骤

1. `cli/pyproject.toml` 添加 `psycopg_pool` 依赖
2. `cli/xarchiver/db.py` 中:
   - 创建模块级 `ConnectionPool(conninfo=settings.db_url, min_size=2, max_size=10, open=False)`
   - FastAPI lifespan 启动时 `pool.open()`,关闭时 `pool.close()`
   - 现有 `get_connection()` 等 factory 改为 `with pool.connection() as conn: yield conn`
3. CLI 入口(典型如 `cli.py` 的 db / sources 子命令)保留单连接路径,**不强制走 pool**(短生命周期,不必要)
4. 加 `get_pool_stats() -> dict` 返回 `{ "active": int, "idle": int, "waiting": int, "min_size": int, "max_size": int }`
5. 在 [`cli/xarchiver/services/health.py`](../../cli/xarchiver/services/health.py) 的 health detail 响应里加 `db_pool` 字段

#### 验收

- ☐ 应用启动时日志显示 pool 已创建
- ☐ `kill` 数据库连接,pool 自动重建,无 cascade 失败
- ☐ `/api/v1/health/detail` 返回包含 `db_pool: { active, idle, ... }`
- ☐ 单元测试:并发 20 个 query 不出错(pool 排队)
- ☐ 现有测试(`cli/tests/`)全绿

#### 关键文件参考

- [`cli/xarchiver/db.py`](../../cli/xarchiver/db.py)
- [`cli/xarchiver/api/app.py`](../../cli/xarchiver/api/app.py)(lifespan)
- [`cli/xarchiver/services/health.py`](../../cli/xarchiver/services/health.py)
- [`cli/pyproject.toml`](../../cli/pyproject.toml)

---

### T4 — Worker lease 持久化(软心跳)🛠 (P0,M 级,~2–3 天)

**优先级**:P0 · **建议在 T3 后** · **5 项中最值得花时间也最容易出 bug**

#### 现状

- 两个 daemon 线程(`archive-queue-worker` / `source-scan-worker`)在 [`cli/xarchiver/api/app.py`](../../cli/xarchiver/api/app.py) lifespan 中起
- 进程崩溃时,`archive_run_items` / `source_scan_runs` 中状态为 `running` / `processing` 的行**永远卡住**,需要手动清理
- P0 — 影响数据正确性,必须做

#### 交付物

- DB 迁移 `sql/009_worker_lease.sql`(新增)
- worker 启动时的 lease 回收逻辑
- worker 处理过程中的心跳续约逻辑

#### 实施步骤

1. **新建 SQL 迁移** [`sql/009_worker_lease.sql`](../../sql/):
   ```sql
   ALTER TABLE archive_run_items
     ADD COLUMN worker_id TEXT,
     ADD COLUMN lease_expires_at TIMESTAMPTZ,
     ADD COLUMN claimed_at TIMESTAMPTZ;

   ALTER TABLE source_scan_runs
     ADD COLUMN worker_id TEXT,
     ADD COLUMN lease_expires_at TIMESTAMPTZ,
     ADD COLUMN claimed_at TIMESTAMPTZ;

   -- 防止同一 item / scan_run 被两个 worker 同时认领
   CREATE UNIQUE INDEX archive_run_items_running_uniq
     ON archive_run_items (id) WHERE status IN ('processing', 'running');

   CREATE UNIQUE INDEX source_scan_runs_running_uniq
     ON source_scan_runs (id) WHERE status IN ('running', 'waiting_downloads');
   ```

2. **认领逻辑**(`SELECT ... FOR UPDATE SKIP LOCKED` 模式):
   ```sql
   UPDATE archive_run_items
   SET worker_id = $worker_id,
       claimed_at = NOW(),
       lease_expires_at = NOW() + INTERVAL '60 seconds',
       status = 'processing'
   WHERE id = (
     SELECT id FROM archive_run_items
     WHERE status IN ('pending', 'failed_retryable')
        OR (status = 'processing' AND lease_expires_at < NOW())
     ORDER BY id
     LIMIT 1
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```

3. **心跳续约**(每 20s 一次):
   ```python
   def heartbeat(item_id: int, worker_id: str) -> bool:
       """续约成功返回 True;失败(被别的 worker 抢了)返回 False,中断当前任务"""
       result = db.execute(
           "UPDATE archive_run_items "
           "SET lease_expires_at = NOW() + INTERVAL '60 seconds' "
           "WHERE id = %s AND worker_id = %s "
           "RETURNING id",
           (item_id, worker_id),
       )
       return result.fetchone() is not None
   ```

4. **Worker ID 生成**:`f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"`,每次进程启动重生成

5. **启动时回收日志**:启动时 `SELECT count(*) FROM archive_run_items WHERE status='processing' AND lease_expires_at < NOW()` 计数后写日志,便于诊断

6. **关键防重坑**:
   - lease 过期回收前必须检查是否真的没人续约(SQL 已保证)
   - 心跳失败的 worker 必须**立刻**停止当前任务,不能继续写 DB(否则会污染被抢占的 item)
   - 测试要包含「假崩溃」场景:让某个 worker sleep 90s,验证另一个 worker 能接管

7. **灰度策略**:发布后双跑一周(新代码 + 旧代码并存),对比 archive_run_items 的 stuck 计数变化,确认没退化再删旧路径

#### 验收

- ☐ 启动 worker → `kill -9 <worker pid>` → 重启 backend → 60 秒内 stuck 的 `processing` item 被新 worker 重认领
- ☐ 启动两个 backend 实例(模拟双 worker)→ 同一个 item 不会被同时处理(检查 worker_id 单调性)
- ☐ 心跳失败的 worker 中断当前任务,不会继续写 DB
- ☐ DB 迁移可重复执行(用 `IF NOT EXISTS` 守护)
- ☐ 现有 worker 测试 `cli/tests/test_queue.py` 等全绿
- ☐ 新增专门的崩溃恢复测试

#### 关键文件参考

- DB 迁移目录 [`sql/`](../../sql/)
- Worker 入口 [`cli/xarchiver/api/app.py`](../../cli/xarchiver/api/app.py) lifespan
- Worker 业务逻辑 [`cli/xarchiver/services/queue.py`](../../cli/xarchiver/services/queue.py), [`cli/xarchiver/services/sources.py`](../../cli/xarchiver/services/sources.py)
- 现有迁移管理 [`cli/xarchiver/migrations.py`](../../cli/xarchiver/migrations.py)

---

### T5 — 写锁分粒度 ⚙️ (P1,M 级,~2 天)

**优先级**:P1 · **建议在 T4 后** · **改动面较大**

#### 现状

- [`cli/xarchiver/api/deps.py`](../../cli/xarchiver/api/deps.py) 中的 `write_action_lock` 是**全局单一锁**
- 多个 source 并发扫描时互相阻塞 — 一个 source 慢会拖累其他 source 的扫描
- 多个 archive_run 并发处理时同理

#### 交付物

- 新建 `cli/xarchiver/core/lock_manager.py`(或类似路径)
- 替换所有现有 `write_action_lock` 调用点

#### 实施步骤

1. **设计 LockManager**:
   ```python
   from asyncio import Lock
   from contextlib import asynccontextmanager
   from collections import defaultdict

   class LockManager:
       def __init__(self):
           self._locks: dict[str, Lock] = defaultdict(Lock)
           self._meta_lock = Lock()  # 保护 _locks 字典本身

       @asynccontextmanager
       async def acquire(self, scope: str):
           """scope 例:'global', 'source:42', 'run:1789'"""
           async with self._meta_lock:
               lock = self._locks[scope]
           async with lock:
               yield
   ```

2. **使用约定**:
   - DB 全表 / schema 级写操作(如维护操作)→ `scope="global"`
   - 单个 source 的扫描 / 状态更新 → `scope=f"source:{source_id}"`
   - 单个 run 的 item 处理 → `scope=f"run:{run_id}"`
   - 跨 source / 跨 run 的查询不需要锁(只读)

3. **替换现有调用点**:
   - 排查 [`cli/xarchiver/services/`](../../cli/xarchiver/services/) 下所有 `write_action_lock` 引用
   - 按业务语义分配 scope
   - 全局锁路径只保留:维护操作(verify-all、export-all、recover-interrupted)

4. **避免死锁**:**严禁嵌套获取不同 scope** 的锁。如果一定要,固定顺序:`global > source:* > run:*`

5. **锁字典内存增长**:长时间运行后 `_locks` 字典会保留所有 source/run 的锁对象。**当前规模不必清理**(几百个 source × 几千个 run 的锁对象内存可忽略),但加个 TODO 注释。

#### 验收

- ☐ 同时触发两个 source 的扫描 → 二者互不阻塞(对比改前 wall time 应大幅下降)
- ☐ 维护操作(`/actions/verify`)能阻塞所有 source 扫描(全局锁有效)
- ☐ source 扫描互不阻塞 archive_run 处理
- ☐ 死锁压测:100 个并发任务,所有能完成,无超时
- ☐ 现有测试全绿

#### 关键文件参考

- [`cli/xarchiver/api/deps.py`](../../cli/xarchiver/api/deps.py)(现有 write_action_lock)
- [`cli/xarchiver/services/queue.py`](../../cli/xarchiver/services/queue.py)
- [`cli/xarchiver/services/sources.py`](../../cli/xarchiver/services/sources.py)
- [`cli/xarchiver/services/runs.py`](../../cli/xarchiver/services/runs.py)
- [`cli/xarchiver/services/maintenance.py`](../../cli/xarchiver/services/maintenance.py)(假设存在,实际看代码)

---

## 三、PR 与协作约定

### 3.1 单 PR 单任务

- 每个任务 = 一个 PR,**不要合并任务**
- T1 / T2 / T3 互相独立可以乱序合
- T4 / T5 因为 DB 迁移 + 锁结构改动较大,串行合,各自有 1-2 天观察期

### 3.2 PR 描述模板

```markdown
## 任务编号
T<N> — <task name>

## 验收对照
- [ ] 验收点 1(从本文档复制)
- [ ] 验收点 2
- ...

## 风险与回滚
<lease 类改动写明灰度策略;锁类改动写明性能对比数据>

## 测试
- [ ] 现有 cli/tests/ 全绿
- [ ] 新增专项测试覆盖 <场景>
```

### 3.3 合入次序示例

理想节奏(单人推进):

```
Day 1  AM: T1 (CI)         → 合入
Day 1  PM: T2 (Range)      → 合入
Day 2  AM: T3 (psycopg_pool) → 合入
Day 2  PM: T4 启动 (DB 迁移 + 认领逻辑)
Day 3       T4 心跳 + 测试   → 灰度合入
Day 4       T4 观察 + 收尾
Day 5       T5 启动
Day 6       T5 完成 → 合入
```

可并行(双人推进):一人 T1+T3+T4,另一人 T2+T5,两人 ~3 天完工。

---

## 四、与 WebUI 的集成点

虽然后端任务**不阻塞** WebUI,但完成后会自然产生若干集成点,WebUI 实施时直接消费:

| 后端任务 | WebUI 消费点 |
|---|---|
| T1 | 前端 PR CI 自动校验,无需手动同步 |
| T2 | Library 缩略图秒开;TweetDetail 视频边播边加载 |
| T3 | Operations 页系统状态 Tab 显示 `db_pool` 卡片(active / idle / waiting) |
| T4 | Operations 页可视化 worker 心跳与最近回收事件 |
| T5 | Sources 多源并发扫描时 UI 不卡(Sheet 详情切换更顺) |

---

## 五、有问题问谁

- 业务背景 / API 设计:看 [phase-3.4-plan.md](./phase-3.4-plan.md) 与 [x-media-archiver-v2-design.md](./x-media-archiver-v2-design.md)
- 测试体系:[engineering-ci-and-test-isolation.md](../engineering-ci-and-test-isolation.md)
- 部署 / DB 备份:[backup-restore.md](../backup-restore.md)
- 主计划 / WebUI 进度:[phase-4-ui-revamp-plan.md](./phase-4-ui-revamp-plan.md)
