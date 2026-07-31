# 接入 Supabase — 操作手册

这份文档讲两件事：**跑哪些 SQL**，以及**怎么把 Supabase 接到 Novus 上**。

Schema 的设计理由不在这里，在 `docs/LEADERBOARD.md`（尤其是 §7 反作弊、§8 品牌铁律 4、
§9 COPPA 未成年人隐私）。本文只讲怎么做。

---

## 0 · 先说三件事

**1. 现在会话里连着的那个 Supabase 项目不是 Novus 的。**
`alptwiszxgattsnqvfbg` 里面是 `shoes` / `shoe_specs` / `blogger_reviews` / `ai_credits` 这类表，
其中一张有 94 万行 —— 那是一个球鞋数据库应用。**不要把下面的 migration 跑在那个项目上。**
给 Novus 新建一个独立项目。

**2. Novus 里没有 "points"。**
你提到要存 points，但这个代码库里不存在积分/经验值系统 —— 而且是**故意**不存在的。
README 的品牌铁律写着「Real words only — burn rate, runway, dilution, Chapter 7. **No coins, no XP.**」，
`lib/engine/wardrobe.ts` 又写了一遍「There is no second currency, no coins, no XP」。

所以「分数」在 Novus 里对应的是这四个真实数字，schema 里存的也是它们：

| 你说的 "points" | 实际对应 | 存在哪 |
|---|---|---|
| 路演得分 0–10 | `PerformResult.score`，`scorePitchContent()` 算出来 | `saves.state` 里（服务端会重算，见下） |
| Shark Respect 0–100 | 跨 run 累积 | `legacy.shark_respect` |
| 估值 peak valuation | 排行榜主排序键 | `leaderboard_entries.peak_valuation` |
| 存活年数 | 排行榜另一个榜 | `leaderboard_entries.years_survived` |

如果你要的是另一套东西（签到积分、金币商城之类），那会**直接违反品牌铁律 4**——
这是卖给学校、给未成年人用的产品，那条是法律约束不是审美选择。真要加，先跟我说，那是产品决定不是 schema 决定。

**3. 账号是匿名登录，不是邮箱密码。**
`lib/account.ts` 现在的注释写得很清楚：*"Deliberately NOT an auth system. No email, no password,
no secret of any kind."* 保持这个姿态 —— 不收集未成年人的任何身份信息，是最省事也最安全的做法。
下面第 2 步会开 Anonymous sign-ins，**其他 provider 全部关掉**。

---

## 1 · 建项目

1. 新建一个 Supabase 项目，region 选**离玩家近的**，不是离你近的。
2. **Authentication → Providers → Anonymous sign-ins：打开。** 其余 provider 全关
   （Email / Phone / OAuth 都会从小孩身上拿到一个身份标识，一个都不要）。
3. **Authentication → Rate limits：** 限制每个 IP 每小时的匿名注册数。
   默认值很宽松，而排行榜会让"免费造身份"变成攻击面 —— 不限的话，下面所有 per-profile 限流都白写。
4. **Settings → API** 里记下三个值，填进 `.env.local`（见第 4 步）。

---

## 2 · 跑 SQL

两个文件，**按顺序**跑：

| 文件 | 内容 |
|---|---|
| `supabase/migrations/0001_novus_core.sql` | 账号、存档、legacy、订阅权益、偏好设置、每日 run 限额 |
| `supabase/migrations/0002_leaderboard.sql` | 排行榜投稿、验证、两个公开榜、审核、保留期 |

两种跑法，选一个：

**A. Dashboard（最快）** — 打开 SQL Editor，把 `0001` 全文粘贴进去 Run，成功后再粘 `0002`。

**B. CLI（推荐，schema 能进版本控制）**

```bash
npx supabase link --project-ref <你的 project ref>
npx supabase db push
```

不管用哪种，**文件都留在仓库里**。只存在于 dashboard 里的 schema 是没人能 review 的 schema。

### 这两个文件建了什么

`0001` —— 把现在九个 localStorage key 全部搬上服务器：

| 现在的 localStorage | 迁移到 |
|---|---|
| `novus:account:v1` | `profiles` |
| `novus:profile:v1` | `profiles` + `preferences` |
| `novus:run:v1` | `saves` |
| `novus:legacy:v1` | `legacy` |
| `novus:entitlements:v1` | `entitlements` |
| `novus:runledger:v1` | `run_ledger` |
| `novus:wardrobe:v1` | `preferences.equipped_skin` |
| `novus:theme:v1` | `preferences.theme` |
| `novus:sound:v1` | `preferences.sound_on` |

`0002` —— `runs`（投稿证据）、`leaderboard_entries`（世界看到的）、`submission_quota`（限流），
外加两个 view `board_valuation` / `board_survival`。

### 几个值得知道的设计点

- **`saves.state` 是一整块 jsonb，不是拆成列的。** `RunState` 有 ~45 个字段，其中 4 个是
  optional，就是为了让旧存档还能读（`migrate()` 每次读都会补全）。拆成列意味着每加一个玩法就要
  一次 migration，而引擎那边照样得补全。旁边那几个标量列（`year` / `industry` / `alive`…）
  只是列表用的缓存，**排行榜一个字都不读它们**。
- **两个名字。** `profiles.display_name` 是玩家自己打的字，**私有**，只在他自己屏幕上显示；
  `profiles.board_handle` 是从词库洗牌选出来的（`Brave Otter 4417` 这种形状，有正则约束），
  **只有它能出现在公开榜上**。对一个九岁小孩来说，founderName 就是他的真名。
- **`entitlements` 客户端只能读不能写。** 能写就等于 Pro 免费送。
- **`run_ledger` 客户端完全碰不到**，走 `claim_run_slot()` 这个 security definer 函数。
  现在的 localStorage 版本，开个 devtools 就能无限刷。
- **排行榜没有 `rank` 列。** 名次是 view 里 `row_number()` 算出来的 —— 没有列可写，就没有东西
  可以买、可以刷。这是品牌铁律 4 落到 schema 上的样子。
- **投稿默认 `listed = false`。** `company_name` 是小孩打的自由文本，量一大必然出现真名、
  学校名、电话号码和脏话。过了审核才可见 —— 而且在那之前**连作者自己都看不见**。

---

## 3 · 验证 SQL 真的对（可选，但建议）

`supabase/tests/` 下有一套测试，跑在**本地 Postgres** 上，不需要 Supabase 项目也不需要联网：

```bash
createdb novus
psql -d novus -f supabase/tests/_supabase_shim.sql \
              -f supabase/migrations/0001_novus_core.sql \
              -f supabase/migrations/0002_leaderboard.sql \
              -f supabase/tests/schema_test.sql \
              -f supabase/tests/moderation_test.sql
```

这两个文件已经在 Postgres 16 上跑过，15 项全过，包括：
玩家 B 读不到玩家 A 的存档 / 玩家不能给自己开 Pro / 任何人都写不了排行榜（42501）/
免费玩家一天只能开一局 / 未审核的条目对所有人不可见 / 同一份 tape 投两次会撞 23505 /
删号级联清空所有数据 / 30 天后 tape 自动清空但榜上成绩保留。

`_supabase_shim.sql` 只是给本地 Postgres 补上 `auth.uid()` 和几个 role，**不要跑在真项目上**。

---

## 4 · 接到代码里

### 4.1 环境变量

`cp .env.example .env.local`，然后填 Settings → API 里的值：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / sb_publishable_... key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # 服务端专用，见下
```

`.env.local` 已经在 `.gitignore` 里了。

**`SUPABASE_SERVICE_ROLE_KEY` 绝对不能出现在 Client Component 里。** 它绕过所有 RLS。
建议在 CI 里加一道检查：

```bash
grep -rn "SUPABASE_SERVICE_ROLE_KEY" app components && exit 1 || exit 0
```

一个 `"use client"` 加错文件，这个 key 就发给全世界的浏览器了。

### 4.2 装依赖

```bash
npm i @supabase/supabase-js
```

只要这一个。**不要装 `@supabase/ssr`** —— 它是用来管浏览器端 auth cookie 的，而下面的设计里
浏览器根本不直接连 Supabase。

### 4.3 请求路径

浏览器 → 你自己的 Next.js Route Handler → Supabase。浏览器不持有 Supabase 的 URL、key 或 session。

```
POST /api/session          → 服务端匿名登录，refresh token 写进 httpOnly cookie
GET/PUT /api/save          → 读写 saves / legacy / preferences
POST /api/leaderboard/submit → 提交 tape，服务端重放验证，写榜
GET  /api/leaderboard      → 取某个榜的前 100
```

这样做的好处很实际：浏览器只跟你自己的域名说话，不新增任何第三方 origin，
没有第三方 cookie，也没有 Google 那边的设备标识 —— 对一个未成年人产品，这是对的形状。

`app/api/` 目前**还不存在**，需要新建。

### 4.4 改 `lib/engine/save.ts`

这个文件本来就是为这一步设计的 —— 它的头注释写着
*"localStorage now; the same surface maps to Supabase tables in P5 … without touching callers."*

保持 `loadRun` / `saveRun` / `loadLegacy` / `saveLegacy` / `loadProfile` / `saveProfile` 六个函数签名不变，
把里面的 `localStorage` 换成 fetch 你自己的 route。调用方（`GameProvider.tsx`）一行都不用改。

**保留 `migrate()`。** 从服务器读回来的存档跟从 localStorage 读回来的一样，可能是旧 schema
写的，一样需要补全。

---

## 5 · 排行榜还差什么

Schema 已经就位了，但**榜要能上线，还有代码要写**（`docs/LEADERBOARD.md` §10 是完整清单）。
按重要性排：

1. **先修引擎里两个品牌铁律 4 的漏洞**，在榜公开之前，不是之后：
   - `lib/engine/people.ts` — Pro 的候选人 performance 摇 72–96，免费的摇 48–78。
     hire 的 aura 会推 `qual` 和 `brand`，而 `deriveValuation()` 直接读这两个。
     **今天 Pro 是能买到估值的。**
   - `lib/engine/holdings.ts` — `art` 是 Pro 专属、增值率 0.11，免费最好的资产是 0.09，
     而估值有一条 `max(hyped, cash)` 的地板。
2. `lib/leaderboard/tape.ts` —— 录玩家的**输入**（不是结果），以及 `GameProvider` 里每个
   `commit()` 点的追加。
3. `lib/leaderboard/verify.ts` —— 用真正的 `lib/engine` 重放 tape，路上追踪
   `max(state.stats.valuation)`。**peak valuation 在 `RunState` 里根本不存在** ——
   `stats.valuation` 是当前值，峰值 4000 万、死时 20 万的公司，存的是 20 万。
   峰值必须由服务端重放算出来。
4. 路演得分**服务端重算**，不接受客户端报的数（`scorePitchContent()` 是纯函数，
   输入只有 transcript 和这局自己的账本）。
5. 审核队列 —— 在任何一条 entry 变成 `listed` 之前。

---

## 6 · 保留期，别忘了

`0002` 里有个 `expire_run_tapes()`，30 天后清空已验证 run 的 tape（成绩留着，重放数据不留）。
它需要挂上定时任务，在 Dashboard → Database → Cron：

```sql
select cron.schedule('novus-expire-tapes', '17 3 * * *',
                     $$select public.expire_run_tapes()$$);
```

**现在就挂上。** 后补的保留策略，就是永远不会补的保留策略。
