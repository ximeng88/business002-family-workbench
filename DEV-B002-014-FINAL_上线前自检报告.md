# 上线前自检报告（Git 推送与公网部署终审）

- 项目：Business002-xiaoxueshengxuexijiatinggongzuotai（小学生学习家庭工作台）
- 日期：2026-11-21
- 执行人：Trae
- 任务书编号：DEV-B002-014（**与已交付的 M5「兑换多选」重号**，本报告文件名加 `-FINAL` 以区分；本轮只做上线前检核，不动业务逻辑）
- 项目版本：**1.1.0**（`package.json`，M5 已按既有规则从 1.0.0 升到 1.1.0；任务书写的 1.0.0 是 M4 时的版本，已过时，未回退）
- 环境：Windows / Node v22 系 / npm / Vite 7.3.8 / 生产预览 `http://localhost:4173`

**最终结论：同意推送到 GitHub 并部署到 Vercel（GO）。** 唯一前置动作是本次已完成的 `.gitignore` 补漏；其余检查全部通过，未发现白屏、控制台报错、SW 失效或调试代码残留。

---

## 一、必查项逐条结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | `.gitignore` 是否完备 | **补漏后完备** | 修前缺 `*.log`、`*.crdownload`；已补齐，并额外忽略 `.workbuddy/`（Builder 内部记忆，不属于交付物） |
| 2 | `base: "./"` 是否正确 | **正确** | `vite.config.js` 第 8 行 `base: "./"`；构建产物 `dist/index.html` 中 JS/CSS 均为 `./assets/...`，manifest 与 icon 为 `./manifest.webmanifest`、`./icons/...` |
| 3 | `package.json` name / version | **name 正确；version 为 1.1.0（非 1.0.0）** | `name: business002-family-workbench`、`private: true`、`version: 1.1.0`；1.1.0 是 M5（DEV-B002-014 兑换多选）的既定版本，已由 `vite.config.js` 注入设置页显示，回退到 1.0.0 会与已交付记录矛盾，故**不降级** |
| 4 | `npm run build` | **通过** | 49 modules transformed，退出码 0；`dist/assets/index-*.css` 68.79 kB、`index-*.js` 316.50 kB |
| 5 | `manifest.webmanifest` | **200 且 JSON 合法** | `application/manifest+json`，可被 `Invoke-RestMethod` 解析；`name` / 3 个 icons / `start_url: "./"` 正常 |
| 6 | Service Worker | **注册成功、`activated`、控制当前页面** | `scope: http://localhost:4173/`，`sw.js` 200；等待 10s 与刷新后 `active.state = activated`、`controller` 存在 |
| 7 | 预览控制台 | **零错误、零警告、无 404** | 首启、核心链路、删除重置三次实测，console 均为 `[]`；manifest / icons×3 / sw.js / 构建 JS+CSS 全部 200 |
| 8 | `sw.js` 的 `shell-v2` 缓存清单 | **全部存在于 `dist/`** | `SHELL_ASSETS = ["./", "./index.html", "./manifest.webmanifest"]`，三项在 `dist/` 中均存在，无拼写错误、无多余文件 |
| 9 | `index.html` 的 manifest / icon 引用 | **相对路径，正确** | `./manifest.webmanifest`、`./icons/icon-192.png`、`apple-touch-icon` 均相对 |
| 10 | 调试残留 | **无** | `src/app/`、`src/services/` 无 `console.log` / `debugger`；仅保留 `src/main.js` 的 `console.warn("[PWA] Service Worker 注册失败：")`（真正的异常出口，应留）与一条 `TODO(decision: Q-05)`（按任务书要求保留） |
| 11 | 硬编码本地参数 | **无** | 全仓 `src/` 无 `http://` / `https://` / 绝对 `/assets` 路径；`localhost` 仅出现在 `app/install.js` 的"是否为安全上下文"判断与 `settings.js` 的对应文案里，属功能逻辑，不是写死的测试地址 |
| 12 | 首次启动（空库） | **通过** | 全新存储打开：自动种出「朵朵」+ 5 条示例任务（整理书包/朗读课文/数学口算/收拾书桌/亲子阅读），星星 0，无红屏、无报错 |
| 13 | 删除全部家庭数据 | **通过** | 设置页危险区 → 弹窗显示"孩子 1 个 / 任务 6 条 / 记录 37 条" → 勾选确认 → 约 2 秒内自动回到全新首页，朵朵 + 5 条示例任务重生，无卡死、无控制台错误 |
| 14 | 单测 / 构建 | **130/130 通过 + 构建成功** | `npm run verify` 退出码 0。任务书写的 121 项是 M4 基线；M5 新增 9 项后为 130，未删减任何既有用例 |

## 二、生产预览下的核心链路实测（真实 Chromium）

在 `npm run preview`（http://localhost:4173）的生产构建上走完整链路，全部通过：

1. **家长布置任务**：家长端「布置」新建「上线自检任务 +5 星」，提示"布置好了 · 上线自检任务 +5 星"，孩子端任务数 5 → 6。
2. **孩子提交**：填写说明 →「我做完啦」→ 状态变为"等确认"，提示"等爸爸妈妈点头"。
3. **家长审核通过**：确认页「通过 +5★」→ 提示"通过啦 · 上线自检任务 +5 星，团团 +5 经验"；星星存钱罐 0 → 5。
4. **积分到账**：再通过「整理书包 +5」「朗读课文 +10」，余额 5 → 10 → 20，与流水逐笔一致。
5. **兑换装扮**：孩子端「团团」→ 装扮区选「小草帽（20 颗）」→ 汇总条显示"已选 1 件 · 共 20 颗 · 换完还剩 0 颗"→「一起告诉爸爸妈妈」→ 家长端「兑换」批次卡 →「通过并扣 20 颗」→ 余额 0，"我的装扮"出现「帽子 小草帽」，兑换记录显示"小草帽 · 20 颗 · 已换到"。
6. **控制台**：全流程零错误、零警告。

## 三、修复与修改的文件

| 文件 | 修改点 | 原因 |
|---|---|---|
| `.gitignore` | 新增 `*.log`、`*.crdownload`、`.workbuddy/` | 原文件只有 `node_modules/`、`dist/`、`.shots/`、`*.local`、`.DS_Store`；日志与浏览器下载临时文件、Builder 内部记忆目录会被 `git add .` 带进仓库 |
| `PROJECT_STATE.md` | 记录本轮"上线前终审"结论、任务行、变动行、`.gitignore` 现状与遗留说明 | 交付要求 |
| `DEV-B002-014-FINAL_上线前自检报告.md` | 新建（本文件） | 交付要求 |

**未修改任何 `src/` 业务代码、Schema、`public/` 资产、`vite.config.js` 或 `package.json`。** 因此本轮无需重跑修复后的回归（`npm run verify` 仍是修复前同一份代码下的 130/130 结果，且 `.gitignore` 不参与构建）。

## 四、仓库卫生事实（推送前确认）

- 被忽略：`node_modules/`（本地依赖）、`dist/`（构建产物，Vercel 会自己构建）、`.shots/`（临时验收截图）、`.workbuddy/`（Builder 记忆）、`*.log`、`*.crdownload`、`*.local`、`.DS_Store`。
- 会被提交：`src/`、`public/`、`tests/`、`design/`、`tech/`、`docs/`（含 `DEPLOY.md`、`screens/` 52 张验收图）、`PRD_v1.3.md`、`PROJECT_STATE.md`、交付报告、`package.json`、`package-lock.json`、`vite.config.js`、`index.html`、`.gitignore`。
- 仓库内**没有** `.env`、密钥、API Key、真实家庭数据（数据只存在用户浏览器 IndexedDB）。
- 全仓检索 `.log` / `.crdownload` / `.zip` 残留：0 个。
- 不需要 `vercel.json`：应用是纯静态单页，页面切换只用内存状态，没有 `pushState` / hash 路由，不存在深链接 404 风险；Vite 项目 Vercel 零配置即可。

## 五、上线后再做的验证（不阻塞本次推送）

1. **iOS Safari / 安卓真机**实际安装、离线冷启动、安全区与状态栏——目前仍只在桌面 Chromium 验证过，`docs/DEPLOY.md` §10 的清单需在真机逐条走。
2. **收银台式首页缓存**：首次部署后确认 `https://<域名>/manifest.webmanifest` 返回 `application/manifest+json`（Vercel 对 `.webmanifest` 有时会给 `text/plain`，若安装性异常再补 headers 配置）。
3. **PRD §6.5** 仍写"最多一条 pending"，与 M5 的"最多一批（1–6 件）"不一致，下版同步；实现以 `tech/contract.md` §8 为准。
4. 任务编号重号（014 同时指向 M5 与本次终审）建议后续统一编号，避免追溯混淆。

## 六、给 Owner 的一句话

可以推送。推之前只需确认：仓库里没有把 `dist/` 或 `node_modules/` 手动加进 `git add`；推送后在 Vercel 用默认 Vite 预设（Build Command `npm run build`，Output Directory `dist`）即可。
