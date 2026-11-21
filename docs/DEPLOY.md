# 本地部署与真机测试指南（M4）

> 面向：Owner / 家长。目标是把 `dist/` 挂到公网 HTTPS，然后在平板或手机上「添加到主屏幕」，像 App 一样用。  
> 全程不需要服务器、不需要数据库、不需要注册账号：这是一个**纯静态**站点，数据只存在使用它的那台设备里。

---

## 0. 先记住三件事

1. **必须 HTTPS**。PWA 的 Service Worker 只在 `https://` 或 `localhost` 下工作；`http://` 的局域网地址装不了、也离线不了。
2. **数据跟着「网址 + 浏览器」走**。同一个域名换浏览器、换设备、清缓存，数据都不会自动跟过去；换域名（比如从 `xxx.vercel.app` 换成自己的域名）等于换了一个新家，旧数据留在旧域名里。
3. **备份是唯一的跨设备通道**。上线前先在本机「设置 → 导出全部数据」存一份 JSON，到了新设备再「从备份文件恢复」。

---

## 1. 本地跑起来（开发）

```bash
npm install
npm run dev        # http://localhost:5173
```

`localhost` 属于安全上下文，所以数据、备份、恢复都能正常用；但**Chrome 不会给"一键安装"按钮**（因为开发环境不注册 Service Worker），设置页会显示「看安装步骤」而不是「添加到主屏幕」。这是预期行为，不是 bug。

## 2. 构建 + 本地预览生产版（建议上线前必做）

```bash
npm run verify     # 单测 + 生产构建，必须全绿
npm run preview    # http://localhost:4173，跑的就是 dist/
```

预览模式下 Service Worker 会注册，`localhost:4173` 也能触发 Chrome 的安装入口 —— 这是**上线前最后一次真实验收**的机会。

产物结构：

```
dist/
├── index.html
├── manifest.webmanifest
├── sw.js
├── icons/icon-192.png · icon-512.png · icon-maskable-512.png
└── assets/index-*.js · index-*.css
```

---

## 3. 部署到 Vercel（最省事，推荐）

### 方式 A：网页导入（不用装命令行）

1. 把项目推到 GitHub / GitLab。
2. 打开 <https://vercel.com/new>，选这个仓库。
3. Framework 选 **Vite**（一般会自动识别），确认：
   - Build Command：`npm run build`
   - Output Directory：`dist`
4. Deploy。1 分钟左右拿到 `https://<项目名>.vercel.app`。

### 方式 B：命令行

```bash
npm i -g vercel
vercel            # 首次会问几个问题，全部回车即可
vercel --prod     # 正式发布
```

> `base` 已经是 `./`（相对路径），所以部署到根路径或子路径都能用，不需要额外改配置。

## 4. 部署到 Cloudflare Pages（国内访问通常更稳）

1. <https://dash.cloudflare.com> → Workers & Pages → Create → Pages → Connect to Git。
2. Build command：`npm run build`；Build output directory：`dist`。
3. 保存并部署，得到 `https://<项目名>.pages.dev`。

也可以用命令行：`npx wrangler pages deploy dist`。

---

## 5. 上线后 5 分钟自检

| 检查             | 怎么做                                      | 期望                     |
| -------------- | ---------------------------------------- | ---------------------- |
| HTTPS          | 地址栏有小锁                                   | 是                      |
| Manifest       | 打开 `https://你的域名/manifest.webmanifest`   | 返回 JSON，不是 404         |
| Service Worker | DevTools → Application → Service Workers | 有 `sw.js`，状态 activated |
| 离线             | DevTools → Network → Offline，刷新页面        | 仍能打开（读的是缓存）            |
| 图标             | 主屏幕图标                                    | 橘色小猫，不是灰色方块            |

再用 Lighthouse（DevTools → Lighthouse → 勾选 PWA）跑一次，Installability 应为通过。本项目已满足：`name` / `short_name` / 512+192 图标 / `display: standalone` / `start_url` / `theme_color` / `background_color` / 已注册 SW。

---

## 6. 装到平板 / 手机上

### 安卓（Chrome / Edge）

1. 用 Chrome 打开网址。
2. 右上角 `⋮` →「安装应用」或「添加到主屏幕」。
3. 桌面出现图标，点开是无地址栏的独立窗口。

### iPad / iPhone（Safari）

1. **必须用 Safari**（微信内置浏览器、Chrome for iOS 都装不了）。
2. 打开网址，点底部中间的「分享」按钮。
3. 下滑找到「添加到主屏幕」→ 右上角「添加」。
4. 桌面出现图标，点开是全屏独立窗口。

安装后建议顺手做两件事：

- 在家长端「设置」里设一个 **4 位 PIN**，并把**恢复码抄在纸上**；
- 「导出全部数据」存一份到网盘或电脑（iPad 上会存到「文件」App）。

---

## 7. iOS 上的显示细节（已处理，不需要家长设置）

| 项目      | 处理方式                                                               |
| ------- | ------------------------------------------------------------------ |
| 状态栏     | `apple-mobile-web-app-status-bar-style=default`，内容从状态栏下方开始，不会被刘海遮挡 |
| 顶部安全区   | 顶栏 `padding-top: calc(14px + env(safe-area-inset-top))`            |
| 底部安全区   | 底部导航、弹层、数字键盘统一加 `env(safe-area-inset-bottom)`，不会被 iPhone 横条盖住      |
| 双击缩放    | `touch-action: manipulation`，双击不再放大（双指捏合仍可用）                       |
| 输入框自动放大 | 所有输入框字号 ≥ 16px，聚焦时页面不会跳                                            |
| 主题色     | `theme-color` 与 manifest 均为 `#FF8A3D`（蜜橘）                          |

> iOS 16.4 之前不支持 `display_override`，会退回 `display: standalone`，表现一致。

---

## 8. 数据与备份（最重要的一节）

- 数据存在浏览器的 **IndexedDB** 里，不经过服务器，也不经过 Service Worker 缓存。
- 同一个网址下，**换浏览器 = 换一个空库**；清除网站数据 = 数据全没。
- 域名是数据的一部分：`xxx.vercel.app` 和 `xxx.pages.dev` 是两个互不相通的家。
- 因此请固定用一个正式域名，并定期「导出全部数据」。
- 忘记 PIN 时：用**恢复码**重置（设置页可补生成）。恢复码和 PIN 都丢了，纯本地架构没有后门；此时「删除全部家庭数据」清空后，重新导入之前导出的 JSON 即可恢复任务与星星。

---

## 9. 发布新版本后，家长怎么拿到新版

Service Worker 采用「下次打开生效」策略（不 `skipWaiting`，避免用户正填表时页面被换掉）：

1. 你在 Vercel / Cloudflare 上重新部署；
2. 家长下次**完全关掉** App 再打开，就会加载新版；
3. 如果看起来还是旧版：把 App 从后台划掉再开一次；仍不行就删掉主屏幕图标、重新「添加到主屏幕」（**注意：删除图标不等于删除数据**，数据仍在浏览器里，除非你手动清了站点数据）。

本轮已把缓存版本从 `v1` 升到 `v2`，老缓存会在新 SW 激活时自动清掉。

---

## 10. 真机内测清单（建议逐条打勾）

- [ ] 平板上能装到主屏幕，图标正常
- [ ] 打开无地址栏，顶部不被状态栏遮住，底部不被横条遮住
- [ ] 孩子端：做一条任务 → 提交 → 家长端通过 → 星星到账
- [ ] 家长端：设置 4 位 PIN → 退出 → 再进被拦 → 输对进入
- [ ] 忘记 PIN：用恢复码重置 → 新 PIN 能进 → 旧恢复码失效
- [ ] 导出 JSON → 删一个孩子 → 导入 JSON → 数据回到导出那一刻
- [ ] 布置一个「每天」的固定任务 → 第二天打开自动出现，且不重复
- [ ] 删除全部家庭数据 → 重验 PIN → 勾选确认 → 回到「朵朵」初始状态
- [ ] 开飞行模式后冷启动 → 仍能打开页面（离线可用）

---

## 11. 常见问题

| 现象                                 | 原因                   | 处理                                                     |
| ---------------------------------- | -------------------- | ------------------------------------------------------ |
| iPhone 上没有「添加到主屏幕」                 | 用的是微信/Chrome 内置浏览器   | 换 Safari 重新打开                                          |
| 装完打开是白屏                            | 部署在子路径但 `base` 配错    | 本项目 `base: "./"`，确认没被改掉                                |
| 离线打不开                              | 首次访问没等 SW 装好就断网      | 联网打开一次，等 10 秒再试                                        |
| 换了域名，数据不见了                         | IndexedDB 按域名隔离      | 回旧域名导出 JSON，到新域名导入                                     |
| 家长端一直要输 PIN                        | 刷新或点「退出家长」都会重置会话     | 正常设计：一个会话内只输一次                                         |
| 忘了 PIN 也没有恢复码                      | 恢复码是 M4 才有的          | 进家长端设置页补生成（需先能进）                                       |
| DevTools 报 `EBUSY ... .crdownload` | 浏览器下载临时文件被 Vite 监视到了 | 已在 `vite.config.js` 忽略 `.shots/`、`dist/`；备份文件别保存在项目目录里 |

---

*文档版本：M4 封版（v1.0.0）起步，当前随 M5 为 **v1.1.0** · 与 `tech/contract.md` §7 / §8 对应*
