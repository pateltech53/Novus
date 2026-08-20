---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "这是一款必须对着镜头向 AI 鲨鱼评审路演，才能活过每一个财年的公司人生模拟游戏"
destination: cn-vertical-feed
aspect: 1080x1920
language: zh-CN
length: 30-45s
angle: year-gate
narration: no
---

## Intent

给中文短视频信息流（抖音/快手/视频号/小红书）做一支 30–45 秒的 Novus 推广片。
结构上是「年关悬念」：冷开场用 repo 真实平衡数据一击（「第 5 年，Chapter 7」），
随后正片切换为**产品介绍口吻**——清晰陈述机制，不用恐吓式文案；悬念只作为
视觉包装（压暗的品牌海军蓝、逐格熄灭的跑道量表、金色年门、鲨鱼剪影）。
结尾主 slogan：「把公司开下去，把路演活下来」，之后接「搜索 novuspitch」。
用户选择「你决定」接受了推荐概念（②年关悬念 + ③验尸报告冷开场）。

## Assets

- 无用户提供素材；一切视觉与文案事实从本 repo 重建（README.md、design.md、
  lib/engine、data/events.json、public/ 下的品牌资源）。
- 混合素材策略：尝试在本容器把 Next.js app 跑起来并捕捉真实界面
  （主界面数值环/账本、事件卡片、路演镜头+鲨鱼），起不来则回退到设计重建。

## Customizations

- 冷开场（仅此处）使用 repo 真实模拟数据：50 次 × 10 年模拟，存活到第 10 年 38%，
  死亡中位数第 5 年（README「Balance」节）。正片与结尾不出现统计数字。
- 跑道量表逐格熄灭 + 账本数字滚动/计数动效，是本片点名的核心机制镜头。
- BGM 由制作方程序化合成（用户选「你自己做」），不走 HeyGen 音乐库；
  紧张感脉冲电子乐，确定性可复现。
- 留配音位：无 TTS 旁白；交付一份带时间码的中文台词表（VO-SCRIPT-zh.md），
  节奏为后期人声留出呼吸；全片字卡自足，静音可看。

## Notes

- 全片任何地方不得出现域名/网址；唯一引导是「搜索 novuspitch」。
- 事实只来自 repo，不发明功能与数据。
- 品牌法则（README「Brand laws」）：#FF6B00 是唯一的行动色；财务词汇用真词
  （烧钱率、跑道、稀释、Chapter 7），不用金币/XP 类游戏化词汇；威望金只用于
  年关/晋升；财务上行绿仅用于财务。
- 成片 MP4 直接发到对话里交付。
- 分镜以图片形式发到对话中评审（远程容器无法打开实时看板）。
