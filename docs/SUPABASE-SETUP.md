# 接入 Supabase — 操作手册

**代码层面已经全部接好并通过构建。你只需要做两件事：填 env var，跑 SQL。**

Schema 的设计理由在 `docs/LEADERBOARD.md`（§7 反作弊、§8 品牌铁律 4、§9 COPPA）。本文只讲怎么做。

---

## 0 · 先说两件事

**1. Novus 里没有 "points"。**
你提到要存 points，但这个代码库里不存在积分/经验值系统 —— 而且是**故意**不存在的。
README 写着「Real words only — burn rate, runway, dilution, Chapter 7. **No coins, no XP.**」，
`lib/engine/wardrobe.ts` 又写了一遍「There is no second currency, no coins, no XP」。

所以「分数」在 Novus 里对应的是这四个真实数字，schema 存的也是它们：

| 你说的 "points" | 实际对应 | 存在哪 |
|---|---|---|
| 路演得分 0–10 | `PerformResult.score` | `saves.state` 里 |
| Shark Respect 0–100 | 跨 run 累积 | `legacy.shark_respect` |
| 估值 peak valuation | 排行榜主排序键 | `leaderboard_entries.peak_valuation` |
| 存活年数 | 排行榜另一个榜 | `leaderboard_entries.years_survived` |

如果你要的是另一套东西（签到积分、金币商城），那会直接违反品牌铁律 4 ——
这是卖给学校、给未成年人用的产品，那条是法律约束不是审美选择。真要加得先当产品决定拍板。

**2. 账号是匿名登录，不是邮箱密码。**
`lib/account.ts` 的注释写得很清楚：*"Deliberately NOT an auth system. No email, no password,
no secret of any kind."* 不收集未成年人的任何身份信息，是最省事也最安全的做法。

---

## 1 · 你要做的：建项目 + 开匿名登录

1. 新建 Supabase 项目，region 选**离玩家近的**。
2. **Authentication → Providers → Anonymous sign-ins：打开。** 其余 provider 全关
   （Email / Phone / OAuth 都会从小孩身上拿到一个身份标识）。
   **这一步不开，同步会静默失败，游戏退回纯本地。**
3. **Authentication → Rate limits：** 限制每个 IP 每小时的匿名注册数。
   不限的话，排行榜上所有 per-profile 限流都白写了。

---

## 2 · 你要做的：env var

`cp .env.example .env.local`，填两个值：

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / sb_publishable_... key>
```

**这两个值在哪找：** Supabase 后台 → 你的项目 → **Project Settings** → **API**：

| 变量 | 页面上的名字 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project API keys → `anon` `public`**（新项目叫 publishable key，`sb_publishable_…` 开头） |

这两个是公开的，放进前端包里没问题 —— 保护数据的是 RLS，不是这个 key。

**今天只需要这两个。** `SUPABASE_SERVICE_ROLE_KEY` 现在没任何代码读它，要等排行榜验证器写完
才用得上（见 §6），`.env.example` 里把它注释掉了。

不填也能跑 —— 游戏会退回纯 localStorage，不同步而已，不会报错。

> 拉下代码后先跑一次 `npm install` —— 新增了 `@supabase/supabase-js` 依赖，
> `package-lock.json` 需要本地重新生成并提交。

---

## 3 · 你要做的：跑 SQL

两个文件，**按顺序**跑。最快的办法：打开 **SQL Editor**，把 `0001` 全文粘进去 Run，成功后再粘 `0002`。

| 文件 | 内容 |
|---|---|
| `supabase/migrations/0001_novus_core.sql` | 账号、存档、legacy、订阅权益、偏好设置、每日 run 限额 |
| `supabase/migrations/0002_leaderboard.sql` | 排行榜投稿、验证、两个公开榜、审核、保留期 |

或者用 CLI：`npx supabase link --project-ref <ref> && npx supabase db push`。

### `0001` 把现在九个 localStorage key 全部搬上服务器

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

`0002` 建 `runs`（投稿证据）、`leaderboard_entries`（世界看到的）、`submission_quota`（限流），
外加两个 view `board_valuation` / `board_survival`。

### 几个值得知道的设计点

- **`saves.state` 是一整块 jsonb。** `RunState` 有 ~45 个字段，4 个是 optional，就是为了让旧存档
  还能读（`migrate()` 每次读都补全）。拆成列意味着每加一个玩法就要一次 migration。
  旁边那几个标量列只是列表用的缓存，**排行榜一个字都不读它们**。
- **两个名字。** `profiles.display_name` 是玩家自己打的字，**私有**；
  `profiles.board_handle` 是词库洗牌出来的（`Brave Otter 4417`，有正则约束），
  **只有它能上公开榜**。对一个九岁小孩来说，founderName 就是他的真名。
- **`entitlements` 客户端只能读不能写。** 能写就等于 Pro 免费送。
- **`run_ledger` 客户端完全碰不到**，走 `claim_run_slot()`。现在的 localStorage 版本开个 devtools 就能无限刷。
- **排行榜没有 `rank` 列。** 名次是 view 里 `row_number()` 算的 —— 没有列可写，就没东西可买可刷。
- **投稿默认 `listed = false`。** `company_name` 是小孩打的自由文本，量一大必然出现真名、
  学校名、电话号码和脏话。过了审核才可见，在那之前**连作者自己都看不见**。

### （可选）先在本地验证 SQL

```bash
createdb novus
psql -d novus -f supabase/tests/_supabase_shim.sql \
              -f supabase/migrations/0001_novus_core.sql \
              -f supabase/migrations/0002_leaderboard.sql \
              -f supabase/tests/schema_test.sql \
              -f supabase/tests/moderation_test.sql
```

已经在 Postgres 16 上跑过，15 项全过：玩家 B 读不到玩家 A 的存档 / 玩家不能给自己开 Pro /
任何人都写不了排行榜（42501）/ 免费玩家一天只能开一局 / 未审核条目对所有人不可见 /
同一份 tape 投两次撞 23505 / 删号级联清空 / 30 天后 tape 自动清空但榜上成绩保留。

`_supabase_shim.sql` 只是给本地 Postgres 补 `auth.uid()` 和几个 role，**不要跑在真项目上**。

---

## 4 · 已经接好的部分（不用你动）

依赖装好了（`@supabase/supabase-js`；**没装 `@supabase/ssr`**，因为浏览器根本不直连 Supabase）。

| 文件 | 作用 |
|---|---|
| `lib/supabase/config.ts` | URL / key / cookie 配置，`configured()` 判断有没有接 |
| `lib/supabase/route.ts` | 每个请求一个 client（不是单例，否则会串号），匿名登录 + cookie 续期 |
| `app/api/session/route.ts` | `POST` 匿名登录，refresh token 写进 httpOnly cookie，并建好 `profiles` 行 |
| `app/api/sync/route.ts` | `GET` 拉存档、`PUT` 推存档 |
| `lib/cloud/sync.ts` | 客户端同步层：建会话、拉取、防抖推送、切后台时强制 flush |
| `lib/engine/save.ts` | 六个函数**签名一个都没变**，只是每次写入多排一个后台推送 |
| `components/CloudSync.tsx` | 挂在根 layout 里，开机时启动同步；不渲染任何东西 |

请求路径是 **浏览器 → 你自己的 Route Handler → Supabase**。浏览器不持有 Supabase 的 URL、key
或 session：不新增第三方 origin，没有第三方 cookie，也没有 Google 那边的设备标识 ——
对一个未成年人产品，这是对的形状。构建产物也证明了这点：`@supabase/supabase-js` 没有进前端包。

### 为什么 localStorage 没有被删掉

因为 `lib/engine/save.ts` 是**同步**的，而且必须保持同步。它的调用方在 render 里就要读它 ——
`AccountGate` 里 CONTINUE 按钮背后的 `entryRoute()`（`lib/entry.ts`）、
`ClosetScreen` 的 `useState(() => loadLegacy().runsCompleted)` —— 而世界上没有同步的 fetch。
改成 async 就要动每一个屏幕，而这正是 save.ts 自己的注释说不要做的事。

所以最终形状是：**localStorage 是游戏读的缓存，Supabase 是它背后的持久副本。**
写入立刻落本地、防抖推服务器。这也顺带给了对的失败模式：没配项目、断网、坐飞机、
匿名登录被关 —— 游戏照常玩，能连上时再同步。

### 冲突怎么处理：本机永远赢

本机正在进行的 run 绝不会被云端覆盖 —— 不然开个标签页就可能把你打到一半的公司换掉。
只有本机**完全是空的**时候才会去云端恢复，也就是这个功能真正存在的场景：换新手机、
清了浏览器、换了台电脑。

**关于那次 reload：** 游戏在挂载时是同步读 localStorage 的，等一个网络往返回来，那次读早就
发生完了。所以真正发生恢复时，`CloudSync` 会让页面重新进入一次。代价是新设备第一次启动多
一次刷新，之后永远不会再有 —— 而“没恢复成功”是比这更糟的 bug。`sessionStorage` 上有一个
标记，所以哪怕采纳失败也不可能陷入刷新循环。

### 两个字段永远不上传

- **`RunState.playerAge`** —— 只用于本地年龄门禁。传上去就等于把一个设备偏好变成“关于一个
  孩子的存储数据”（`docs/LEADERBOARD.md` §9.4）。`saveProfile()` 推送的 payload 里没有它。
- **`RunState.founderName`** —— 存进 `profiles.display_name`，但那是**私有**的，只有玩家自己读得到。

---

## 5 · 接完怎么验证

1. `npm install && npm run dev`
2. 打开首页，开一局。
3. Supabase 后台 → **Table Editor** → `profiles` 应该多了一行，`saves` 里应该有你那局。
4. 想验证恢复：开个无痕窗口（cookie 不同，会是新身份），或者只清 localStorage
   （保留 cookie）再刷新 —— 应该把存档拉回来。

没同步的话按这个顺序查：匿名登录开了没（§1.2）→ env var 填对没 → SQL 跑了没 →
浏览器 Network 里 `/api/session` 返回的 `signedIn` 是不是 `true`。

---

## 6 · 排行榜还差什么

Schema 就位了，但榜要上线还有代码要写（`docs/LEADERBOARD.md` §10 是完整清单）：

1. **先修引擎里两个品牌铁律 4 的漏洞**，在榜公开之前：
   - `lib/engine/people.ts` — Pro 候选人 performance 摇 72–96，免费的 48–78。hire 的 aura 会推
     `qual` 和 `brand`，而 `deriveValuation()` 直接读这两个。**今天 Pro 是能买到估值的。**
   - `lib/engine/holdings.ts` — `art` 是 Pro 专属、增值率 0.11，免费最好的是 0.09，
     而估值有一条 `max(hyped, cash)` 的地板。
2. `lib/leaderboard/tape.ts` —— 录玩家的**输入**（不是结果）。
3. `lib/leaderboard/verify.ts` —— 用真正的 `lib/engine` 重放 tape，追踪 `max(state.stats.valuation)`。
   **peak valuation 在 `RunState` 里根本不存在** —— 峰值 4000 万、死时 20 万的公司，存的是 20 万。
4. 路演得分**服务端重算**，不接受客户端报的数。
5. 审核队列 —— 在任何一条 entry 变成 `listed` 之前。

---

## 7 · 保留期，别忘了

`0002` 里有个 `expire_run_tapes()`，30 天后清空已验证 run 的 tape（成绩留着，重放数据不留）。
它需要挂定时任务，Dashboard → Database → Cron：

```sql
select cron.schedule('novus-expire-tapes', '17 3 * * *',
                     $$select public.expire_run_tapes()$$);
```

**现在就挂上。** 后补的保留策略，就是永远不会补的保留策略。
