# 部落冲突排位助手

免费的 Windows x64 便携工具。可查国际服本周排位，查看组内流派使用率和三星率、成员名次和杯数，以及带阵容图标和用时的个人攻防记录。支持切换村庄、导出 Excel 和保存流派图。

## 下载和使用

1. 从 [GitHub Releases](https://github.com/fangjog/coc-ranked/releases/latest) 下载 Windows x64 的 `.exe`，双击打开。
2. 在 [Supercell 开发者后台](https://developer.clashofclans.com/#/account) 创建 API 密钥，把运行助手的电脑的公网出口 IP 填入 **Allowed IP Addresses**。在助手的「管理令牌」中保存该密钥。
3. 选择「添加村庄」，输入自己的国际服村庄 Tag，点击「查询本周排位」。游戏内短令牌可留空。

村庄资料、凭据和战报缓存保存在本机的 `%APPDATA%\coc-ranked`。转发 Releases 链接即可让对方用自己的密钥查询。 [详细使用说明](使用说明.md)

## 从源码构建

在 Windows x64 上安装 Node.js 22.12 或较新支持版本，然后运行以下命令。

```powershell
npm ci
npm run package:windows
```

便携程序位于 `release/`。开发时可运行 `npm run build`，然后运行 `npm start`。

## 素材来源

游戏素材归 Supercell 所有，图标来自 [ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets/tree/996a639ec887560bead815f76bc3942d1c931930/assets)。图标目录附有上游的 [GNU GPL v3 文本](public/army-icons/LICENSE)。阵容码解析参考了 [clashy.go v0.1.21](https://github.com/ClashKingInc/clashy.go/tree/v0.1.21)，附有 [MIT 许可文本](public/third-party/clashy-go-MIT.txt)。

本作品为非官方粉丝作品，未获 Supercell 认可。 [Supercell 粉丝内容政策](https://supercell.com/en/fan-content-policy/)
