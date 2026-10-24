---
name: vx-skill-authoring
description: Use when you discover a new working method for Visual X-Space (patch / layout / units / bridge), or when a documented skill turns out to be wrong — this is the protocol for writing a new workbench skill and for requesting removal of a broken one.
---

# 给工作站写技能（协议）

发现新方法就写下来；发现技能有错就申请删除——**不要自己删文件，也不要乱改别人的技能**。

## 写一个新技能

```jsonc
POST http://127.0.0.1:63536/vxwb
{"action":"skill-add",
 "name":"vx-new-trick",                      // 小写字母/数字/连字符，2-63 字符
 "description":"Use when …（20-400 字符，必须写「什么时候用」）",
 "body":"# 标题\n\n## 症状\n…\n\n## 做法\n1. …\n\n## 验收\n…"}
```

返回 `ok:true` 即已写入 `plugins/vx-workbench/skills/<name>/SKILL.md` 并重扫台账。

**写什么才算数**（评审就看这三段）：

| 段 | 内容 |
|---|---|
| 症状 | 什么现象让人需要这条技能（报错原文、界面表现） |
| 做法 | 具体命令 / 参数 / 顺序，带真实路径与数值 |
| 验收 | 用什么**数字或返回体**证明成功了 |

不要写：泛泛而谈的"最佳实践"、没跑过的步骤、别人的技能内容。

## 更新已有技能

```jsonc
{"action":"skill-update","name":"vx-line-build","description":"…","body":"<完整新正文>"}
```

旧版会自动备份到 `vx-workbench/backup/skills/`，可回滚。

## 技能不好用 / 有 bug → 申请删除

```jsonc
{"action":"skill-request-delete","name":"vx-old-trick",
 "reason":"实测 app.save 在该 build 上不落盘，已被 vx-line-build 的 --boot 做法取代"}
```

- 只**申请**，不会立刻删；面板「待批准」里由人批准
- 批准后目录移入 `vx-workbench/trash/skills/`（可人工恢复）
- reason 至少 10 字，写清证据（报错原文 / 复现步骤 / 被谁取代）

## 无关技能清出去

```jsonc
{"action":"skill-ignore","all":true}                    // 忽略所有「其它全局技能」
{"action":"skill-ignore","names":["fingel","kaisar"]}   // 指定忽略
{"action":"skill-unignore","all":true}                  // 全部恢复
```

只写进 `vx-workbench/skill-ignore.json` 名单，**不删文件**，台账与面板不再显示。

## 判断标准：什么该写成工作站技能

- 属于 VX：补丁/加载链、FBX 单位与朝向、Python 桥与队列、批量改材质、`.vcmx` 存盘、面板接口
- 不属于：角色扮演、聊天记录、通用逆向、与 VX 无关的记忆类技能 —— 那些留在全局，不进工作站
