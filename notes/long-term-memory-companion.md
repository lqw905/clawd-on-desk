# Clawd 长期记忆陪伴系统 —— 功能方案

> 创建日期：2026-06-07
> 状态：设计阶段

---

## 核心理念

让 Clawd 从一个"状态显示器"变成一个**认识你的伙伴**——它记得你什么时候写代码、你喜欢什么、你的成就和习惯。用得越久，它越懂你。

从冷冰冰的状态指示器，变成有温度的编程伙伴。

---

## 记忆体系架构

```
┌─────────────────────────────────────────────────┐
│                  记忆层次                         │
├─────────────────────────────────────────────────┤
│ Layer 3: 长期记忆  │ 里程碑、成就、习惯、纪念日    │
│ Layer 2: 中期记忆  │ 周报、项目切换、技能成长       │
│ Layer 1: 短期记忆  │ 当前会话状态（已有）           │
└─────────────────────────────────────────────────┘
```

**存储方案**：本地 JSON 文件（`<app-folder>/memory/`，与 App 同一个文件夹），不联网、隐私安全。便携设计——拷贝整个文件夹即可同步 App+记忆。

**留存策略**：渐进式摘要（Progressive Summarization）—— 不粗暴删除，而是把原始数据随时间"蒸馏"成更浓缩的形态。扔掉细节，保留洞察。

---

## 数据来源（无需 API）

| 数据 | 来源 |
|---|---|
| 每日编码时长 | state.js 已有的 session 计时 |
| Agent 调用次数 | state.js 已有的会话追踪 |
| Commit 数 | git hook 监听本地 `.git` |
| Token 消耗 | agent hook 上报的数据 |
| 连续打卡天数 | 系统时钟 + 本地快照对比 |
| 时间段判断 | `new Date()` |

所有数据 Clawd 已经在采集，只需持久化和加工。

---

## 功能模块

### A. 记忆引擎（Memory Engine）—— 新增核心模块

| 子功能 | 描述 |
|---|---|
| **每日快照** | 每天结束时自动记录：编码时长、agent 调用次数、token 消耗、commit 数、文件修改数 |
| **连续打卡** | 连续编码天数追踪，断签提醒 |
| **里程碑检测** | 第100次 commit / 第1000次 agent 调用 / 累计编码100小时 等自动触发庆祝 |
| **个人纪录** | 最长连续编码时长、最高单日 token 消耗、最早/最晚编码时间 |
| **习惯画像** | 学习你的作息：平时几点开始、周几最活跃、常用哪个 agent |

### B. 陪伴行为（Companion Behaviors）—— 增强 state 系统

| 场景 | Clawd 的反应 |
|---|---|
| **久别重逢** | 超过3天没打开 → 开心地跑过来、冒爱心 |
| **深夜编码** | 22点后 → 打哈欠、偶尔趴下、提示"该休息了" |
| **高强度工作** | 连续2小时+ → 流汗、喘气、递上一杯虚拟咖啡 |
| **周一早上** | 睡眼惺忪出现，伸懒腰 |
| **周五下午** | 兴奋蹦跳，"周末要来啦！" |
| **生日/纪念日** | 特殊帽子 + 蛋糕动画 |
| **突破纪录** | "今天是你今年写代码最久的一天！🎉" |

### C. UI 可视化架构

记忆系统的 UI 分三层，各司其职：

```
┌─────────────────────────────────────────────────────┐
│  入口层          │ 托盘右键菜单 "📖 Journal"          │
│                  │ Settings → Memory 页 → "Open Journal" │
├─────────────────────────────────────────────────────┤
│  主视图层        │ 独立 Journal Dashboard 窗口         │
│  (类比 Sessions  │ (独立的 BrowserWindow，有标题栏)    │
│   Dashboard)     │ 日历热力图 + 统计卡片 + 里程碑时间线 │
├─────────────────────────────────────────────────────┤
│  管理配置层      │ Settings → Memory 标签页            │
│                  │ 存储状态、导出数据、清除记忆、重置   │
└─────────────────────────────────────────────────────┘
```

**为什么 Journal 是独立窗口而不是 Settings 的一个 Tab：**

- Journal 是**浏览体验**，不是配置——用户打开它是为了看数据，不是为了改设置
- 日历热力图需要更大的空间，Settings 窗口偏窄
- 项目已有 Sessions Dashboard 的先例（`src/dashboard.js`），遵循同样的模式更一致
- 独立窗口可以随时打开、保持常驻，不影响 Settings

#### Journal Dashboard（独立窗口）

```
┌──────────────────────────────────────────────┐
│  📖 Clawd Journal                    ─ ×     │
├──────────────────────────────────────────────┤
│                                              │
│  🔥 15 天连续打卡  │  🦀 伙伴等级            │
│  ⏰ 累计 320 小时  │  🤖 Claude Code 78%     │
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  📅 2026年6月                            │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 6/1  ████████░░ 4.2h               │ │ │
│  │  │ 6/2  ██████████ 5.1h  🏆           │ │ │
│  │  │ 6/3  ██░░░░░░░░ 0.8h               │ │ │
│  │  │ 6/4  ██████████ 5.8h  🔥           │ │ │
│  │  │ ...                                 │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                          │ │
│  │  🏆 里程碑时间线                          │ │
│  │  ├─ 6/2  累计 100 次 commit              │ │
│  │  ├─ 5/20 累计 100 小时编码               │ │
│  │  └─ 5/12 单日最高 token: 520K            │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  [Export JSON]  [Clear All Data]             │
└──────────────────────────────────────────────┘
```

#### Settings → Memory 标签页（管理配置）

```
┌──────────────────────────────────────────────┐
│  Settings                            ─ ×     │
├──────────────────────────────────────────────┤
│  [General] [Agents] [Theme] ... [Memory]     │
├──────────────────────────────────────────────┤
│                                              │
│  📊 Memory Status                            │
│  ┌─────────────────────────────────────────┐ │
│  │ Storage: ~42KB                           │ │
│  │ Daily snapshots: 28 天                   │ │
│  │ Weekly aggregates: 8 周                  │ │
│  │ Monthly aggregates: 4 个月               │ │
│  │ Permanent records: 12 条                 │ │
│  │ Last cleanup: 2026-06-07 23:01           │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  [📖 Open Journal Dashboard]                 │
│                                              │
│  Danger Zone                                │
│  [Export All Data (.json)]                   │
│  [Clear Journal Data]                        │
│  [Reset Growth Level]                        │
└──────────────────────────────────────────────┘
```

### D. 成长系统（Growth）—— 长期绑定

| 等级 | 条件 | 解锁 |
|---|---|---|
| 🥚 初识 | 第1天 | 基础动画 |
| 🐣 熟悉 | 累计10小时 | 挥手动画、微笑 |
| 🦀 伙伴 | 累计50小时 + 30天 | 比心动画、特殊音效 |
| 🦀✨ 挚友 | 累计200小时 + 100天 | 全动画解锁、自定义昵称回应、纪念徽章 |

### E. Git 活动感知

| 事件 | Clawd 反应 |
|---|---|
| `git commit` | 举钳子（"干得好！"） |
| `git push` | 小火箭发射动画 |
| PR merged | 撒花/庆祝特效 |
| Merge conflict | 紧张/出汗动画 |
| Commit 含 "fix bug" | 擦汗 |

### F. 会话摘要（退出时）

关闭 Clawd 或结束一天工作时，弹出本次会话简要总结：
- 陪伴时间、agent 请求数、错误/成功次数
- 一句鼓励语

---

## 与之前方案的关系

```
长期记忆陪伴系统（顶层设计）
├── 🧠 记忆引擎 ─────────── 新增核心模块
├── 🎭 陪伴行为 ─────────── 心情系统 → 基于记忆的智能行为
├── 📖 编年史日记 ───────── 统计面板 → 有叙事的数据
├── 🎯 成长系统 ─────────── 成长系统 + 时间维度
├── 🎵 Git 活动 ─────────── 记忆引擎数据源之一
├── 📝 会话摘要 ─────────── 每日快照的素材来源
└── ☁️ GitHub Gist 同步 ─── 多机记忆同步，零服务器
```

---

## 实现路径

### Phase 1：记忆引擎 + 每日快照

- 新增 `src/memory-store.js` —— JSON 文件读写，按上述数据结构存储
- 新增 `src/memory-engine.js` —— 快照采集、打卡追踪、里程碑检测
- 新增 `src/memory-pruner.js` —— 渐进式摘要清理，写入时 + 空闲时触发
- 在 `src/state.js` 中接入，session 结束时写入快照
- 数据源：现有 state 的 session 信息 + Git commit hook

### Phase 2：Journal Dashboard + Settings Memory 页

- 新增 `src/journal-dashboard.js` —— 独立 BrowserWindow，日历热力图 + 统计卡片 + 里程碑时间线
- 新增 `src/preload-journal.js`、`src/journal-renderer.js` —— 渲染层
- Settings 新增 "Memory" 标签页 —— 存储状态、导出、清除管理
- 托盘菜单新增 "📖 Journal" 入口

### Phase 3：陪伴行为

- 新增 `src/companion.js` —— 读取记忆数据，决定行为
- 修改 `src/state.js` 状态判定逻辑，注入陪伴层
- 久别重逢、深夜关怀、纪录突破等触发
- 新增对应动画状态

### Phase 4：成长系统 + 纪念徽章

- 等级计算、徽章系统
- 解锁通知 + 特效
- 用户可查看已解锁内容

### Phase 5：GitHub Gist 多机同步

- 新增 `src/memory-sync.js` —— Push/Pull/Merge 逻辑
- Settings → Memory 页新增 GitHub Sync 配置区
- 启动时自动 Pull，快照写入后自动 Push
- 私有 Gist，零服务器成本

---

## 技术要点

| 点 | 方案 |
|---|---|
| **存储** | `<app-folder>/memory/` 目录（与 exe 同级），按留存层级分文件存储 |
| **大小** | 稳态后总大小 < 50KB（持续清理，不无限膨胀） |
| **隐私** | 纯本地，不联网，数据归用户所有 |
| **性能** | 启动时异步加载，清理在空闲时执行，不阻塞主循环 |
| **迁移** | 从零开始积累，无需历史数据 |
| **测试** | 每个新模块独立可测，mock 时间函数 |

---

## 记忆留存与清理策略

### 核心原则：扔掉细节，保留洞察

原始数据随时间贬值，但从数据中提取的**模式和记录**持续增值。与其无限堆积原始快照，不如将其逐步 "蒸馏"。

### 分层留存

```
原始快照
  │
  ├── 最近 30 天  → 保留全部每日快照
  │    日均 ~500B，30天 ≈ 15KB
  │
  ├── 31~90 天    → 按周聚合
  │    丢弃：每日细节
  │    保留：周总时长、最高单日、最常用 agent、commit 总数
  │
  ├── 91~365 天   → 按月聚合
  │    丢弃：周细节
  │    保留：月总时长、最高周、新增里程碑、月度 agent 分布
  │
  └── 永久层      → 永不丢弃
       保留：里程碑、个人纪录、成长等级、习惯画像
```

### 什么该扔，什么该留

| 该扔（随时间衰减） | 该留（永存） |
|---|---|
| 6月3日下午用了2.3小时 | 6月总编码时间 68 小时 |
| 那天调了14次 agent | 月均 agent 调用 320 次 |
| 各小时段的细粒度分布 | "你是个夜猫子，22点后产出最高" |
| 原始 token 消耗列表 | 单日最高纪录、总累计值 |
| 3 个月前某天 commit 了 3 次 | "第 100 次 commit 发生在 7 月 15 日" |

### 清理时机

不在启动时做（拖慢启动）。两个时机：

- **写入时顺手清理**：每日快照写入后，顺手检查并聚合过期数据（已经在写文件，零额外 I/O 开销）
- **空闲时异步清理**：如果写入时跳过了，在 Clawd 进入 sleeping 状态后异步执行（螃蟹在睡觉时整理记忆，很合理）

### 数据结构设计

```js
// <app-folder>/memory/index.json —— 轻量索引，启动时读取
{
  "streak": { "current": 15, "longest": 42, "lastActiveDate": "2026-06-07" },
  "totals": { "hours": 320, "commits": 1200, "agentCalls": 8500 },
  "records": { "longestSession": "6.2h", "highestDailyTokens": 520000, "date": "2026-05-12" },
  "profile": { "chronotype": "night_owl", "peakDay": "Tuesday", "topAgent": "claude-code" },
  "level": "crab_partner",
  "milestones": [
    { "type": "commit_100", "date": "2026-04-03" },
    { "type": "hours_100", "date": "2026-05-20" }
  ]
}

// <app-folder>/memory/snapshots.json  —— 近30天每日快照
[
  { "date": "2026-06-07", "hours": 5.1, "commits": 8, "agentCalls": 42, "tokens": 180000, "agents": { "claude-code": 35, "codex": 7 } }
]

// <app-folder>/memory/weeks.json     —— 31~90天，按周聚合
// <app-folder>/memory/months.json    —— 91~365天，按月聚合
```

### 实现模块

```js
// src/memory-pruner.js
const RETENTION = {
  daily:   30,   // 30天内保留每日细节
  weekly:  90,   // 90天内保留周聚合
  monthly: 365,  // 一年内保留月聚合
  // 永久层无过期（存于 index.json）
}

function prune(snapshots) {
  const now = Date.now()
  const ageInDays = s => (now - new Date(s.date).getTime()) / 86400000

  return {
    daily:   snapshots.filter(s => ageInDays(s) <= 30),
    weekly:  aggregateByWeek(snapshots.filter(s => ageInDays(s) > 30 && ageInDays(s) <= 90)),
    monthly: aggregateByMonth(snapshots.filter(s => ageInDays(s) > 90 && ageInDays(s) <= 365)),
    permanent: extractPermanent(snapshots),  // → 更新 index.json
  }
}
```

---

## 多机同步：GitHub Gist 方案

### 设计思路

不建服务器，用 GitHub 已有的基础设施——Gist 是天然的 "个人 JSON 云存储"，免费、私有、有版本历史。

```
┌──────────────────┐         ┌─────────────┐         ┌──────────────────┐
│  机器 A (公司)    │  Push   │  GitHub      │  Pull   │  机器 B (家里)    │
│  <app-folder>/memory │ ──────→ │  Gist        │ ──────→ │  <app-folder>/memory │
│                  │         │  (私有)      │         │                  │
│                  │ ←────── │              │ ←────── │                  │
│                  │  Pull   │              │  Push   │                  │
└──────────────────┘         └─────────────┘         └──────────────────┘
```

### 用户操作流

```
1. 在 GitHub Settings → Developer settings → Personal access tokens
   创建一个 token，只勾选 "gist" 权限，永不过期
   
2. 在 Clawd Settings → Memory → GitHub Sync
   粘贴 token，点击 "Connect"
   
3. Clawd 自动创建一个名为 "clawd-memory" 的私有 Gist
   
4. 之后每次编码结束，自动 Push ↑
   换到另一台机器，启动时自动 Pull ↓
```

### 数据格式

Gist 只需要一个文件：

```
Gist: clawd-memory (private)
└── memory.json    ← 整个 <app-folder>/memory/ 打包成一个 JSON
```

Gist 自身带版本历史，误操作了可以在 GitHub 上回滚。

### 合并策略

两台机器可能都有新数据，合并规则很简单：

| 数据类型 | 策略 |
|---|---|
| `index.json` 中的累计值（totals） | 取较大值（谁的值大说明谁累计得更久） |
| `index.json` 中的纪录（records） | 取较大值 |
| `index.json` 中的画像（profile） | 本地优先，远端补充缺失字段 |
| 快照/周/月数据 | 按日期合并，同一天的数据取较新的 |
| 里程碑列表 | 去重后并集 |
| 成长等级 | 取较高等级 |

### 同步触发时机

| 时机 | 操作 |
|---|---|
| Clawd 启动时 | 异步 Pull（不阻塞 UI） |
| 每日快照写入后 | 异步 Push |
| 用户在 Settings 点击 | 手动 Push / Pull |
| 连续 Push 失败 3 次 | 静默跳过，下次启动重试 |

### 安全设计

- Token 存在本地 `<app-folder>/memory/.gist-token`，不进入 Git
- Gist 默认创建为 **私有**（只有你自己能看到）
- 断网不影响 Clawd 正常运行，同步是纯可选的增强

### 实现模块

```js
// src/memory-sync.js
const GIST_ID_FILE = '<app-folder>/memory/.gist-id'
const TOKEN_FILE   = '<app-folder>/memory/.gist-token'

async function push() {
  const token = readToken()
  const gistId = readGistId()
  const data = packMemory()  // 打包全部 memory 文件
  await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ files: { 'memory.json': { content: data } } })
  })
}

async function pull() {
  const token = readToken()
  const gistId = readGistId()
  const res = await fetch(`https://api.github.com/gists/${gistId}`)
  const remote = JSON.parse(res.json().files['memory.json'].content)
  const merged = mergeMemory(local, remote)  // 按合并策略执行
  writeMemory(merged)
}
```

### 同步状态 UI

在 Settings → Memory 页底部：

```
┌──────────────────────────────────────────────┐
│  ☁️ GitHub Sync                               │
│  ┌─────────────────────────────────────────┐ │
│  │ Status:  ✅ Connected (clawd-memory)      │ │
│  │ Last push: 2026-06-07 18:30              │ │
│  │ Last pull: 2026-06-07 09:15              │ │
│  │                                          │ │
│  │ [Push Now]  [Pull Now]                   │ │
│  │ [Disconnect]                             │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 可选未来增强（远期）

| 增强 | 需要的 API | 价值 |
|---|---|---|
| 🎂 GitHub 贡献日历 | GitHub API | Journal 里叠上 GitHub 绿格子 |
| 🌤️ 天气感知 | 免费天气 API | 下雨天 Clawd 打伞 |
| 🤖 AI 语音问候 | LLM API（可选本地模型） | Clawd 根据 coding 情况说一句人话 |

---

## 设计原则

1. **隐私优先**：所有数据存本地，不联网，不上传
2. **渐进增强**：不对现有功能做 breaking change，逐层叠加
3. **感知不打扰**：陪伴行为是 subtle 的，不弹窗、不打断工作流
4. **越用越好**：价值随时间增长，给用户长期使用的理由
