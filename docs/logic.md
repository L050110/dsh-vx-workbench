# VX 破解 · 工作逻辑（现场记录）

> 这份文档就摆在工作台里。你在面板里提需求时，可以对照这里看我在做什么、为什么这么做。

## 1. 目标

让 Visual X-Space 4.8 能导入带纹理的车模型（FBX / STEP / STL 等），并把 SU7 装进厂区。

## 2. 第一道门：HOOPS CAD 导入授权

**症状**：任何 CAD 文件一导入就弹 `Cannot load CAD file. CAD license not found.`，根本不进转换流程。

**定位路径**（Ghidra 静态分析，样本 `VisualComponents.HOOPS.dll`）：

1. 字符串 `Cannot load CAD file` 在 UTF-16 段，落在 RVA `0x53BB0`。
2. 反查交叉引用 → 唯一引用点 `Reader::Import`（RVA `0x2AFE0`）。
3. 反汇编出判定结构：

```
E8 DB B2 01 00        call   授权存根            ← managed Utils.HasLicense
84 C0                 test   al, al
75 19                 jne    ok                  ← 关键跳转
BA FF FF FF FF        mov    edx, -1
48 8D 0D 7B 8B 02 00  lea    rcx, "Cannot load CAD file. CAD license not found."
                      call   AddError
32 C0                 xor    al, al              ← return false
```

**改法**：`0x2B027` 处 `75 19` → `EB 19`（条件跳转改无条件，授权结果不再影响流程）。
**为什么这样改**：真正的转换逻辑在后面的 `ImportModel()`，只跳过门禁，转换器、几何解析、材质通道全部原样保留。

## 3. 第二道门：CLR 强名称验证（真正卡住的那一步）

只改字节后现象变成「不报错也不生成」。引擎日志给出答案：

```
Failed to load assembly: 'VisualComponents.HOOPS.dll'
FileLoadException: 强名称验证失败 (0x8013141A)
```

改过的程序集签名必然对不上，CLR 直接拒绝加载 → CAD 导入功能整个静默失效。

**解决三件套**（缺一不可）：

| 项 | 作用 |
|---|---|
| 清零 `COMIMAGE_FLAGS_STRONGNAMESIGNED` 位 + 签名块 | 声明这不是强名称程序集 |
| `HKLM\SOFTWARE\Microsoft\StrongName\Verification\VisualComponents.HOOPS,31bc53bc7503b77a` | 登记该程序集免验证（等价 `sn -Vr`） |
| `HKLM\...\.NETFramework\AllowStrongNameBypass = 1` | 允许完全信任程序集跳过验证 |

**证据**：原版 sha256 `F1173CA9…`，补丁版 `8FDA1C3A…`，文件长度不变（684544 字节），偏移 173095 处 `0xEB`。

**备份/还原**：安装脚本先把原版拷到 `backup_原版\`，还原脚本只拷回文件 + 删注册表项，不留残渣。

## 4. 第三个问题：模型太小、倒着

**症状**：导入成功但车只有几毫米大、且躺倒。

**根因**（在 Blender 里量出来的原始数据）：

- 尺寸 `4.997 × 2.240 × 1.437`，单位是**米**；VC 以**毫米**为单位 → 差 1000 倍。
- 旧 FBX 按 **Y-up** 存储；VC 直接把这些数值当 **Z-up** 读 → 车躺倒。

**改法**（Blender 脚本 `fix_su7.py`，自动判定）：

1. 最长边 < 100 → 判定为米，整体 ×1000。
2. 候选朝向 {不动, 绕 X +90°, 绕 X −90°}，取「Z 轴是最小维度」的那个（车：长 > 宽 > 高）。
3. 变换烘焙进顶点，落地到 z=0、XY 居中。
4. 以 `axis_up='Z'` 导出，**不做轴转换**，让 FBX 内部坐标直接就是 Z-up。

**结果**：`4997 × 2240 × 1437 mm`，正立。另存为 `SU7_CAR.vcmx` 作为可复用整车。

## 5. 工作方式（我在这套里怎么干活）

- **能脚本化就不手点**：VC 有 Python 桥（`cmdVSBridge`），队列只在启动时执行 → 一批 = 一次重启，所以每批都把「载入 → 改造 → 保存」写全。
- **改判断先找证据**：断言地址必须用预期字节核对（`expected` 不匹配就拒绝写入），避免打错位置。
- **改完必须回读**：文件改完回读偏移、注册表回读键、接口回读返回体 —— 只看「命令没报错」= 假成功。
- **不动原件**：所有产物另存新文件名，原版和其它 DLL 一律备份。
- **可回滚**：每一步都有还原脚本；注册表项也一并清理。

## 6. 工作台的提问通道（怎么把需求变成对话输入）

| 环节 | 实现 |
|---|---|
| 面板 → Host | `POST /vxwb {action:'ask', text, newSession}` |
| 找目标会话 | `sessionController.list()`：优先取 `running`，否则取最近 `updatedAt`，排除 `origin==='subagent'` |
| 发到当前对话 | 直接 `prompt({sessionId, mode:'queue'})` |
| **发到新对话** | 先 `inspect(ref).meta.agentPreset` 取到当前 preset → `create({cwd, agentPreset})` → 再 `prompt` 到新会话 |
| 不重新培训 | 新会话正文前自动拼 **交接简报**（工作目录/数据目录/破解包/补丁现状/资产清单/踩坑清单），同时落盘 `vx-workbench/handoff.md` |
| 看回执 | `POST {action:'tail', sessionId}` → `sessionController.inspect()` 提取该会话最后一条 assistant 文本 |

**为什么要带 preset**：`create()` 不传 `agentPreset` 会生一个默认配置的会话，工具和技能都不一样，等于"换了个新手"。带上之后新会话与当前会话工具集完全一致。

**实测（2026-10-24）**：新会话自报 307 个工具、工作目录正确、能复述并**实机核对**补丁（偏移 173095、`75 19 → EB 19`、全文件差异 129 字节），即开箱可干。

## 7. 待办

> 架构选型与「为什么现在慢」的完整分析见 **`docs/architecture.md`**；
> 零重启通道的落地件在 `vx-workbench\live_bridge\`（旁挂，不动本文件描述的旧桥）。

## 8. 2026-10-24 更新：不再"一批一重启"

- 命令入口实测是 **`OnStart()`**（不是 `OnExecute`），UIA 点 ribbon 即可程序化触发。
- 通道：`queue\<id>.req.json` + 一次点击 → 同一进程内执行 → `resp.json`；
  连续 13 批 PID 不变。批量 21 个操作 ≈ 86 ms（应用内）。
- **禁止在线程里碰 VC API**：后台线程会让引擎 `0xC0000005` 崩溃（已复现两次）。
- 用法见 `vx-workbench\live_bridge\README.md`，入口脚本 `vxcall.ps1`。

- [x] **着色**：`vcMaterial` 确实没有 Color，但 `app.Materials` 有 215 个内置材质
      （`aluminium` / `asphalt_new` / `*_matte`…），`c.Material = m` 赋值并读回一致；
      `CreateMaterial` / `IMaterial.Color` 不可用，所以只能用**材质名**，不能用 RGB 造。
      批量做法：`spec.json` 里写 `"paints":[{"match":"CELL_*","material":"aluminium"}]`。
- [ ] 车身银色 / 机器人白色美化（逐组件改 Material，量大，建议先试点涂装车间）
      → 现在可以直接用 spec 的 `paints` 批量刷，先试点再铺开。
- [ ] AGV 车队（组件只能拖拽插入，尚未找到 API 通道）
- [ ] 出厂队列改成斜列 + 车道标线（当前是直线一排）

> 出成品要存盘：`python spec_build.py spec.json --boot`（`app.save` 只在启动批次里真落盘）。

## 8. 技能台账（自动迭代 · 0.2.0 起）

**问题**：技能是散在磁盘上的 `SKILL.md`，会话不会自己知道"又装了新技能"，我也不该靠记忆猜技能名。

**做法**：Host 半边自带一个技能扫描器，插件加载即跑一次，之后每 5 分钟一次，全程无需 HTTP、无需页面开着。

| 环节 | 实现 |
|---|---|
| 扫描根目录 | 工作区 `skills/`、工作区 `.dsh/skills`、`<profile>/skills`、`~/.dsh/skills`、dsh 内置 `node_modules/@deepseek-ai/dsh-agent-preset/skills`（存在的才扫） |
| 技能识别 | 每个含 `SKILL.md` 的目录 = 一个技能；`name`/`description` 取 YAML frontmatter |
| 指纹 | `sha256(SKILL.md 字节 + 目录内其余文件 (相对路径,大小) 排序)`，改正文、加/删 references 都会变 |
| 状态落盘 | `vx-workbench/skills.json`（清单 + 指纹 + 本次差异） |
| **知识迭代** | 每次扫描重写 `plugins/vx-workbench/docs/skills.md`（索引 + 变化记录 + 扫描根 + 用法），旧内容不留 |
| 变化记录 | 有增/改/删时追加 `log.jsonl`，`kind: 'skills-diff'`，形如 `+新技能 ~改过的 -删掉的` |
| 首次扫描 | 只建基线，**不**把已有技能报成"新增"（避免一装插件就刷 20 条噪音） |
| 交接简报 | 自动多一行「技能台账 N 个技能（digest xxxx）→ 路径」，新会话开箱就知道去读哪个文件 |

**要把老会话也通知到**：`POST /vxwb {action:'skills-broadcast', dryRun:true, maxAgeHours}` 先看目标数，
去掉 `dryRun` 才真发；`maxAgeHours:0` = 全部可见会话（实测 94 个，慎用，每个会话会跑一轮）。
发送内容是 `skillsNotice()` 生成的紧凑通知（变化 + 台账路径 + 技能名列表，≤3.5KB），
走 `sessionController.prompt({mode:'queue'})`，与 `ask` 通道同一条路，只多了一个"遍历多个会话"。

**省 token 的替代**：不推送，让那边会话自己读 —— 一句话 `read plugins/vx-workbench/docs/skills.md` 即可，
台账里已标明每个技能属于哪个根目录，正文再按需 `read` 各自 `SKILL.md`。

**开关**：面板「变化时自动通知会话」默认关（`skills.json.autoNotify`）。开启后只有检测到增/改/删时才广播，没有变化不发。

### 8.1 OpenViking 技能（`viking://`，0.3.0 起）

`viking://~/skills` 和 `viking://agent/skills` 是**库路径，不是文件**，`read`/`readdir` 一律够不到，所以磁盘扫描永远看不到它们。两条通道，按顺序试：

| 通道 | 做法 | 依赖 |
|---|---|---|
| 直连 | 读 `~/.openviking/ov.conf`、`ovcli.conf` 里的 `url`（或环境变量 `OPENVIKING_URL`）拿 `baseUrl`，对 `${baseUrl}/mcp` 走 MCP-over-HTTP：`initialize` → `tools/call tree{uri, level_limit:1, include_abstract:true}`，两个根各来一次 | OpenViking 服务在跑；不需要 agent 参与 |
| 快照 | 任一 agent 会话调 openviking 的 `tree` 工具，把结果 `POST /vxwb {"action":"ov-ingest",...}`，落盘 `vx-workbench/ov-skills.json` | 只要 MCP 可用 |

- 直连成功会顺手把结果写成快照，**服务挂了也还有冷备**；直连失败则退回快照，台账里标 `snapshot` 并带时间戳。
- 状态四态：`live`（直连）/ `snapshot`（用冷备）/ `unreachable`（连不上）/ `unconfigured`（没有配置文件）。
- 两种技能同名时**本地优先**（harness 已加载的那份算数）；台账里 OpenViking 的技能带 `(ov)` 后缀，指纹按 `uri + 描述 + updated_at` 算，`ov` 与本地同名互不覆盖。
- 面板卡片会显示 OpenViking 状态 + 数量 + 快照时间，并有「检测 OpenViking」「复制抓取指令」两个按钮；状态不是 live 时把抓取指令直接摊在面板上，复制粘到任一对话即可。
- 明确不做：不写 OpenViking、不删技能、不上传本地技能 —— 只读目录。


