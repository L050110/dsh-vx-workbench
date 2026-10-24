---
name: vx-cad-import-repair
description: Use when Visual X-Space 4.8 refuses to import FBX/STEP/STL ("CAD license not found"), silently produces nothing after a byte patch (0x8013141A), or you need to verify/restore the CAD-import compatibility repair on a Windows install.
---

# VX CAD 导入修复（两道门）

目标：让 Visual X-Space 4.8（HANDI 版 Visual Components）能导入带纹理的 FBX/STEP/STL。

## 症状 → 判定

| 症状 | 是哪道门 |
|---|---|
| 导入就弹 `Cannot load CAD file. CAD license not found.`，不进转换 | 第一道门（HOOPS 授权判定） |
| 改字节后**不报错也不生成**，引擎日志 `FileLoadException … 0x8013141A` | 第二道门（CLR 强名称验证） |
| 能导入但模型几毫米大、躺倒 | 不是门禁问题，见 `vx-model-units` |

## 第一道门：授权判定跳转

`VisualComponents.HOOPS.dll` 里 `Reader::Import` 的判定结构（x64 原生代码）：

```
E8 xx xx xx xx        call   授权检查（Utils.HasLicense）
84 C0                 test   al, al
75 19                 jne    ok            ← 就是这一条
BA FF FF FF FF        mov    edx, -1
48 8D 0D xx xx xx xx  lea    rcx, "Cannot load CAD file. CAD license not found."
32 C0                 xor    al, al
```

改法：把 `75`（jne）→ `EB`（jmp），条件跳转变无条件，后续 `ImportModel()` 的几何解析与材质通道原样保留。

**不要用死偏移**（老办法写死 173095）。用插件自带的特征码器定位，换 build 也能认：

```powershell
# 只扫描，不动文件
node <插件目录>\lib\patch.mjs scan "C:\Program Files\HANDI\Visual X-Space 4.8\VisualComponents.HOOPS.dll"
# 打补丁（自动备份 + 回读校验）
node <插件目录>\lib\patch.mjs patch "<dll>" --backup "<dll>.vx-original.bak"
# 还原
node <插件目录>\lib\patch.mjs restore "<备份>" "<dll>"
```

判据（4.8 这一版）：文件 684,544 字节；补丁点 opcode 偏移 173095；原版 sha256 以 `F1173CA9` 开头，补丁版以 `8FDA1C3A` 开头；全文件只差 1 字节。

返回 `action=unsupported` = 此 build 特征码没命中，**停下报告**，别猜偏移；`action=ambiguous` = 命中多处，需要人工指定。

## 第二道门：CLR 强名称（三件套，缺一不可）

改过的程序集签名对不上，CLR 直接拒绝加载，表现为「静默失效」。

1. 清零 `COMIMAGE_FLAGS_STRONGNAMESIGNED` 位 + 清签名块（声明不是强名称程序集）
2. 注册表登记免验证：
   `HKLM\SOFTWARE\Microsoft\StrongName\Verification\VisualComponents.HOOPS,31bc53bc7503b77a`
3. `HKLM\SOFTWARE\Microsoft\.NETFramework` → `AllowStrongNameBypass = 1`

顺序无所谓，但**三条都要有**；只做 1、2 会继续 0x8013141A。

## 收尾规则（这套流程的纪律）

- 改前备份，改后**回读**：文件读回目标字节、注册表读回键值——只看"命令没报错"等于假成功
- 还原要连注册表项一起清，不留残渣
- 不动原件：产物另存新文件名
- 面板「一键修复/还原」等价于跑 `install.ps1` / `restore.ps1`（需要管理员 + UAC，路径由 `VX_REPAIR_DIR` 指定）

## 验收

1. `scan` 返回 `state=patched`、`opcode=0xEB`、`sites=1`
2. 面板「加载链修复」显示正常
3. 重启 CAD 后导入 FBX，模型进入转换流程（大小/朝向问题另算）
