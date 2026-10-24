# 这个工作区的工作方式

（给所有会话看的长期规则。改动请追加，不要删别人的条目。）

## 1. Visual X-Space 工作站（VX）

- 面板与接口在 `plugins/vx-workbench/`，技能台账是 `plugins/vx-workbench/docs/skills.md`，**先读台账再动手**。
- 干 VX 相关的活，先加载对应技能：`vx-cad-import-repair`（补丁/加载链）、`vx-line-build`（Python 桥/批量改造）、`vx-model-units`（单位与朝向）、`vx-workbench-ops`（面板接口）、`vx-hoops-crack`、`vx-factory-build`、`vx-motion-diagnose`、`vx-sim-diagnose` 等。
- 分类原则：**VX 相关 = 工作站技能**（补丁、导入、建模、产线、仿真、面板）；角色扮演、聊天记录、通用逆向、记忆类 = 全局技能，不进工作站台账。

## 2. 发现新方法：主动写成技能（不要只写在回答里）

做完一件新事（新参数、新命令、踩到并绕过的新坑），就把它写成技能，一步：

```jsonc
POST http://127.0.0.1:63536/vxwb
{"action":"skill-add",
 "name":"vx-简短英文名",
 "description":"Use when …（20-400 字，写清什么时候用）",
 "body":"# 标题\n\n## 症状\n…\n\n## 做法\n1. 具体命令/参数\n\n## 验收\n用数字或返回体证明"}
```

- 已有技能要改：`{"action":"skill-update","name":"…","description":"…","body":"<完整正文>"}`（自动备份旧版）
- 规范见 `plugins/vx-workbench/skills/vx-skill-authoring/SKILL.md`
- 只写**跑通过的**步骤，带真实路径、偏移、数值；不要写空话，不要复制别人的技能内容

## 3. 技能有问题：申请删除，不要自己动手

```jsonc
{"action":"skill-request-delete","name":"vx-old","reason":"实测报错原文 / 已被哪个技能取代"}
```

删除权在人手里：申请会出现在面板「待批准」，批准后目录进 `vx-workbench/trash/skills/`（可恢复）。
**不要**直接删 `skills/` 下的文件，也不要手改 `docs/skills.md`（它是自动生成的）。

## 4. 无关技能

不要往全局技能目录里塞 VX 的东西；也不要在台账里混入无关技能。
发现分类不对，用面板的「归类」下拉框，或 `{"action":"skill-scope","name":"…","scope":"vx|other|auto"}`。

## 5. 网络注意

这台机器的 `hosts` 把 `github.com` / `api.github.com` 指到了 `127.0.0.1`。访问 GitHub 时用
`curl --resolve api.github.com:443:140.82.112.6`，git 走 SSH（`~/.ssh/config` 已指向 `ssh.github.com:443`）。
