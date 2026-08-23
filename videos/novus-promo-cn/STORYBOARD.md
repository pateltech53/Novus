---
format: 1080x1920
duration: 36.5s
message: "必须对着镜头向读过你账本的 AI 鲨鱼路演，才能活过每一个财年——这是一款把公司当人生来过的模拟游戏"
arc: 冷开场数据一击 → 产品亮相 → 机制（时间·事件·账本） → 年关路演高潮 → CTA
audience: 中文短视频信息流（抖音/快手/视频号/小红书）观众，对模拟经营与创业题材感兴趣
mode: collaborative
music: none
language: zh-CN
---

## Video direction

**Palette system**（全部来自 `frame.md`，不得发明）：两个 register，一帧只用一个。
`ink-black` 为全片地面（F1–F5），`cream` 为其上的正文/标题色，`fire-orange` 是**唯一**的
强调色——数字下坠的落点、按钮、跑道量表、CTA 满场。F6 翻转为 `orange` register（橙底、
`ink-black` 文字）。`cream-hint` 用于 mono 小字，`alert-red` 只用于负向变化量与 CHAPTER 7
印章，`prestige-gold` **只在 Frame 5（年关）出现**，这是产品品牌法则（威望金＝年关/晋升），
出现在任何其他帧都是错误。

**Motion grammar + reveal model**：长尾缓出（`power3` 默认；快速到达用 `expo.out`），
不用 `back.out`/`bounce`/`elastic`。每一帧都按**台词线索逐条揭示**——t=0 只出现台词此刻
在说的那一件东西，其余元素等到自己的口播线索才进场，揭示重心压在后 50%。任何帧都不许
在前 25% 把画面倒空。定格阶段只允许 `subtle jitter`（`sine-wave-loop` 低振幅），
禁止呼吸缩放、禁止后半段慢推/慢摇。

**Rhythm / 定格分配**：F1（印章落定后）、F5 Scene 1（年关前的静止）、F6 Scene 4（终帧）
是三个刻意的静止读点；F5 Scene 1 的静止是全片高潮前的蓄力，不许有任何运动。
F3/F4 是能量最高的两帧（点击 + 数字下坠），F2 是中速。

**Negative list**：不出现导航栏/页脚/滚动条/浏览器 chrome/真实鼠标指针（超大设计光标是
唯一例外，仅 F3）；不出现浮动光斑、紫蓝「AI 渐变」、圆角泛光装饰球；不出现任何域名或网址；
不出现金币/XP 等游戏化词汇（品牌法则：只用真实财务词）。两种失败模式一并禁止——
**幻灯片**（前 25% 倒空后冻结）与**屏保**（元素各自漂浮）。

**Caption band**：底部 ~17%（约 326px）留空，所有内容规划在上 83%。本片无字幕轨，
但保留该边距以统一下边缘。

---

## Frame 1 — 冷开场：你死于第五年

- scene: 墨黑场。巨大数字「第 5 年」重砸入画，红色「CHAPTER 7」印章盖下，mono 小字给出出处（50 次模拟 × 10 年 / 只有 38% 活到第 10 年）
- voiceover: "模拟了五十次，每次十年——大多数公司，死在第五年。"
- duration: 5s
- transition_in: cut
- status: outline
- src: compositions/frames/01-cold-open.html
- type: hook
- persuasion: Statistical proof
- beat: tension
- blueprint: dataviz-countup (Adapt — Hook/counter-burst 变体)
- focal: 无实拍素材；纯字体+数据仪表
- roles: 无
- sfx: 无（BGM 与 SFX 在装配阶段由制作方合成并挂载于 root）

Adapt：保留「count-up 与图形同一拍落定」的签名动作；不用图标四散爆开，改为
**年份计数 1→5 + 10 段年份量表同步点亮 5 格**——量表让「第 5 年」不只是一个数字，
而是一条走了一半就断掉的路。

Scene 1 (0.0–1.3s)：纯 `ink-black` 满场。仅 mono kicker「50 次模拟 × 10 年」在上三分之一
以 **per-word staggered reveal**（`dynamic-content-sequencing`）进场，长尾落定。画面此刻
只有这一行——台词正说到这里。居中构图，密度极低（这是刻意的空）。

Scene 2 (1.3–2.8s)：台词说到「大多数公司」，中央 **value-scaled counter**
（`counting-dynamic-scale`）从 1 计到 5，字号随数值增长，最终「第 **5** 年」占据画面
约 45%（「5」为 `fire-orange`，其余 `cream`）；同一拍下方 **10 段年份量表**
（`stat-bars-and-fills`）自左向右点亮 5 格、后 5 格保持 `border-dark` 空槽——
数字与量表**同一条缓动同时落定**（签名动作）。居中，3 层景深（底噪网点 / 量表 / 数字）。

Scene 3 (2.8–4.2s)：台词落到「死在第五年」，`alert-red` 描边印章「CHAPTER 7」以
**spring-pop entrance**（`spring-pop-entrance`，低过冲）旋转约 −7° 砸在数字右下角，
量表后 5 格瞬时 `depth-of-field-blur` 轻微失焦——路走不完的读感。

Scene 4 (4.2–5.0s)：底部 mono 小字「只有 38% 活到第 10 年」淡入（数据出处），画面**静止**，
仅数字保留 subtle jitter（`sine-wave-loop` 低振幅）。这是第一个刻意读点。

narrativeRole: 用 repo 真实平衡数据（README「Balance」节：50 runs × 10 years，38% survived，median death year 5）一击制造利害。数据只出现在本帧。
keyMessage: 这个游戏会让你的公司死——而且通常死在第五年。

## Frame 2 — 产品亮相

- scene: 「这是 Novus」名词砸落式亮相；手机机身浮入，屏内是真实建号界面（鲨鱼吉祥物 HE/SHE、公司名「山丘咖啡」、行业挂锁）
- voiceover: "这是 Novus——一款把公司当人生来过的模拟游戏。"
- duration: 5s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/02-intro.html
- type: product_intro
- persuasion: Category announcement
- beat: curiosity
- blueprint: kinetic-type-beats (Adapt — Product_Intro/namedrop 变体)
- focal: assets/game-found.png
- roles: game-found.png = cutout（前景主体手机屏，文字绕其排布）
- sfx: 无

Adapt：保留「hard-cut 穿过 Introducing/品类，收束到品牌名」的签名节拍；把最后的
logo lockup 换成**真实建号界面推入**——品牌名之后立刻给出「它长什么样」，比再放一次
字标更有信息量。

Scene 1 (0.0–1.6s)：`ink-black` 满场。「这是」以小号 `cream` 先落（hard-cut flash-in），
紧接 **kinetic beat-slam**（`kinetic-beat-slam`）把 **NOVUS** 巨型字标砸入画面正中，
占宽约 80%，`display` 级字号。此刻画面只有字标——台词正在念这个名字。

Scene 2 (1.6–3.2s)：台词转向品类，字标以长尾缓动**缩小并上移**至上三分之一让位；
真实建号手机屏自右下**倾斜浮入并落定**（device establish，`3d-page-scroll` 的 tilt 取景
+ `spring-pop-entrance` 低过冲落定），高约占画面 55%，右侧出血、左侧留白——
asymmetric 60/40，3 层景深（底 / 字标 / 手机）。

Scene 3 (3.2–5.0s)：mono 副标「一款把公司当人生来过的模拟游戏」在字标下方
**逐词揭示**（`dynamic-content-sequencing`），末词落定后画面**保持静止**，
仅手机极低振幅 jitter。

narrativeRole: 冷开场的答案。名字 + 一句话品类定义（README：BitLife-style life sim for a company）。
keyMessage: Novus = 公司人生模拟。

## Frame 3 — 点一下，过一个月

- scene: 手机 hero 持握全帧；屏幕从主面板（JAN → FEB 芯片、橙色 ADVANCE MONTH）推进到事件卡「The Logo Night」弹出，三个抉择按钮
- voiceover: "时间只在你点击时前进。点一下，过一个月——招谁、卖多少钱、接不接那单，全是你的决定。"
- duration: 6.5s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/03-advance.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: control
- blueprint: device-surface-showcase (Adapt — static-tour 变体)
- focal: assets/game-dashboard-tutorial.png
- roles: game-dashboard-tutorial.png = cutout（第一屏态）· game-event-logo-night.png = supporting（第二屏态）· game-dashboard.png = supporting（第三屏态，红色变化量）
- sfx: 无

Adapt：保留 static-tour 的签名——**相机全程锁死，所有运动都在元素/UI 层**（按钮压缩、
屏幕换态、侧文案换行）。改动：加入**超大设计光标**驱动这次点击（`/oversized-cursor` 家法：
从画面外进入、指尖对位、点击引燃下一拍），因为本帧的论点就是「是你在点」。

Scene 1 (0.0–1.4s)：手机屏（主面板 JAN → FEB）已由 push-slide 带入并居中锁定，
高占画面约 60%；标题「时间只在你点击时前进」在其上方**逐词揭示**。相机静止。

Scene 2 (1.4–3.0s)：台词说到「点一下」，**超大光标自右下画面外滑入**（`nudge-curve` 三段
慢-快-慢），尖端对位橙色 **ADVANCE MONTH** 按钮；点击时按钮 **press-compress 95%→100%**
（`press-release-spring`）并发出一圈扩散涟漪（`cursor-click-ripple`）；同拍 JAN → FEB 芯片
**hard-cut** 翻为 FEB → MAR（`discrete-text-sequence`）。这一击是本帧的引燃点。

Scene 3 (3.0–4.6s)：屏幕**换态**——事件卡「The Logo Night」自屏幕下缘推入覆盖面板
（screen-cycle，`3d-page-scroll` 的 translateY 形态，卡片外层 `overflow:hidden` 裁切，
内层标 `data-layout-allow-overflow`），三个抉择行随之逐条落定；光标退出画面。

Scene 4 (4.6–6.5s)：台词列举时，手机下方**三枚 mono chip 逐个落定**——「招谁」「卖多少钱」
「接不接那单」（`kinetic-beat-slam`，一拍一个），末句「全是你的决定」以 `fire-orange`
关键词辉光（`asr-keyword-glow`）压在「你的」二字上；随后静止。

narrativeRole: 核心循环第一半：advanceMonth() 是唯一让时间前进的函数（lib/engine/run.ts）；事件带真实抉择。
keyMessage: 点按推进时间，每个决定都是你的。

## Frame 4 — 账本会说话

- scene: 墨黑场账本重构：现金 / 烧钱率 / 跑道 / 估值四卡数字滚动下坠，12 段跑道量表逐格熄灭；mono 角标「237 个事件 · 专挑你最弱的数值」
- voiceover: "237 个真实事件，专挑你最弱的地方下手。现金、烧钱、跑道、估值——每一格都在掉。"
- duration: 6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-books.html
- type: feature_showcase
- persuasion: Pain agitation
- beat: anxiety
- blueprint: dataviz-countup (Adapt — Problem 变体，去掉相机穿越)
- focal: 无实拍素材；账本以设计重建（数值取自真实存档：现金 $23K −$2,000 / 烧钱 $2,000 / 跑道 11mo / 估值 $23K）
- roles: 无
- sfx: 无

Adapt：保留「一拍一件数据仪器、数字与图形同拍落定」的签名；**去掉相机穿越**——
本帧的压力来自数字自己在掉，而不是镜头在动（motion doctrine：宁可不动，不要坏动）。
仪器传递改为**元素层的 scale-swap**（`scale-swap-transition`）。

Scene 1 (0.0–1.2s)：`ink-black` 满场。中央 **237 计数上升 0→237**
（`counting-dynamic-scale`，字号随值增长），下方 mono「个真实事件」。画面只有这一件。

Scene 2 (1.2–2.4s)：台词转到「专挑你最弱的地方下手」，237 **缩小上移**成为角标
（scale-swap 让位），主句以 **per-word staggered reveal** 落在其下。

Scene 3 (2.4–4.4s)：台词逐个念出四个词，**2×2 账本卡片网格逐张落定**
（`spring-pop-entrance` 低过冲，一词一张）：现金 $23K（`alert-red` 变化量 −$2,000）、
烧钱率 $2,000/月、跑道 11 个月、估值 $23K；每张的数字**同时 count-up**
（`counting-dynamic-scale`）。卡片只留上边框 1px `border-dark`（frame.md 的 stat-card 规范）。
居中网格占画面约 55%，3 层景深。

Scene 4 (4.4–6.0s)：末句「每一格都在掉」——**12 段跑道量表**在网格下方画出
（`stat-bars-and-fills`），随即**自右向左逐格熄灭** `fire-orange` → `border-dark`
（一格一拍，`discrete-text-sequence` 的阈值态切换），跑道数字同步递减；熄到剩 3 格时
**停住并保持静止**。这是本片点名的机制镜头，也是年关压力的来源。

narrativeRole: 核心循环第二半：后果记在账上（The Books：cash/burn/runway/valuation；events.ts 的 targeted pressure on your weakest stat；237 authored events）。跑道逐格熄灭是本片点名的机制镜头，也为年关铺压力。
keyMessage: 每个决定都会变成账本上的数字，而账本在变差。

## Frame 5 — 年关：对着镜头路演

- scene: 「12 月，不会自己过去。」金色年门开启；手机展示真实「Pitch me」界面（西装鲨鱼、四条路演结构），推近到摄像头舞台（取景框自视、结构清单、录制中 KEEP GOING · 9s）
- voiceover: "到了年底，游戏会停下来。打开摄像头，向五位读过你账本的 AI 鲨鱼投资人路演——评的是你说了什么，不是你怎么说。"
- duration: 8s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/05-year-gate.html
- type: feature_showcase
- persuasion: Future pacing
- beat: tension + awe
- blueprint: device-surface-showcase (Adapt — stepwise-flow 变体)
- focal: assets/game-camera-stage-clean.png
- roles: game-pitchme.png = supporting（第一屏态：年关简报）· game-camera-stage-clean.png = cutout（第二屏态：摄像头舞台，本帧主体）· game-recording-clean.png = supporting（第三屏态：录制中）
- sfx: 无

Adapt：保留 stepwise-flow 的签名——**一条端到端流程按屏态推进（简报 → 开摄像头 → 录制中），
相机基本静止，只在「开摄像头」这一次状态跃迁上给一次极短推近**。改动：开场加一个
**静止蓄力读点**和一道 `prestige-gold` 门——年关在产品里就是一道金色的门，这是全片
唯一允许出现金色的地方。

Scene 1 (0.0–1.6s)：`ink-black` 满场，**完全静止的蓄力**。「12 月，不会自己过去。」两行
`cream` 大字居中落定（hard-cut flash-in，不带任何漂移）；随后一道 `prestige-gold` 发丝线
自左向右**画出**（`svg-path-draw`）压在文字下方。此刻画面别无他物——高潮前的静止。

Scene 2 (1.6–3.4s)：台词说到「打开摄像头」——两道 `prestige-gold` 竖光带自中央**向两侧
推开**（门开的读法，`center-outward-expansion`），门后真实「Pitch me」屏态自下**升入**
并落定，高占画面约 58%；仅此一次**极短推近**（`multi-phase-camera` 单段推，落点即锁死）
punctuate 这次状态跃迁。

Scene 3 (3.4–5.6s)：台词念到「五位读过你账本的 AI 鲨鱼投资人」，手机上方**五枚
`prestige-gold` 圆点沿弧线逐个落定**（`kinetic-beat-slam`，一位一拍；这是设计化的评审席
表示，不冒充截图），旁注 mono「五位 AI 投资人 · 读过你的账本」；同拍手机屏**换态**为
摄像头舞台（自视取景框可见）。相机已锁死，不再推。

Scene 4 (5.6–8.0s)：屏态再换为**录制中**（KEEP GOING · 9s），末句
「评的是你说了什么，不是你怎么说」落在下方，`prestige-gold` 关键词辉光
（`asr-keyword-glow`）只压在「说了什么」四字上；随后**全帧静止**保持到结束。

narrativeRole: 独有机制的高潮：财年不路演不结束（README：The year cannot close without a scored camera performance；landing：judged on what you say, never how you sound；five investors who have read your numbers）。威望金只在此处使用。
keyMessage: 年关 = 真人对镜头路演，AI 鲨鱼评审只看内容。

## Frame 6 — CTA：搜索 novuspitch

- scene: 火橙满场反转。「免费就是完整游戏」→ 两行 slogan「把公司开下去 / 把路演活下来」→ 墨色搜索 pill 逐字打出「novuspitch」，光标闪烁定格
- voiceover: "免费就是完整游戏。把公司开下去，把路演活下来——搜索 novuspitch。"
- duration: 6s
- transition_in: squeeze
- status: outline
- src: compositions/frames/06-cta.html
- type: cta
- persuasion: Risk reversal
- beat: motivation
- blueprint: kinetic-type-beats (Adapt — CTA 变体；覆盖 Step 3 的 prompt-type-submit-generate 候选)
- focal: 无实拍素材；纯字体 + 打字搜索 pill
- roles: 无
- sfx: 无

Adapt（覆盖说明）：Step 3 候选的 `prompt-type-submit-generate` 是「向 AI 提问」的形状，
与本片 CTA 不符；改用 kinetic-type-beats 的 CTA 变体——**收尾金句一拍一句落定，收在锁版**。
保留其签名（beat-by-beat 落定 + 终帧死静），把「锁版」实例化为**打字搜索框**：
让观众记住的不是一个字标，而是一个**可复述的动作**。

Scene 1 (0.0–1.0s)：register 翻转——`fire-orange` 满场（全片唯一橙底帧，squeeze 转场
带入）。ink 色 mono kicker「免费就是完整游戏」落在上三分之一。

Scene 2 (1.0–2.8s)：两行 slogan 以 **kinetic beat-slam** 一行一拍落定，`ink-black`
`display` 级：「把公司开下去，」→「把路演活下来。」居中，占画面约 40%。

Scene 3 (2.8–4.6s)：台词落到「搜索」，`ink-black` 胶囊搜索框**缩放落定**在 slogan 下方，
内含放大镜字形；随后 `cream` mono 文本 **novuspitch** 逐字打出
（`discrete-text-sequence`）并带闪烁光标（`context-sensitive-cursor`，方波闪烁、确定性）。

Scene 4 (4.6–6.0s)：**全帧死静**，仅光标继续方波闪烁。终帧＝填好的搜索框——这是全片
唯一真正的「出场」，不淡出、不切黑。画面上不得出现任何域名或网址。

narrativeRole: 收束到唯一引导动作。免费即完整（landing：Free is the whole game）消除门槛；打字搜索框把「搜什么」变成可复述的动作记忆。不出现任何域名。
keyMessage: 搜索 novuspitch。
