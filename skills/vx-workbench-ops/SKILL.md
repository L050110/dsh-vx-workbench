---
name: vx-workbench-ops
description: Use when operating or debugging the VX workbench plugin itself — its /vxwb endpoints, the skill ledger, conversation broadcast, OpenViking ingest, or when the panel shows "not configured" / a version that is not supported.
---

# VX 工作台自身怎么操作

## 端点一览（Host 半边，`POST http://127.0.0.1:63536/vxwb`）

| action | 作用 | 关键参数 |
|---|---|---|
| `GET /vxwb` | 当前快照（DLL 状态、注册表、资产、技能、日志） | — |
| `install` / `restore` | 跑 `install.ps1` / `restore.ps1`（需 `VX_REPAIR_DIR`、管理员 + UAC） | — |
| `open-install` / `open-repair` / `open-delivery` | 打开对应目录 | — |
| `open-file` | 资源管理器中定位某个 `.vcmx` | `name` |
| `log` | 追加一条工作记录 | `text` |
| `ask` | 把一句话作为**用户消息**送进会话 | `text`, `newSession` |
| `tail` | 读某会话最后一条 assistant 回复 | `sessionId` |
| `skills-scan` | 立即重扫技能并重写台账 | — |
| `skills-settings` | 开关「变化时自动通知」 | `autoNotify` |
| `skills-broadcast` | 把技能变更通知推给已存在的会话 | `dryRun`, `maxAgeHours`, `ids`, `cap` |
| `sessions` | 列出可推送目标（只读） | `maxAgeHours`, `onlyRunning` |
| `ov-check` | 探测本机 OpenViking | — |
| `ov-ingest` | 收下一份 OpenViking 目录快照 | `roots` 或 `entries` |

## 技能台账

- 扫描根：插件自带 `skills/`、工作区 `skills/`、工作区 `.dsh/skills`、`~/.dsh/profiles/*/skills`、`~/.dsh/skills`、dsh 内置 preset skills
- 每 5 分钟自动重扫（插件加载 2 秒后先跑一次），台账写 `plugins/vx-workbench/docs/skills.md`
- 指纹 = `sha256(SKILL.md + 目录形状)`；首次扫描只建基线，不刷"新增"
- 推送前先用 `dryRun:true` 看目标数；`maxAgeHours:0` 是全部会话（本机实测 94 个，慎用，每个会跑一轮）

## OpenViking

`viking://` 不是文件，够不到。顺序：直连（`~/.openviking/ov.conf` 的 `url` → `${baseUrl}/mcp`）→ 否则用 agent 推来的快照。
状态四态：`live` / `snapshot` / `unreachable` / `unconfigured`。抓取指令可在面板「复制抓取指令」取。

## 故障排查

| 现象 | 处理 |
|---|---|
| 面板「未配置」 | 设 `VX_INSTALL_DIR` / `VX_REPAIR_DIR` / `VX_DELIVERY_DIR` 后重启 profile |
| 面板「此版本未适配」 | 跑 `node lib/patch.mjs scan <dll>`，把 sha256 带去提 issue；不要手动猜偏移 |
| 面板空白 / 未就绪 | Host 半边没加载：`plugin_manager set_bundle enabled=false` 再 `true`，然后刷新页面 |
| 台账 0 个技能 | 扫描根下没有 `SKILL.md`，或非 Electron 宿主下 `VX_DSH_ROOT` 不对 |
| 推送没反应 | 看 `vx-workbench/log.jsonl` 的投递记录；消息是**排队**送达 |

## 纪律

- 面板文字改动要刷新页面才生效（本机没有 `pnpm run dev:web` watcher）
- 改插件代码后必须 `set_bundle false/true` 重载才生效，并用 `/vxwb` 验证返回体，不要只看日志
