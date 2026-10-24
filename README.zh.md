# dsh-vx-workbench

**把 Visual X-Space 变成一条命令的车间。** 修好 CAD 导入链路，FBX / STEP / STL 直接进；
按参数长出产线；再附一份自己维护的技能台账——agent 不再凭记忆猜技能名。

[![npm](https://img.shields.io/npm/v/dsh-vx-workbench.svg)](https://www.npmjs.com/package/dsh-vx-workbench)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-111.svg)](#环境要求)

![厂区总览](assets/overview.png)

## 它做什么

- **CAD 导入兼容修复** —— 按机器码形状定位判定点（不是死写文件偏移），打补丁、回读校验、原版一键还原。
  换一个 build 找不到时，会明确说「此版本未适配」，而不是静默失败。
- **工厂资产面板** —— 列出交付目录里每个 `.vcmx`（大小、时间、定位按钮）。参数化产线生成在下方
  路线图里，尚未随本版本提供，这里不把它算进已交付能力。
- **自己维护的技能台账** —— 每 5 分钟给磁盘上每个 `SKILL.md` 打指纹（有 OpenViking 时连
  `viking://` 技能一起），重写 `docs/skills.md`，记录新增/变更/移除；一键把变更通知推进你已开着的会话。
- **技能会自己长** —— 台账把「工作站自己的技能」（`.vcmx` / CAD / 桥操作）和无关的全局技能
  分开：后者只登记、不混进来。任何会话都能通过 `POST /vxwb {"action":"skill-add",…}` 写新技能；
  技能坏了**不是模型说删就删**，而是登记成删除申请等你批准（目录移入 `vx-workbench/trash/skills/`，
  可恢复）。无关的全局技能用 `{"action":"skill-ignore","all":true}` 隐藏，文件一个不动。

| 面板 | 提需求通道 | 车间结果 |
|---|---|---|
| ![面板](assets/panel.png) | ![提需求](assets/panel-ask.png) | ![焊装车间](assets/weld-shop.png) |

## 环境要求

| | |
|---|---|
| 系统 | Windows（兼容层对接的是 Windows 版 CAD 安装） |
| DSH | `>= 0.2.1-rc.2` |
| Visual X-Space | 4.8（其它 build 只识别并报告，不盲改） |

## 安装

```powershell
dsh plugin --profile web add dsh-vx-workbench
```

也可以在插件市场（`Plugins → Discover`）里点安装。装完若侧栏没出现，重新启用一次 bundle 并刷新页面，
入口名是 `VX 工作台`。

## 配置

全部走环境变量，代码里不含任何个人路径；没配置时面板显示「未配置」，不会瞎猜目录。

| 变量 | 含义 | 默认 |
|---|---|---|
| `VX_INSTALL_DIR` | Visual X-Space 安装目录 | `C:\Program Files\HANDI\Visual X-Space 4.8` |
| `VX_REPAIR_DIR` | 放 `install.ps1` / `restore.ps1` 的目录（可选） | 无 |
| `VX_DELIVERY_DIR` | 放 `.vcmx` 布局的目录（可选） | 无 |
| `VX_DSH_ROOT` | dsh 安装根，仅非 Electron 宿主需要 | 自动 |

改完重启 profile 生效。

## 能力与权限（如实披露）

| 能力 | 用在哪 |
|---|---|
| `fs-read` | 读 CAD 程序集定位判定点；扫描各技能根目录的 `SKILL.md` |
| `fs-write` | 写台账 `docs/skills.md`、`vx-workbench/*.json`、`log.jsonl`，以及 DLL 的原版备份 |
| `shell` | `reg query`、`tasklist`；以及**你按下按钮时**才执行的 `powershell -File install.ps1 / restore.ps1` |
| `network` | 可选：对本机 OpenViking 服务做一次环回 MCP 调用（`${baseUrl}/mcp`）。数据不出本机 |

不写你的工程源码、不上传任何东西、不会自己启动 CAD 进程。

## 数据与隐私

全部落在工作区的 `vx-workbench/` 下：`status.json`（当前快照）、`skills.json`（技能清单+变更集）、
`log.jsonl`（追加式工作日志）、`requests.jsonl`（发给了哪些会话）、`ov-skills.json`（OpenViking 快照，可选）；
台账本体在 `plugins/vx-workbench/docs/skills.md`。无遥测、无统计上报。

## 兼容修复，一段话说完

CAD 导入路径最后有一段短分支：*调一个检查 → 测返回值 → 通过就跳过失败块*。本插件用这个分支前后的
15 个字节去定位它（所以代码被重排也认得出），然后把这条分支改成无条件。改前先存原版字节，改后回读校验，
一键可还原；特征码找不到或命中多处时**停下来报告**，不猜。

```powershell
# 只扫描，不动文件
node lib/patch.mjs scan "C:\Program Files\HANDI\Visual X-Space 4.8\VisualComponents.HOOPS.dll"
```

## 技能台账

- 扫描根：工作区 `skills/`、工作区 `.dsh/skills`、`~/.dsh/profiles/*/skills`、`~/.dsh/skills`、dsh 自带 skills。
- 指纹 = `sha256(SKILL.md 字节 + 目录内其它文件的形状)`，改正文、加 `references/` 都算变更。
- 首次扫描只建基线，**不会**把已有技能报成「新增」。
- `POST /vxwb {"action":"skills-broadcast","maxAgeHours":168}` 把变更通知推进已开着的会话
  （排队送达：忙的会话当前回合结束再读，闲的会话会被唤醒跑一轮，会烧 token，所以默认不自动）。

## OpenViking（可选）

`viking://` 是库路径不是文件，所以两条通道：服务在跑时直连 `${baseUrl}/mcp`（URL 取自
`~/.openviking/ov.conf` 或 `OPENVIKING_URL`）；否则用 agent 推来的快照
（`POST /vxwb {"action":"ov-ingest","roots":{...}}`）。状态只会是 `live` / `snapshot` /
`unreachable` / `unconfigured`，不会静默失败。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 面板显示「此版本未适配」 | 特征码没命中你的 build。跑 `node lib/patch.mjs scan <dll>`，把 `sha256` 贴到 issue。 |
| 修复后 CAD 仍拒绝导入 | 加载链是第二道门：面板里打开加载链修复，然后重启 CAD。 |
| 面板空白 / 「未就绪」 | Host 半边没加载。重新启用 bundle，再刷新页面。 |
| 台账 0 个技能 | 扫描根下没有 `SKILL.md`，或非 Electron 宿主下 `VX_DSH_ROOT` 不对。 |
| 推送没反应 | 消息是排队送达的，看 `vx-workbench/log.jsonl` 里的投递记录。 |

## 路线图

- [x] 特征码兼容修复（备份 / 还原 / 回读校验）
- [x] 自维护技能台账 + 会话广播
- [x] OpenViking 目录摄取（直连 + 快照）
- [ ] 参数化产线生成器（线体 / 工位 / 节拍 / 机器人 / AGV）
- [ ] 仿真跑完的节拍与瓶颈报表
- [ ] 模板资产按需下载（不塞进包体）

## 许可

[MIT](LICENSE) © 2026 作者
