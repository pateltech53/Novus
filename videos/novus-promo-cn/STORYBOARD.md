---
format: 1080x1920
duration: 40s
message: "必须对着镜头向读过你账本的 AI 鲨鱼路演，才能活过每一个财年——这是一款把公司当人生来过的模拟游戏"
arc: 冷开场数据一击 → 产品亮相 → 机制（时间·事件·账本） → 年关路演高潮 → CTA
audience: 中文短视频信息流（抖音/快手/视频号/小红书）观众，对模拟经营与创业题材感兴趣
mode: collaborative
music: none
language: zh-CN
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
- blueprint: dataviz-countup
- asset_candidates:

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
- blueprint: kinetic-type-beats
- asset_candidates: assets/game/game-found.png — 建号界面：鲨鱼吉祥物、中文公司名、行业选择

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
- blueprint: device-surface-showcase
- asset_candidates: assets/game/game-dashboard-tutorial.png — 月初主面板（JAN → FEB、教程语「One tap, one month」）; assets/game/game-event-logo-night.png — 事件卡三选一; assets/game/game-dashboard.png — 推进后的面板（红色变化量）

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
- blueprint: dataviz-countup
- asset_candidates:

narrativeRole: 核心循环第二半：后果记在账上（The Books：cash/burn/runway/valuation；events.ts 的 targeted pressure on your weakest stat；237 authored events）。跑道逐格熄灭是本片点名的机制镜头，也为年关铺压力。
keyMessage: 每个决定都会变成账本上的数字，而账本在变差。

## Frame 5 — 年关：对着镜头路演

- scene: 「12 月，不会自己过去。」金色年门开启；手机展示真实「Pitch me」界面（西装鲨鱼、四条路演结构），推近到摄像头舞台（取景框自视、结构清单、录制中 KEEP GOING · 8s）。绿色假摄像头区域用设计取景卡替换
- voiceover: "到了年底，游戏会停下来。打开摄像头，向五位读过你账本的 AI 鲨鱼投资人路演——评的是你说了什么，不是你怎么说。"
- duration: 8s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/05-year-gate.html
- type: feature_showcase
- persuasion: Future pacing
- beat: tension + awe
- blueprint: device-surface-showcase
- asset_candidates: assets/game/game-pitchme.png — 年关 Pitch me 界面（西装鲨鱼+四条结构）; assets/game/game-camera-stage.png — 摄像头舞台（需遮替右上绿色自视区）; assets/game/game-recording.png — 录制中 KEEP GOING · 8s

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
- blueprint: prompt-type-submit-generate
- asset_candidates:

narrativeRole: 收束到唯一引导动作。免费即完整（landing：Free is the whole game）消除门槛；打字搜索框把「搜什么」变成可复述的动作记忆。不出现任何域名。
keyMessage: 搜索 novuspitch。

## Video direction

（Step 4 填充）
