---
name: vx-line-build
description: Use when driving Visual X-Space 4.8 programmatically to build or modify a production line — running the Python bridge command queue, batching layout edits, painting components by material name, or saving a .vcmx result.
---

# VX 自动化产线改造（Python 桥）

## 通道机制（先记住这几条，否则会白等）

- 命令入口是引擎的 **`OnStart()`**（不是 `OnExecute`）：往队列里放一个请求文件，再用 UIA 点一次 ribbon 上的启动按钮，同一进程内执行，结果写 `resp.json`。
- 队列目录：`C:\Users\lenovo\Documents\HANDI\4.8\My Commands\su7line\queue\`
  - 请求 `<id>.req.json` → 响应 `<id>.resp.json`
- 批量跑很快（实测 21 个操作 ≈ 86 ms），**连续多批 PID 不变**，不需要重启应用。
- **绝对禁止在后台线程里碰 VC API** —— 会让引擎 `0xC0000005` 崩溃（已复现两次）。所有调用必须在 `OnStart()` 那次同步执行里完成。

## 语义坑（踩过的）

| 坑 | 事实 |
|---|---|
| `app.load` | **合并语义**，不是替换。想替换要显式清场景 |
| `app.save` | 只在**启动批次内**才真正落盘；普通调用无声无息 |
| 大文件 | >30MB 的 `.vcmx` 直接用 CLI 打开会卡死，要用 GUI 或队列方式 |
| 覆盖保存 | `app.save` 只能写新文件名；覆盖同名要走 GUI `Ctrl+S` → 另存为 |
| 材质 | `vcMaterial` 没有 `Color`；`CreateMaterial` / `IMaterial.Color` 不可用。**只能用内置材质名**（`app.Materials` 里 215 个，如 `aluminium` / `asphalt_new` / `*_matte`），`c.Material = m` 赋完要读回校验 |

## 批量刷材质（spec 驱动）

`spec.json` 里写匹配规则，让脚本批量套：

```json
{ "paints": [ { "match": "CELL_*", "material": "aluminium" } ] }
```

出成品存盘：

```powershell
python spec_build.py spec.json --boot     # --boot 才会真正落盘
```

## 典型作业顺序

1. 明确改动范围（哪个车间、哪些组件名/匹配模式）
2. 写成一份 `spec.json`（不要手点，也不要一条条发命令）
3. 跑一次带 `--boot` 的批量，读 `resp.json` 确认每个操作的结果
4. 读回验证：组件数、材质名、位置坐标 —— 以**数据**为证据
5. 另存新文件名（例如 `SU7_FACTORY_V7.vcmx`），不要覆盖上一版

## 参考产物（这台机器上已有）

| 文件 | 内容 |
|---|---|
| `SU7_FACTORY_V6.vcmx` | 35.2MB，最新厂房（四车间） |
| `SU7_FACTORY_4SHOP.vcmx` | 31.9MB，四车间版 |
| `SU7_CAR.vcmx` | 1.8MB，可复用整车（尺度已修正） |

## 未完成的（别当成已有能力）

- AGV 车队：组件目前只能拖拽插入，没找到 API 通道
- 出厂队列改斜列 + 车道标线：仍是直线一排
