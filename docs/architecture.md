# VX 自动化：架构选型 · 最优解（已实测，2026-10-24）

> 结论不是"多会一种方法"，而是把「改一步 → 重启 → 看结果」这条回路拆成三层，
> 并且**每一层的结论都用现场实验校准过**。下面是实验记录，不是推测。

---

## 0. 一句话结论

现在的可用架构是 **「声明式 spec → 一次触发跑一整批 → 结果回读」**：

```
spec / 手写 ops
      │
      ├─ vxcall.ps1 -Op ...            （单发，约 0.5–1.2 s 往返）
      └─ vxcall.ps1 -File ops.json     （整批，一次触发；21 个操作 86 ms）
                    │
                    ▼
        queue\<id>.req.json  →  用 UIA 点一下 ribbon「VS Bridge 2」
                    │              （命令宿主回调 OnStart）
                    ▼
        bridge_live.py 在 UI 线程执行 → queue\<id>.resp.json
```

**关键收益**：以前"一批 = 一次重启（含 52 MB 载入/保存，3–5 分钟）"，
现在"一批 = 一次点击 + 几十毫秒"。同一进程连续 13 次触发，PID 不变（45376）。

---

## 1. 实测结论（这些是踩出来的，不是查文档查到的）

| # | 事实 | 证据 |
|---|---|---|
| F1 | **命令入口是 `OnStart()`，不是 `OnExecute()`** | 9 个候选回调同时挂上后点击 → 日志只出现 `CALLBACK OnStart`；`OnExecute` 在 `Revolution.dll` 字符串表里根本不存在 |
| F2 | **模块体只在 load 时跑一次**；点按钮不会重跑 | 早期改 `cmdVSBridge.py` 加 `OnExecute` 后点击，`bridge.log` 无新行 |
| F3 | **UIA `InvokePattern` 足以触发 ribbon 命令** | `QATSaveFile` 能弹出保存对话框；`VSBridge2` 能触发 `OnStart` |
| F4 | **后台线程碰 VC API 直接崩引擎** | 事件日志：`0xC0000005` @ `rVariable.UnRef` / `PropertyWrapper+Sentinel.Delete`（finalizer 线程） |
| F5 | 连"只碰纯 Python"的 worker 线程 + `import clr` 也崩过一次 | 同一崩溃地址 `0x7e8fb0`，发生在 socket 线程/`clr` 初始化之后 |
| F6 | **`app` 的 Python 面是残缺的**：`dump --filter Save` 只有 `save`、`saveBitmap` | `IApplication.SaveLayout` 存在于 .NET 文档，但没暴露到 Python |
| F7 | `.vcmx` 是 ZIP，`layout.rsc` 是纯文本 VCMD 树（V6 全厂 52,284,810 字节） | 直接解压验证；含 21,705 处 material、865 处 color |
| F8 | 引擎里**没有**官方本地 RPC | 扫 `Revolution.dll`：`grpc`/`ApiServer`/`ServiceBase` 命中 0，无 `.proto` |
| F9 | `import bridge_live; reload()` 能热更新逻辑，**不用重启** | 改文件 → 复制 → 下一次触发即生效（ping 里 `loads` 递增） |
| F10 | **`app.save()` 只在启动批次里真的写盘** | `OnStart` 触发里 2 ms 返回、引擎日志无记录、文件不出现；同一句放进启动批 → 写出 1,843,600 字节 |
| F11 | 清场不能"预先算好删除列表" | 启动批从空场景开始，上一会话的组件名一个都不存在（7 条 delete 全 FAIL）；改成运行时 `clear(prefix)` 后 0 失败 |
| F12 | **配色可以用内置材质库** | `app.Materials` = 215 个（`aluminium`/`asphalt_new`/`*_matte`…），`c.Material = m` 赋值后 `c.Material.Name` 读回一致 |
| F13 | `CreateMaterial` 与 `IMaterial.Color` 都不可用 | `has_CreateMaterial == False`；逐项读 `.Color`/`.IsSystem` 抛异常（早期把整条记录吞掉 → 过滤返回 0 条） |
| F14 | 一个请求能装整条流水线 | 新增 `seq` op：启动批 10 个 op（load→clear→6×create→paint→save）一次跑完，0 失败 |
| F15 | **`app.load` 能载入 52 MB 全厂**，只是慢 | 560 个组件、**102 秒**、KRC4/KR 700 PA/KR 100 R3500 全在 |
| F16 | `app.getSimulation()` 只有开关，没有编程 | `run/halt/reset/continueRun/restoreInitialState/setInitialState/update/autoHalt/new*Detector` |
| F17 | 机器人组件**没有**程序对象 | `Program/Statement(s)/Routine(s)/ActionScript/Behaviour` 全 False；`getProperty('Speeds::JointSpeed')` → None |
| F18 | 唯一程序侧入口是命令 | `app.findCommand('simCreateActionScript')` 有 `execute/addState/setNextState/recompile`；配套 `vcScript` 有 `delay/getTrigger/triggerCondition/resumeRun/suspendRun` |
| F19 | 组件枚举顺序不稳定 | 两次采样第一台组件不同 → 校验一律按名字，不按序号 |

> **事故规则（14:05 记）**：存盘测试曾把 `SU7_FACTORY_V6.vcmx` 覆盖成 1.8 MB 测试场景
> （UI 另存为对话框里点了「保存(S)」，文件名不是我以为的那个）。
> 已从 `SU_FACTORY_V6_pre_bridge2.vcmx` 恢复，被覆盖件留证为 `SU7_FACTORY_V6.test-overwrite-1343.vcmx`。
> **今后**：任何 save/另存测试只准指向 `%TEMP%` 或临时文件名，且执行前先复制原件。

### 由此确定的硬约束

- **不能有线程**（F4/F5）→ 放弃 socket 常驻服务、放弃 idle 泵线程方案。
- **必须外部触发**（F2/F3）→ UIA 点按钮是正解，且可以程序化。
- **每批一次触发**（F9）→ 吞吐靠批量，不靠往返频率。

---

## 2. 技术清单与最终裁决

| # | 技术 | 裁决 | 依据 |
|---|---|---|---|
| T1 | 原地触发（UIA 点 ribbon） | ✅ **已落地** | F1/F3，往返 0.5–1.2 s |
| T2 | 进程内 socket + 常驻服务 | ❌ 放弃 | F4/F5：线程即崩 |
| T3 | Idle / DispatcherTimer 泵 | ❌ 放弃 | `app.OnIdle` 赋值不报错但从不回调；`clr` 不可用且试就崩 |
| T4 | .NET API 直通补洞 | ⚠️ 部分可用 | F6：`Materials/CreateMaterial` 有，`SaveLayout` 没有；颜色要用 `IMaterial.Color` 走 python 包装 |
| T5 | 独立 .NET 宿主（无 GUI） | ⏸ 暂不押 | 稳定性未知，且 T1 已解决 90% 的痛点 |
| T6 | `layout.rsc` 文本级生成 | ⏸ 备选副链 | F7：可行，但语义覆盖低，只适合放置/改名/配色 |
| T7 | 声明式 spec 编译器 | ✅ **下一步主线** | 唯一能治"面多加水"（幂等重建 + diff） |
| T8 | 多实例并行 merge | ⏸ 规模上来再说 | `app.load` 合并语义可用，但当前瓶颈不在算力 |
| T9 | UI 自动化兜底 | ✅ 已验证可用 | 就是现在的触发器 |
| T10 | Blender 几何流水线 | ✅ 沿用 | `fix_su7.py` 已成熟，VC 只做装配 |

---

## 3. 为什么不是"两三种方法合并"

同一条反馈回路上叠三套 = 复杂度税。真正有效的组合是**分层**：

- **通道**：队列 + UIA 触发（T1）—— 只有这一条，不并行第二套。
- **语义**：spec → ops（T7）—— 负责"改什么"，与通道解耦。
- **兜底**：手工改 `bridge_live.py` 后热更新（F9）—— 负责"通道本身要改"。

串行点上只有一件事：**一次触发**。所以要优化的是"每次触发能塞多少操作"，
而不是"每秒触发多少次"。21 op / 86 ms 就是这么来的。

---

## 4. 实测性能

| 场景 | 应用内耗时 | 端到端墙钟 |
|---|---|---|
| `ping` | < 1 ms | ~0.7–1.1 s（PowerShell + UIA + 轮询） |
| `state`（空布局） | < 1 ms | ~0.5–1.1 s |
| `create` ×1 | ~4 ms | ~1.1 s |
| **`create` ×20 + `state`** | **86 ms** | **1.9 s** |

端到端那 1 秒几乎全是外部脚手架（`Add-Type`、UIA 树遍历、50 ms 轮询）。
要更快就把轮询降到 20 ms、复用已解析的按钮元素，或干脆常驻一个 PowerShell 进程。

---

## 5. 落地状态

- ✅ `cmdVSBridge2.py`：加载器 / 回调适配（`OnStart` + `OnIdle` 别名），已装到
  `My Commands\su7line\`，并在 `__init__.py` 里注册了 ribbon 按钮「VS Bridge 2」。
- ✅ `bridge_live.py`：全部 ops（ping/state/components/dump/create/move/clone/
  batch_clone/delete/**clear**/sim/save/load/**materials**/**paint**/eval/**seq**），
  UI 线程批量执行，`gc.collect()` 收尾冲掉包装器 finalizer。
- ✅ `vxcall.ps1`：单发 + `-File` 批量，自带超时与错误码。
- ✅ `spec_build.py`：`spec.json → ops → 一次触发 / 一次重启`，幂等重建 + 校验。
- ✅ `vxeval.py` / `probe_*.py`：用文件写探针，避开 shell 引号地狱。
- ⚠️ `vxsave.ps1`：UI 自动化存盘，**实验性**（shell 另存为对话框的「保存(S)」是自定义 Pane，
  UIA Invoke 与合成点击都不稳定）→ 生产上走 `spec_build --boot`。
- ⏸ 下一步（未做）：`layout.rsc` 副链（无 VC 改放置/配色）、多实例并行 merge。

### 5.1 两种执行模式（按要不要存盘选）

| | 交互式 | 启动式 `--boot` |
|---|---|---|
| 触发 | UIA 点 ribbon（约 1 s） | 关 VC → 写队列 → 重启 → 启动批 |
| 速度 | 16 op ≈ 2.5 s | 10 op ≈ 46 s（含启动） |
| save | 不落盘（F10） | 落盘（实测 1.84 MB，zip 36 条目，`layout.rsc` 173,963 字节） |
| 场景 | 试摆位、改配色、查状态 | 出成品 |

spec 幂等性实测：同一份 spec 连跑两次 —— 第一次 8 op，第二次 16 op（7 删 7 建），
结果组件数恒为 7，命名 7/7 命中。

---

## 6. 风险与止损

| 风险 | 信号 | 止损 |
|---|---|---|
| 又崩引擎 | 事件日志 `0xC0000005` @ Revolution | 只在 UI 线程动 API；新增代码里出现 `threading` 就地删掉 |
| ribbon 按钮消失 | `vxcall` 报 "button not found" | 查 `bridge2.log` 是否有 `module loaded`；`__init__.py` 的 `_load` 是否还在 |
| 队列积压 | `-File` 超时、日志只有 `batch start` | 看 `bridge2.log` 每条耗时；单条 > 2 s 的就是嫌疑（多半是大 `load`/`save`） |
| 版本升级 | 补丁偏移变、`OnStart` 失效 | 保留本文件 F1 的探针手法：一次挂 9 个回调，让引擎自己说 |
