# 纸刊海报预设来源记录

记录日期：2026-09-18。

AIPic 的三个纸刊预设位于 `src/lib/editorialRetouchPresets.ts`，在修图工作台的「AI Native → 纸刊海报」中使用。提示词是为现有图片编辑接口独立编写的中文指令，参考的是摄影排版、抽象构成、纸面留白等视觉方法；没有复制上游提示词、工作流、程序、示例图片或品牌文案，也没有安装或执行这些仓库里的 Skill。

## 对应关系与可追溯版本

| AIPic 预设 | 参考仓库 | 阅读版本（完整 Git commit） | 阅读的主要文件 | 参考的视觉方法 |
| --- | --- | --- | --- | --- |
| 实景纸刊 | [Zeejay0/gathered-scenes-zine-skill](https://github.com/Zeejay0/gathered-scenes-zine-skill) | `b9edb836c9dd5c5d80995e89ebcaba34b75fd58f` | `README.md`、`skills/scenes-gathered-zine-v1-3/SKILL.md`、`LICENSE` | 在保留实景照片的基础上，以纸张边缘、简化图形和少量色彩组织页面。 |
| 抽象映像 | [ZzzLc0405/photo-abstract-editorial](https://github.com/ZzzLc0405/photo-abstract-editorial) | `49e55073d6d0330274d31f75d27f5dd6eb35fd6d` | `SKILL.md`、`references/photo-abstract-editorial-prompt.zh-CN.md`、`LICENSE.md` | 将摄影与由其空间、色彩关系产生的简洁抽象区域并置，保留干净的平面背景。 |
| 极简留白 | [LiamGvchi/gc-minimal-zine-poster](https://github.com/LiamGvchi/gc-minimal-zine-poster) | `ddb0d66b24a94f9c4fdd1f02835a836a2db3774e` | `SKILL.md`、`references/style-system.md`、`references/prompt-compiler.md`、`LICENSE` | 以大面积空白、一处摄影主体、小字与少量强调色建立纸刊层次。 |

## 上游许可证记录

这些记录说明参考仓库当时的许可状态，不把上游条款重新套用到 AIPic 独立编写的代码和提示词，也不代表获得了复制或商业使用上游材料的额外授权。

- **Zeejay0**：实际 [LICENSE](https://github.com/Zeejay0/gathered-scenes-zine-skill/blob/b9edb836c9dd5c5d80995e89ebcaba34b75fd58f/LICENSE) 为 `Gathered Scenes Zine Personal Non-Commercial License`，版本 1.0（2026-08-08），版权人为 Zeejay0。文件限制上游材料及其修改版本用于个人非商业场景；超出该范围需要作者书面许可。AIPic 未捆绑该 Skill、模板、图片或脚本。
- **ZzzLc0405 / @AM.**：实际 [LICENSE.md](https://github.com/ZzzLc0405/photo-abstract-editorial/blob/49e55073d6d0330274d31f75d27f5dd6eb35fd6d/LICENSE.md) 使用自定义个人、学习、研究和非商业条款，版权行署名 `ZzzLlc0405`。该文件和 README 中的 `CC BY-NC-SA 4.0` 徽章并不一致，本记录保留这一差异，不将其认定为标准 CC 授权，也不把公开可读等同于允许商业复用。AIPic 未复制该仓库的完整提示词或示例图。
- **LiamGvchi**：实际 [LICENSE](https://github.com/LiamGvchi/gc-minimal-zine-poster/blob/ddb0d66b24a94f9c4fdd1f02835a836a2db3774e/LICENSE) 为 MIT，版权行是 `Copyright (c) 2026 LiamGvchi`。AIPic 同样使用独立编写的提示词，没有捆绑其源文件或示例图片；后续如复制其代码或文档的实质部分，应保留原 MIT 版权和许可声明。

## 在 AIPic 中的适配

- 三个预设都使用现有图片编辑通路：第一张输入图片作为处理对象，选定的提示词、输入图片及当前 API 配置继续交给既有 `submitTask`。不新增模型、上传服务、远程 Skill 调用或网络依赖。
- 预设选择默认一张、高质量、PNG 输出，沿用用户选择的尺寸与宽高比。横幅布局自适应，避免提示词和已有尺寸控件互相矛盾。
- 纸刊版式三选一，选择另一种时替换当前纸刊版式；常规修图仍能叠加。组合时先完成明确选择的修图，再排版，避免多种页面结构同时生效。
- 纸刊模式允许照片在新页面上的移动和等比缩放。原照片内部的人物身份、服饰、产品标志和空间关系受到单独约束，不再被普通修图提示中的“保持原构图”误阻止新页面布局。
- 三套预设不复用上游英文标题或例图文案。用户提供标题时优先使用；没有标题时，要求模型根据照片可见信息生成简短中文标题，不虚构日期和地点。
- 保真要求通过现有生成模型的提示词表达。这里没有增加原始照片像素的确定性拼接器，因此不宣称输出摄影区域与输入逐像素一致。

这些预设通过提示词控制版式，不包含单独的排版程序。
