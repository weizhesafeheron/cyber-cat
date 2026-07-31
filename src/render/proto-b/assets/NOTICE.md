# 原型 B 部件资产来源与许可

本目录全部部件 PNG、花纹 mask 与 parts.json 由 `tools/proto-b/make-parts.ts`
确定性生成，是本仓库的原创资产，随仓库主许可分发，无第三方素材混入。

## 为什么没有采用外部素材包

按 issue #25 的资产来源策略，第一优先是免许可（CC0 或明确允许改作商用）的
高质量像素猫素材包。实际核查结果（2026-07-31）：

| 候选 | 许可核查 | 结论 |
|---|---|---|
| last-tick「Animated Pixel Cats 64x64」(itch.io) | "Free for personal and commercial use. Reselling or redistributing is prohibited." 未明确允许改作（切分部件属于改作），且本仓库公开，提交衍生 PNG 有再分发风险 | 许可不明，弃用 |
| ToffeeCraft「Retro Cats」免费版 (itch.io) | "Free Pack License - For personal use." 明确仅个人用途 | 不满足商用，弃用 |
| OpenGameArt CC0 检索（Shepardskin「Cat sprites」、`cat_5.png`「Pixel cat」等） | 许可干净（CC0） | 质量低于现有程序化渲染（纯剪影/平涂、无色带光影），会拖低原型判决的公平性，弃用 |

兜底路线（本地 SD + 像素 LoRA）因模型体量与产出仍需部件手术，未启用。
最终选择：按 hi-fi 调研（docs/research/2026-07-31-hi-fi-pixel-cat-refs/report.md）
的着色规则（固定光源分档、hue shift 色带、受光侧 selout、确定性毛簇）
离线生成原创部件，走完「素材 → 切分部件 → ID 调色板 → 运行时装配」的完整管线。

## 生成方式

```
npx vite-node tools/proto-b/make-parts.ts
```

重跑产出逐字节一致。规范 ID 调色板见 `src/render/proto-b/palette.ts`。
