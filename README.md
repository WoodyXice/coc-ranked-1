# 部落冲突排位助手

免费的 Windows x64 工具。可查国际服本周排位，查看组内流派使用率和三星率、成员名次和杯数，以及带阵容图标和用时的个人攻防记录。支持切换村庄、导出 Excel 和保存流派图。

## 下载和使用

1. 从 [GitHub Releases](https://github.com/fangjog/coc-ranked/releases/latest) 下载 `COC-Ranked-Setup-…-x64.exe` 并安装，或下载 `COC-Ranked-Portable-…-x64.exe` 直接使用。
2. 在助手中点「设置令牌」或「管理令牌」，复制检测到的公网出口 IP，点击「申请地址」打开 Supercell 开发者后台。创建 API 密钥时把 IP 填入 **Allowed IP Addresses**，再回到助手保存密钥。
3. 选择「添加村庄」，输入自己的国际服村庄 Tag，点击「查询本周排位」。游戏内短令牌可留空。

村庄资料、凭据和战报缓存保存在本机的 `%APPDATA%\coc-ranked`。转发 Releases 链接即可让对方用自己的密钥查询。 [详细使用说明](使用说明.md)

## 软件更新

从 v1.2.0 起，安装版启动时会检查 GitHub 上的正式版。发现更新后，在「软件更新」中点击「下载更新」，下载完成后选择「重启安装」。便携版可在同一入口打开发布页下载新版。早期便携版可先关闭窗口，再安装新版，继续使用本机已保存的村庄和密钥。

## 从源码构建

在 Windows x64 上安装 Node.js 22.12 或较新支持版本，然后运行以下命令。

```powershell
npm ci
npm run package:windows
```

安装版和便携版位于 `release/`。开发时可运行 `npm run build`，然后运行 `npm start`。

## 协作与发版

欢迎通过 Pull Request 提交修改。仓库维护者可以在 GitHub 的仓库设置中邀请协作者。

合并并确认 `main` 工作区干净后，使用 `npm version patch` 更新补丁版本并创建 Git 标签。需要发布次要版本或主要版本时，相应地用 `minor` 或 `major`。推送提交及对应的 `vX.Y.Z` 标签，例如下一版是 v1.2.1 时执行以下命令。

```powershell
git push origin main
git push origin v1.2.1
```

GitHub Actions 会构建两种 EXE 和更新清单，完成后发布正式版。如果需要手动补发，可以在 Actions 中运行「Windows release」并输入尚未发布的现有标签。打包后的安装版从此仓库的 Releases 获取更新。

## 素材来源

游戏素材归 Supercell 所有。内置阵容图标和排位徽章来自 [ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets/tree/996a639ec887560bead815f76bc3942d1c931930/assets)，附有上游的 [GNU GPL v3 文本](public/army-icons/LICENSE)。阵容码解析参考了 [clashy.go v0.1.21](https://github.com/ClashKingInc/clashy.go/tree/v0.1.21)，附有 [MIT 许可文本](public/third-party/clashy-go-MIT.txt)。

本作品为非官方粉丝作品，未获 Supercell 认可。 [Supercell 粉丝内容政策](https://supercell.com/en/fan-content-policy/)
