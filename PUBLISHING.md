# 发布手册（给自己看，也是上线清单）

仓库已经准备好：25 个文件、15/15 测试通过、打包 49.4 kB。

## 0. 现状

| 项 | 状态 |
|---|---|
| 本地 git 仓库 + 首次提交 `f18aaed` | ✅ |
| `npm run check` / `npm test`（15 个用例） | ✅ 全绿 |
| `npm pack` 体积 | ✅ 49.4 kB / 15 files（大资产不进包） |
| 专用 SSH 密钥 | ✅ `~/.ssh/id_ed25519_l050110`（**还没加到账号**） |
| 网络：github.com:443 | ❌ 被卡（TLS 超时）；指到 `140.82.112.3` 可 200（慢） |
| 网络：api.github.com / ssh:22 / ssh:443 / registry.npmjs.org | ✅ 通 |
| 网络：www.npmjs.com | ❌ 被卡 → `npm login --auth-type=web` 走不通 |

## 1. 需要人工完成的两件事（三选二）

### 路线 A（最省事，一次交给 agent 全办完）

1. 在**能打开 github.com 的设备**（手机流量通常可以）上：
   Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token
   勾选：`repo`、`admin:public_key`、`workflow`（仓库里有 `.github/workflows/ci.yml`），有效期 30 天。
2. 把 token 存成文件（**不要贴聊天**）：
   ```
   C:\Users\lenovo\token.txt      ← 一行，纯 token，无引号无空格
   ```
3. 告诉 agent「token 放好了」。它会：
   - `gh auth login --with-token`（走 api.github.com，不需要 device flow）
   - `gh repo create L050110/dsh-vx-workbench --public`
   - `gh api user/keys -X POST` 把 `id_ed25519_l050110.pub` 装到账号
   - `git push -u origin main`（走 SSH，22 端口通）
   - 最后删掉 `token.txt`

### 路线 B（不给 token，两下点击）

1. 手机上 GitHub → Settings → **SSH and GPG keys** → New SSH key，粘贴公钥：
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIpVk0qSFsMFweMl6GU5kLEwKd4fQYqKGZV9YNXO0BnO L050110@dsh-vx-workbench
   ```
2. 手机上建一个**空仓库** `dsh-vx-workbench`（不要 README / .gitignore / license）。
3. 告诉 agent「加好了」，它执行：
   ```
   git remote add origin git@github.com:L050110/dsh-vx-workbench.git
   git push -u origin main
   ```

## 2. npm 发布（GitHub 完成后）

`www.npmjs.com` 本机打不开，所以网页登录方式走不通。两条备选：

- 在能上 npmjs.com 的设备上：Account → Access Tokens → **Generate New Token (Granular)**，
  Packages 选 read/write，存成 `C:\Users\lenovo\npmtoken.txt`，agent 用
  `npm config set //registry.npmjs.org/:_authToken=...` 后 `npm publish`。
- 或者先只发 GitHub，市场条目也能用 `github:` 规格安装（`dsh plugin --profile web add github:L050110/dsh-vx-workbench`）。

## 3. 上架 awesome-dsh-plugin（GitHub 通了之后）

到 **`awesome-dsh-plugin/awesome-dsh-plugin`** 提 PR（不是 market 仓库），加一条：

```yaml
name: dsh-vx-workbench
owner: L050110
url: https://github.com/L050110/dsh-vx-workbench
category: workflow
description:
  en: >
    Turn Visual X-Space into a one-command workshop: repair the CAD import path
    (FBX / STEP / STL load without a license dialog) with a signature-based patch
    that survives different builds, generate factory layouts from parameters, and
    keep a self-maintaining skill ledger so the agent never guesses a skill name.
  zh: >
    把 Visual X-Space 变成一条命令的车间：用特征码定位（换 build 也认）修好 CAD 导入链路，
    FBX / STEP / STL 直接进；按参数生成工厂布局；再带一份自维护的技能台账，agent 不再凭记忆猜技能名。
npm: dsh-vx-workbench
version: 0.1.0
keywords: [visual-components, cad, factory, layout, simulation, skills]
```

`page` / `stars` / `capabilities` / `install` 由他们的 CI 自动生成，不用填。
预计一天内出现在市场与插件页。

## 4. 首次发布后

- `npm version patch` → `git push --tags`，市场自动跟版本。
- 每次改特征码或新增适配 build，在 `CHANGELOG.md` 记一条并附 `sha256`。
