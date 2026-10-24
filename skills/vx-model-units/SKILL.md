---
name: vx-model-units
description: Use when a model imports into Visual X-Space but is a few millimetres tall, lies on its side, or floats below the floor — unit (mm vs m) and axis (Z-up vs Y-up) conversion between Blender/FBX and VC.
---

# VX 模型尺度与朝向

## 症状 → 根因

| 症状 | 根因 |
|---|---|
| 车只有几毫米大 | 源数据是**米**，VC 内部按**毫米**读 → 差 1000 倍 |
| 车躺倒 / 侧翻 | FBX 存的是 **Y-up**，VC 直接当 **Z-up** 读 |
| 悬空或陷进地面 | 没有落地（`z != 0`）或原点不在几何中心 |

实测原始数据（SU7）：`4.997 × 2.240 × 1.437`，单位米，Y-up。

## 修法（Blender，脚本 `fix_su7.py` 的判定逻辑）

1. **判单位**：最长边 < 100 → 认为是米，整体 ×1000
2. **判朝向**：候选 {不动, 绕 X +90°, 绕 X −90°}，选「Z 轴是最小维度」的那个
   （车：长 > 宽 > 高 ⇒ 高必须落在 Z 轴上）
3. **烘焙变换**进顶点（不要只改对象变换，导出时容易丢）
4. **落地**：最低点 `z = 0`，XY 居中
5. **导出**：`axis_up='Z'`，**不做轴转换**，让 FBX 内部坐标本身就是 Z-up

导出命令形状：

```python
bpy.ops.export_scene.fbx(filepath=out, axis_up='Z', axis_forward='Y',
                         use_selection=True, apply_scale_options='FBX_SCALE_ALL')
```

## 验收（用数字，不用眼睛）

- 导入 VC 后量一下包围盒：`4997 × 2240 × 1437`（毫米），正立
- 与 `SU7_CAR.vcmx` 对比尺寸是否一致
- GLB 路线同理：Blender 里 ×1000、`axis_up='Z'`，导出 GLB 时保持米制也要再核一次

## 别做的事

- 不要在 VC 里手动缩放对象了事 —— 尺寸看着对了，材质 UV 与后续批量装配会错位
- 不要同时改坐标轴和加旋转，两者叠加会变成 180° 翻转
