# 项目共享状态

> 本文件由 Trae 与 WorkBuddy 共同维护。每次任务开始前必读，任务结束后更新。
> Owner 也通过本文件了解两个 Builder 的最新状态。
> 最后更新：2026-11-21 20:20 ｜ 更新人：Trae（DEV-B002-014-FINAL，上线前终审：GO）

## 一、当前阶段

**上线前终审（任务书编号 DEV-B002-014，与 M5 重号；本轮按 `DEV-B002-014-FINAL` 记账）已完成，结论 GO。** 本轮只做推送 GitHub / Vercel 前的工程化检核，**未改任何业务代码、Schema、`public/` 资产、构建配置或版本号**。检查结果：①`.gitignore` **补漏 3 行**（`*.log`、`*.crdownload`、`.workbuddy/`），原有 `node_modules/` / `dist/` / `.shots/` / `*.local` / `.DS_Store` 保留；②`base: "./"` 正确，`dist/index.html` 中 JS / CSS / manifest / icon 全为相对路径；③`package.json` name 正确，**version 为 1.1.0（非任务书写的 1.0.0）**——1.0.0 是 M4 封版号，M5 已按规则升到 1.1.0 并经设置页 `__APP_VERSION__` 展示，回退会与已交付记录矛盾，故不降级；④`npm run build` 与 `npm run verify` 均退出码 0，**130/130 单测通过**（任务书写的 121 是 M4 基线，M5 +9）；⑤`npm run preview`（http://localhost:4173）实测：`manifest.webmanifest` 返回 200 且为合法 JSON、`sw.js` 200 且 `shell-v2` 的三个预缓存路径 `./` / `./index.html` / `./manifest.webmanifest` 都存在于 `dist/`、Service Worker 状态 `activated` 并控制页面、icons ×3 与构建产物全部 200、**控制台零错误零警告**；⑥生产预览跑通完整链路「家长布置 → 孩子提交 → 家长通过 → 星星到账（0→5→10→20）→ 孩子兑换小草帽 20 颗 → 家长批次确认 → 余额 0、装扮已拥有、记录已换到」；⑦全新存储首启自动种出「朵朵 + 5 条示例任务」，设置页「删除全部家庭数据」清空 37 条记录后约 2 秒平滑重生，无卡死无报错；⑧`src/app/` 与 `src/services/` **无 `console.log` / `debugger`**，只保留 `src/main.js` 的 SW 注册失败 `console.warn` 与一条 `TODO(decision: Q-05)`（按任务书要求保留），`localhost` 仅用于 `install.js` 的安全上下文判断而非写死地址。交付物：本文件更新 + `DEV-B002-014-FINAL_上线前自检报告.md`。**仍不覆盖**：iOS Safari / 安卓真机安装、离线冷启动、Vercel 线上实跑（见 `docs/DEPLOY.md` §10）。

**DEV-B002-014（M5：兑换多选后一起提交）已完成，状态 WAITING_FOR_QA。版本 v1.1.0。** 起因是 Owner 实测反馈："积分兑换的时候允许多选后一起提交让家长确认，现在还能选一个确认一个，比较麻烦"。本轮把"点一件 → 提交 → 等家长确认 → 才敢点下一件"改成"一次勾几件 → 一次提交 → 家长一张卡一次确认"：①**孩子端**——卡片按钮变「选这个 / 已选」，按钮带透明覆盖层，点卡片任何位置都算勾选；勾选后卡片描边变蜜橘色、左上角出现小勾；底部固定汇总条实时显示「已选 N 件 · 共 M 颗 · 换完剩 X 颗」（不够就写「还差 X 颗」并禁用提交）+「清空」+「一起告诉爸爸妈妈」。提交成功后商城进入只读态，蓝色横幅列出这批名称与合计。②**家长端**——一批一张卡，逐件明细（名称快照 / 类别 / 当时价格），多件时有勾选框（默认全勾），取消勾选的行变灰划线，`选中 / 合计要扣 / 换完剩` 与主按钮文案实时重算；主按钮「通过 N 件 · 扣 M 颗」，**未勾选的件在同一事务里按拒绝处理**（绝不留悬挂 pending，否则孩子再也发不出新一批）；「先不换这批」复用原说明弹层。③**服务层**——新增 `requestRedemptions` / `acceptRedemptionBatch` / `rejectRedemptionBatch`；pending 约束从"最多一条"改为"最多一批（1–6 件）"，余额校验从逐件改为**合计**；`requestRedemption` / `acceptRedemption` / `rejectRedemption` 保留为单件兼容入口；老数据没有 `batchId` 时按"自身 id 当批次号"兜底。④**结构**——`redemptions` 只加一个**无索引**的 `batchId`，**Schema 仍 v2 / 14 张表 / 无 v3 迁移**。验证证据：**130/130 项单测通过（121 + 9 项 M5）+ 生产构建成功**；真实 Chromium 430×932 跑通完整闭环（余额 120 → 勾 3 件 100 颗 → 提交 → 家长一张卡 → 取消 50 颗那件 → 通过 2 件扣 50 → 余额 70、2 条已换到 + 1 条没换成、流水 −30/−20），**控制台零错误**；`docs/screens/` 更新为 **52 张**（+8 张 M5）。顺手修掉一个既有偶发失败：`M3-TP8` 断言"按创建时间正序"但两条模板同毫秒创建、`id` 随机，约 1/3 概率失败，改为显式错开 `now`。**未做**：跨孩子合并一批、批次级改价、pending 超时自动退回。**注意**：PRD v1.3 §6.5 仍写"最多一条 pending"，本轮按 Owner 要求落地为"一批"，**以 `tech/contract.md` §8 为准**，建议 PRD 下一版同步。

**DEV-B002-013（M4 封版：PIN 找回、彻底重置与真机部署）已完成，状态 WAITING_FOR_QA。项目挂牌 v1.0.0。** 本轮堵住"数据锁死"与"删不干净"两个死角，并把公网部署路径写清楚：①**恢复码机制（最高优先级）**——首次设 PIN 时生成 8 位恢复码（形如 `A1B2-C3D4`，字符集剔掉 `0 O 1 I L`），弹层大字展示 + 「复制」+ 必须勾选"我记下了"才能关闭；库里只存**带 `recovery:` 域前缀的加盐摘要 + 独立盐**，明文只在生成那一次出现。PIN 弹层新增「忘记 PIN 了？用恢复码重置」→ 验码 → 设新 PIN → 立刻给出**新**恢复码，旧码即时作废。恢复码失败计数与 PIN **分开记**，连错 5 次各自锁 60 秒。②**彻底删除（G-05 落地）**——设置页最底部红色危险区，点开后**重验 PIN**（不改会话解锁态）+ 勾选"我确认所有孩子数据将被永久抹除"+ 红色实心按钮才可点；`wipeAllData()` 在**单事务**内清空 14 张表、重写 `_meta`（`schemaVersion` / `createdAt` / `restoreState: complete`）、清掉 `localStorage` 的导入前快照，随后强制刷新，由 `boot()` 重新种出「朵朵 + 5 条示例任务」。**已下载到硬盘的 JSON 备份不受影响。** ③**PWA 封版**——manifest 补 `id` / `display_override` / `orientation` / `categories`、主题色与页面统一；SW 版本 v1→v2 且 `cache.put` 全部挂 `event.waitUntil`（修掉"缓存可能没写进去、离线打不开"的隐患）；iOS 侧确认状态栏 `default`、上下 `env(safe-area-inset-*)`、`touch-action: manipulation` 关双击缩放、输入框 ≥16px 防聚焦缩放；新增 `docs/DEPLOY.md`《本地部署与真机测试指南》（Vercel / Cloudflare Pages 两条路径 + 上线自检表 + 真机内测清单 + 常见问题）。④**版本号**——`package.json` 升到 **1.0.0**，经 `vite.config.js` 的 `define` 注入 `__APP_VERSION__`，设置页显示「v1.0.0 · 封版」，真机验收时能一眼确认装的是哪一版。验证证据：**121/121 项单测通过（M3 的 111 + 新增 10）+ 生产构建成功**；真实 Chromium 430×932 跑通任务书要求的两条闭环（设 PIN → 退出 → 忘记 PIN → 输恢复码 → 改新 PIN → 成功进入；删除数据 → 重验 PIN → 勾选确认 → 回到全新空白状态），**控制台零错误**；`docs/screens/` 更新为 **44 张**（+8 张 M4）。**关键结论：M4 仍然零结构变更**——恢复码只是 `settings` 里 5 个新键，彻底清空是"删行"不是"改结构"，**Schema 仍 v2 / 14 张表 / 无 v3 迁移**。**未做**：恢复码有效期与多份并存、家长协助者 / 多账号、AI 生成计划与错题解析（无后端）、云同步 / 自动定时备份、**iOS Safari 与安卓真机安装 / 离线冷启动 / Lighthouse 实跑均未验**（清单已写进 `docs/DEPLOY.md` §10，不得表述为"全端通过"）。

**DEV-B002-012（M3 实战：权限门控、数据容灾与自动化任务）已完成，状态 WAITING_FOR_QA。** 本轮把产品从"能玩的 Demo"推到"敢每天给孩子用"：①**家长 PIN 门控**——家长端新增第 6 个 Tab「设置」，可设 4 位数字 PIN；从孩子端切家长端必须输 PIN，通过后在**当前会话内有效**（刷新或点「退出家长」即失效）；老用户没设 PIN 时默认放行，设置页提示「建议设置家长 PIN」；连续 5 次错误锁 60 秒。②**数据备份与恢复（最高优先级）**——「导出数据」把所有 **14 张表**导成一个 JSON 下载（含装扮、积分流水、设置），「导入数据」选文件后弹层二次确认（必须勾选"我明白现在所有数据会被替换"才能点），**校验不通过一律拒绝且零写入**，通过后**单事务**清空 + 写入 + 补迁移 + 修元数据，并自动留"导入前快照"，可一键「撤销上次导入」；**导入不改本机 PIN**。③**固定任务模板引擎**——布置任务时可勾「每天」或「每周几」，启动与新建模板后自动补齐当天任务，**复用 `generationKey`（`${type}:${childId}:${templateId}:${dateKey}`）+ `&generationKey` 唯一索引 + 事务内查重**，同一天绝不生成两条。④**PWA 与安全区**——拦 `beforeinstallprompt` 做"添加到主屏幕"引导（已安装 / 可拉起 / iOS 指引三态），顶栏与底部面板补 `env(safe-area-inset-*)`。验证证据：**111/111 项 fake-indexeddb 单测通过 + 生产构建成功（`npm run verify` 退出码 0）**；真实 Chromium 430×932 跑通任务书要求的三条闭环（设 PIN→退出→被拦→输对进入；导出→加孩子→导入→恢复如初→撤销；布置每日任务→当天生成→拨快一天→第二天自动生成且同日不重复），**控制台零错误**；`docs/screens/` 更新为 **36 张**验收图（14 M1 + 14 M2 + 8 M3）。**关键结论：本轮零结构变更**——`settings` 与 `taskTemplates` 在 Schema **v1 就已存在**，`tasks.templateId` / `generationKey` 也在 v1 的 `tasks` 里，所以**Schema 仍为 v2、仍是 14 张表、没有写 v3 迁移脚本**，老库直接可用。**未做**：PIN 防篡改（纯前端做不到，只防误触）、忘记 PIN 找回、云同步 / 自动定时备份、删除全部家庭数据（G-05 仍未做）、照片提交、历史回看、iOS 与真机验证。**（其中"忘记 PIN 找回"与"删除全部家庭数据"已由 DEV-B002-013 补齐，见上一段；本段其余内容仍准确。）**

**DEV-B002-011（M2）已完成，WAITING_FOR_QA，已被 DEV-B002-012 接续。** 该轮把 DEV-B002-010-DOC 的奖励方案落成可运行代码：**Schema v1 → v2 平滑升级（不删库、不重建，旧数据无损）**、新增奖励 / 兑换 / 装扮三个服务、家长端「奖励管理」与「兑换审核」两页、孩子端积分商城与衣柜、宠物 SVG 分层装扮。当轮证据：**88/88 项单测 + 生产构建成功**；真实 Chromium 跑通「做任务攒 20 星 → 申请小草帽 → 家长审核通过（-20）→ 穿戴 → 刷新保持 → 改价 20→25 → 停用动画片」完整闭环，控制台零错误；`docs/screens/` 当轮为 28 张（14 M1 + 14 M2）。星星不够时在**孩子端直接挡回并提示还差几颗**，不生成必然被驳回的申请。以下"当前阶段"描述若与本段冲突，以 DEV-B002-012 为准。

**DEV-B002-010-DOC 已完成，状态 WAITING_FOR_QA。** 该轮仅完善积分奖励中心与宠物装扮的产品 / 设计 / 技术契约建议：明确 11 个内置奖励及建议默认积分、家庭改价不覆盖、自定义奖励、申请快照、家长审核扣分、幂等与装扮收藏 / 穿戴规则。修改范围仅 `PRD_v1.3.md`、`design/00/01/02/03/05`、`tech/contract.md` 与本文件；`design/04`、历史 `design/06` 未改。**该轮没有修改 `src/`、实际 Schema 或可运行功能。** 其"Schema 仍为 v1、兑换未实现"的表述已被 DEV-B002-011 取代，仅作历史记录。

**实现基线（DEV-B002-009）：M1 核心闭环已交付，状态 WAITING_FOR_QA。** 该轮解除"不碰数据层"限制，新增退回、多孩、布置任务、逾期分组与连续天数：`src/services/` 新增 `child.service.js`、`streak.service.js`，`approval.service.js` 增加 `rejectTask`，`task.service.js` 增加 `listOverdueTasks` / `listUpcomingTasks` 并给 `createTask` 加孩子校验；界面新增「布置任务」「孩子管理」两页与换孩子面板。**Schema 仍为 v1，未加字段、未升版本**，旧库（含 `c_m0` 朵朵）可直接沿用，无需迁移。既有验证证据为：**64/64 项 fake-indexeddb 单测通过 + 生产构建成功**；真实 Chrome 430×932 跑通「布置 → 提交 → 退回 → 重提 → 通过 → 刷新」，并验证两个孩子的任务/星星完全隔离，控制台**零错误**；`docs/screens/` 更新为 14 张验收图。以上是 DEV-B002-009 历史证据，不是本轮重新验收结果。

**DEV-B002-009（WorkBuddy，2026-11-21）**：M1 任务闭环与多孩架构。服务：`rejectTask`（tasks+reviews 双表事务，退回记录**不写 `eventKey`**，不发分不发经验）、`createChild` / `listChildren` / `getChild`、`listOverdueTasks`（全量、不 limit）、`listUpcomingTasks`、`getCurrentStreak`（Q-02 建议口径）；`createTask` 改为校验孩子存在；`submitTask` 重提时删除 `revisionReason`。界面：家长端 4 Tab（确认 / 布置 / 孩子 / 孩子端）、总览四格、退回原因面板、孩子卡片与新增孩子、布置页孩子选择器；孩子端 Hero 增加连续天数与完成进度、列表分「今天 / 逾期」，需修改卡片显示家长原因并可预填重提。新增 4 个测试文件（21 项），测试总数 **43 → 64**。`src/app/app.js` 重写为外壳 + 路由 + 底部面板；新增 `store.js`（数据适配，只调 `openDatabase/ensureSeedData/listTodayTasks/submitTask/approveTask/getBalance` 与只读查询）、`ui.js`、`icons.js`（内联 SVG，零图标依赖）、`pet.js`（分层橘猫 SVG + 等级派生）、`pages/tasks.js`、`pages/petPage.js`、`pages/review.js`；新增 `styles/app.css`、`styles/pages.css`，重写 `tokens.css`、`base.css`。验证：**43/43 单测通过 + 生产构建成功**；真实 Chrome 430×932 完成 `todo → submitted → approved`，刷新后仍为「已完成 / 1⁄5 / 星星 5」，控制台**零错误**；截图存 `docs/screens/`（7 张）。尚未做：退回（无对应服务）、照片、Safari 与真机。

**历史（M0）**：最小可运行产品由 DEV-B002-007 交付；`design/` 自该轮起作为 **v1.0 冻结基线**，M1 未修改任何设计文件或 `PRD_v1.3.md`，也未插入新一轮设计评审。设计文档内部版本仍为 v0.4（`04` 为 v0.1），冻结的是整目录交付基线。

**DEV-B002-007（Trae，2026-11-20）**：R-01、R-02、R-04、R-06 已修复并补齐测试；Q-02、Q-03、Q-05、Q-11 已按 M0 范围就地降级。已建立 `tech/contract.md` 与 `npm run verify`，实现一个孩子“朵朵”、三个页面（今日任务 / 宠物与积分 / 家长确认）和五条 Seed 任务。验证结果：**43/43 项 fake-indexeddb 单测通过、Vite 生产构建成功**；真实 Chromium 浏览器已实际点击完成 `todo → submitted → approved`，审核后进度 1/5、星星 5，重新导航刷新后状态与积分保持。该证据不等于外部 QA PASS，也不覆盖 Safari 或真机。

以下为历史阶段记录：设计基线曾修订至 **v0.4（DEV-B002-003-R2）**；PRD v1.3 正文已落地为 `PRD_v1.3.md`（2026-11-20 由 `RD_v1.3.md` 改名，正文零改动）。R2 完成 **G-01 只标注不裁决**、**G-05 删除设计补齐**、**恢复流程验收升级为 7 条判据**。

**DEV-B002-006（Trae，2026-11-20）**：数据层已落地并交付 QA。Dexie **4.4.7** 已安装，Schema **v1** 共 **12 张表**（11 张业务表 + `_meta`），审核通过五表原子事务、`approval:${taskId}` 幂等、积分余额由流水派生、统一错误码、本地自然日日期规则均已实现。测试：**32 项 fake-indexeddb 单测全通过** + **真实浏览器（TraeCN 内置 Chromium 142.0.7444.235 / Electron 39.2.7）冒烟 17 项全 PASS** + `npm run build` 退出码 0。**页面、提交服务/界面、附件、备份恢复、兑换、删除功能均未开始**；应用启动流程尚未接入数据库。Owner 本轮裁决：**第一版不做照片、保留文字提交**（`submissions` 已保留文字载体字段，附件字段仅预留）。状态 `WAITING_FOR_QA`，未自宣 PASS。

**DEV-B002-005（Trae，2026-11-20）**：PRD 文件名已由 `RD_v1.3.md` 统一为 `PRD_v1.3.md`（正文零改动，SHA-256 前后一致 `3A50D8D7…7200C9`）；已通读设计 v0.4 正文，产出 `tech/IndexedDB备份恢复技术方案.md`（九步流程、七条判据、三方案比较、半成品库状态机、空间预检、失败终止态、G-01 两分支、G-05 删除可靠性），状态 WAITING_FOR_QA。**该方案是技术建议，不是实现；Dexie 未安装、Schema 未创建、恢复与删除无一行可运行代码。**

已有技术验证证据（不等于 QA PASS）：2026-11-19 复核 `npm run build` 退出码为 0、无警告无错误；生产预览浏览器实测页面正常渲染、控制台无 JS 错误，Manifest、图标和 `sw.js` 均返回 HTTP 200，Service Worker 状态为 `activated`，`shell-v1` 已缓存应用外壳。离线首开、离线二次打开、子路径部署、安装性、iOS 和真机布局仍待验收。

## 二、正在执行的任务

| 任务编号 | 任务名称 | 负责 | 状态 | 开始时间 |
|---|---|---|---|---|
| DEV-B002-014-FINAL | 上线前终审：Git 推送与公网部署前最终自检（任务书误用 014 号） | Trae | **已完成，WAITING_FOR_QA（结论 GO）** | 2026-11-21 19:55 → 结束 20:20 |
| DEV-B002-014 | M5：兑换多选后一起提交（家长一次确认） | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 19:20 → 结束 19:50 |
| DEV-B002-013 | M4 封版：PIN 找回、彻底重置与真机部署 | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 17:50 → 结束 18:30 |
| DEV-B002-012 | M3 实战：权限门控、数据容灾与自动化任务 | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 13:05 → 结束 17:40 |
| DEV-B002-011 | M2 实战：积分商城、兑换审核与宠物装扮 | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 → 结束 18:40（记时笔误，见下方注） |
| DEV-B002-010-DOC | 完善积分奖励中心与宠物装扮产品方案（仅文档） | Trae | **已完成，WAITING_FOR_QA** | 2026-11-21 → 结束 16:18 |
| DEV-B002-009 | M1 任务闭环与多孩架构 | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 11:25 → 结束 11:52 |
| DEV-B002-008 | M0 全面 UI 重构（只换皮不换芯） | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-21 10:59 → 结束 11:13 |
| DEV-B002-007 | P0 修复 + M0 最小可运行产品 | Trae | **已完成，WAITING_FOR_QA** | 2026-11-20 23:09 → 结束 23:27 |
| DEV-B002-006-RV1 | 数据层交叉技术评审（读源码，不运行代码） | WorkBuddy | **已完成，WAITING_FOR_QA** | 2026-11-20 22:20 → 结束 22:25 |
| DEV-B002-006 | 第一阶段开发：工程基础与核心数据层 | Trae | **已完成，WAITING_FOR_QA** | 2026-11-20 21:26 → 结束 21:40 |
| DEV-B002-005 | PRD统一、设计同步与恢复技术评审 | Trae | **已完成，WAITING_FOR_QA** | 2026-11-20 12:40 → 结束 12:45 |
| DEV-B002-003-R2 | 设计规则补充修订（G-01/G-05 + 恢复验收升级） | WorkBuddy | 已交付，WAITING_FOR_QA | 2026-11-19 22:55 |

说明：DEV-B002-004「项目共享状态文件初始化」已完成，交付物即本文件。DEV-B002-005 的交付物为 `tech/IndexedDB备份恢复技术方案.md` + `DEV-B002-002_阶段交付报告.md` 第五部分，**未新建 DEV-B002-005 独立报告文件**（授权只允许新建 tech 文档）。**DEV-B002-006 的交付物为 `src/db/`、`src/services/`、`tests/` + `DEV-B002-002_阶段交付报告.md` 第六部分**。**DEV-B002-006-RV1 的交付物为 `tech/review/DEV-B002-006_交叉技术评审意见.md`**（新建，`tech/` 下唯一新增；未新建独立交付报告，摘要写在评审文档附录）。**DEV-B002-007 的交付物为四个 P0 修复、`tech/contract.md`、`src/services/task.service.js`、三页 M0 UI、43 项单测与 `npm run verify`，未另写 P0 修复报告。** **DEV-B002-008 的交付物为 `src/app/` 7 个模块、`src/styles/` 4 个样式文件、`main.js` 与 `index.html` 的两处引入改动，以及 `docs/screens/` 7 张验收截图；未另写交付报告，摘要写在本文 §1–§4 与 §7。** **DEV-B002-009 的交付物为 `src/services/` 三个改动 + 两个新服务、`src/app/` 两个新页面与外壳改造、`src/styles/m1.css`、`tests/` 4 个新测试文件（总 64 项）、`tech/contract.md` 更新与 `docs/screens/` 14 张验收图；未另写独立交付报告，摘要写在本文 §1–§4 与 §7。** **DEV-B002-010-DOC 的交付物为 PRD、5 份指定设计文档、技术契约 §5 与本文件的文档更新，未另写独立报告，未改代码或 Schema。** **DEV-B002-011 的交付物为 `src/db/` 的 Schema v2 与 `upgradeToV2` 迁移、`src/services/{reward,redemption,costume}.service.js` 三个新服务、`src/app/pages/{rewards,redeem}.js` 两个新页面、`src/app/{app,store,pet}.js` 与 `pages/petPage.js` 改造、`src/styles/m2.css`、`tests/` 5 个文件（3 个新建 + 2 个断言更新，总 88 项）、`tech/contract.md` 更新与 `docs/screens/` 13 张新验收图；未另写独立交付报告，摘要写在本文 §1–§4 与 §7。** **DEV-B002-012 的交付物为 `src/services/{settings,pin,backup,template}.service.js` 四个新服务、`src/app/pages/settings.js` 新页面 + `pages/assign.js` 重写、`src/app/{app,store,ui,icons}.js` 改造、`src/app/install.js`（PWA 安装引导）、`src/styles/m3.css`、`index.html` 的 PWA meta、`tests/` 3 个新测试文件（总 111 项）、`tech/contract.md` 更新（§1 补 `taskTemplates` / `settings`、§2.4–2.7 服务、§3 幂等、§4 决策、§6 M3 实施结果）与 `docs/screens/` 8 张新验收图；未新增表、未升 Schema、未写迁移脚本。** **DEV-B002-013 的交付物为 `pin.service.js` 的恢复码能力（生成 / 归一化 / 校验 / 凭码重置 / 补发）、`backup.service.js` 的 `wipeAllData`、`src/app/{app,store,ui,icons}.js` 改造（忘记 PIN 两段式流程、恢复码弹层、危险区与删除确认）、`src/app/pages/settings.js` 加恢复码卡与危险区、`src/styles/m4.css`（新增，约 230 行）、`public/manifest.webmanifest` 与 `public/sw.js` 与 `index.html` 的 PWA 封版改动、`vite.config.js` 的 `__APP_VERSION__` 注入、`package.json` 升 1.0.0、`docs/DEPLOY.md`（新建）、《本地部署与真机测试指南》、`tests/` 两个文件共 +10 项（总 121）、`tech/contract.md` §7 与 `docs/screens/` 8 张新验收图；未新增表、未升 Schema、未写迁移脚本。** 当前无进行中的 Builder 任务，DEV-B002-007 / 008 / 009 / 010-DOC / 011 / 012 / 013 均已交付并等待 QA。

> 时间注记：DEV-B002-011 行写的"结束 18:40"系上一轮记时笔误，`PROJECT_STATE.md` 的实际 mtime 为 17:13；本行与 §1 的 DEV-B002-012 时间按本机时钟（UTC+8）记录，两者不可直接比较先后。
DEV-B002-005 开始前已确认 WorkBuddy 的 R2 已交付、无进行中写入，`PROJECT_STATE.md`（23:18:10）与 `design/`（23:13–23:20）的最后修改均属已完成的 R2 收尾。

## 三、最近完成的变动（按时间倒序，保留最近 10 条）

| 时间 | Builder | 任务 | 改了什么 | 影响范围 |
|---|---|---|---|---|
| 2026-11-21 20:20 | Trae | DEV-B002-014-FINAL | ①`.gitignore` 补 `*.log` / `*.crdownload` / `.workbuddy/` ②核对 `base: "./"`、`package.json`（name 正确、version 1.1.0 不回退）、`public/sw.js` 的 `shell-v2` 清单与 `dist/` 一一对应、`index.html` 引用全为相对路径 ③`npm run verify`：**130/130 + 构建成功** ④`npm run preview` 实测：manifest 200 + 合法 JSON、SW `activated`、零控制台错误、完整链路（布置→提交→通过→0/5/10/20 星星→小草帽 20 颗兑换→家长批次确认→剩 0 且已拥有）、全新首启种朵朵 + 5 任务、删除全部数据后平滑重生 ⑤检索调试残留：无 `console.log` / `debugger` / 硬编码 localhost ⑥新建 `DEV-B002-014-FINAL_上线前自检报告.md` | 仓库卫生、部署配置与上线证据；**未改 `src/`、Schema、`public/`、`vite.config.js`、`package.json`** |
| 2026-11-21 19:50 | WorkBuddy | DEV-B002-014 | ①**服务层**：`redemption.service.js` 新增 `MAX_BATCH_ITEMS = 6`、`makeRedemptionBatchId()`、`requestRedemptions`（一次落 N 条 pending、共用 `batchId`、合计校验）、`acceptRedemptionBatch`（单事务：勾选的通过、未勾选的同事务退回）、`rejectRedemptionBatch`；`requestRedemption` / `acceptRedemption` / `rejectRedemption` 降级为单件兼容入口；pending 约束从"一条"改为"一批"，批次查询用 `row.batchId ?? row.id` 兼容老数据 ②**孩子端**：`pages/petPage.js` 卡片改「选这个 / 已选」+ 整卡可点覆盖层 + 角标小勾，新增 `shopSelection()` / `shopBarContent()`；底部汇总条挂到 `.page` 之外的 `#dock`（`.page` 带 rise-in 动画会成为 `position:fixed` 包含块） ③**家长端**：`pages/redeem.js` 重写为按 `batchId` 分组的批次卡，逐件勾选 + 统计实时重算 + 「通过 N 件 · 扣 M 颗」，`groupPendingBatches()` 导出 ④**store**：新增 `shopPicked` / `pendingRedemptionsOf` / `pendingBatchIdOf` / `toggleShopPick` / `clearShopPicks` / `doRequestRedemptions` / `doAcceptRedemptionBatch` / `doRejectRedemptionBatch`，换孩子清勾选 ⑤**样式**：新增 `styles/m5.css`（约 290 行：可勾选卡片、汇总条、批次明细、勾选框） ⑥**测试**：+9 项 M5（RD1–RD9），总数 **121 → 130**；顺手修 `M3-TP8` 同毫秒创建导致的排序偶发失败 ⑦`tech/contract.md` 升 **v1.1.0** 并加 §8，`docs/screens/` +8 张（共 52） | 服务层、界面层、契约、测试、验收基线；`redemptions` 只加**无索引** `batchId`，**Schema 仍 v2、无迁移**；`design/` 与 `PRD_v1.3.md` 本轮未改（PRD §6.5 的"最多一条 pending"建议下版同步） |
| 2026-11-21 18:30 | WorkBuddy | DEV-B002-013 | ①**恢复码（M4）**：`settings` 新增 5 个键（`parentPinRecoveryHash` / `Salt` / `UpdatedAt` / `FailedCount` / `LockedUntil`）；`hashPin` 复用但加 `recovery:` 域前缀；`generateRecoveryCode` / `formatRecoveryCode` / `normalizeRecoveryCode` / `verifyRecoveryCode` / `resetParentPinWithRecovery` / `issueRecoveryCode` 六个新导出；`setParentPin` 返回值扩为 `{ configured, updatedAt, recoveryCode, recoveryIssued }`；`clearParentPin` 清 10 个键 ②**彻底清空**：`backup.service.js` 新增 `wipeAllData`（单事务 14 表 clear + `_meta` 重写 + 清 localStorage 快照），`backupOverview.total` 清空后为 3 ③**界面**：PIN 弹层加「忘记 PIN」入口，新增恢复码展示弹层（复制 + 必须勾选）、恢复码校验页、设新 PIN 页；设置页加「恢复码」卡（未生成时催生成）与红色「删除全部家庭数据」危险区，删除走"重验 PIN → 勾选 → 实心红按钮" ④**PWA**：manifest 补 `id` / `display_override` / `orientation` / `categories`、主题色统一 `#FF8A3D` / `#FFF8F0`；SW `v1→v2` 且 `cache.put` 挂 `waitUntil`；`html { touch-action: manipulation }`；PIN / 恢复码输入框 placeholder 去字距 ⑤新增 `styles/m4.css`、`app/install.js` 无改动、`icons.js` 加 `key` ⑥`package.json` 0.1.0 → **1.0.0**，`vite.config.js` 用 `define` 注入 `__APP_VERSION__`，设置页显示「v1.0.0 · 封版」 ⑦新增 `docs/DEPLOY.md`（Vercel / Cloudflare Pages / 上线自检 / 真机内联清单 / FAQ） ⑧测试 +10 项（PN7–PN12、BK10–BK13），总数 **111 → 121** ⑨`tech/contract.md` 加 §7、`docs/screens/` +8 张（共 44） | 服务层、界面层、PWA 配置、契约、测试、部署文档、验收基线；**数据层结构未变**；`design/` 与 `PRD_v1.3.md` 本轮未改 |
| 2026-11-21 17:40 | WorkBuddy | DEV-B002-012 | ①**零结构变更**：`settings`（`settings: "key"` 键值表）与 `taskTemplates`（`id, type, enabled, *childIds`）在 Schema v1 已存在，M3 只是开始写这两张预留表，故 **Schema 仍 v2、仍 14 张表、不写 v3 迁移** ②新增 `settings.service.js`（键值读写，登记 8 个键）、`pin.service.js`（4 位 PIN：加盐 512 轮混合摘要、连错 5 次锁 60 秒、未设默认放行、改 / 关必须验当前 PIN）、`backup.service.js`（14 表全量导出、10 条校验、单事务清空+写入+补迁移、导入前快照、撤销上次导入、导入不改本机 PIN）、`template.service.js`（每日 / 每周几模板、`generationKey` 防重、启动补齐）③家长端新增第 6 Tab「设置」（PIN / 备份 / 固定任务 / 安装引导 / 存储信息五张卡片 + 退出），家长端 5 → 6 Tab ④新增 PIN 门控弹层（4 点 + 九宫格键盘 + 抖动 + 剩余次数 / 锁定秒数）、导入二次确认弹层（未勾选不能点）、`pages/assign.js` 重写加「只这一次 / 每天 / 每周几」与模板列表、今天任务行加「固定」标签 ⑤新增 `app/install.js` 与 `styles/m3.css`（约 700 行，含 6 Tab、PIN 键盘、安全区、弹层 `max-height` 滚动兜底）⑥`icons.js` 新增 lock / download / upload / trash / repeat 并重画 gear ⑦新增 3 个测试文件、23 项用例，测试总数 **88 → 111** ⑧更新 `tech/contract.md`（§1 补两表、§2.4–2.7 四服务、§3 幂等、§4 决策、§6 M3 实施结果）与 `docs/screens/` 8 张 | 服务层、界面层、契约、测试、验收基线；**数据层结构未变**；`design/` 与 `PRD_v1.3.md` 本轮未改 |
| 2026-11-21 18:40 | WorkBuddy | DEV-B002-011 | ①**Schema v1→v2**：`rewards` 补 `source/templateKey/category/name/description/iconKey/defaultCost/cost/costumeKey/updatedAt` 与 `&templateKey` 等索引，`redemptions` 补 5 个快照字段与 `[status+requestedAt]`，新增 `petCostumeOwnerships`（`&[childId+costumeKey]`、`&sourceRedemptionId`）与 `petCostumeStates`；`migrations.js` 加 `UPGRADES[2]` 防御性回填，**只加不删、不清库**；修 `_meta.schemaVersion` 升级后仍为旧值 ②新增 `reward.service.js`（11 内置模板 = 6 生活 + 5 装扮、幂等补齐、改价、启停、自定义奖励）、`redemption.service.js`（申请写快照不扣分 / 确认单事务扣分 + 幂等 / 拒绝只改状态 / 两个列表）、`costume.service.js`（只读目录、收藏、穿戴、卸下）③家长端新增「奖励管理」「兑换审核」两页，家长底栏 4 → 5 Tab，审核页带待处理与待确认双角标 ④孩子端新增积分商城（生活 / 装扮分段、**星星不够时按钮变「还差 X 颗」并只做提示、不下发申请**、pending 横幅）与衣柜（5 slot 网格、穿戴 / 卸下），`pet.js` 改分层装扮 SVG ⑤新增 `styles/m2.css`（约 640 行，含星空夜景与"换不了"态）⑥新增 3 个测试文件、拆分 1 个用例并更新 2 处断言，测试总数 **64 → 88** ⑦更新 `tech/contract.md`（§1 新增 4 表、§2.1–2.3 新增 16 个服务签名、§3 幂等键、§5.6 实施对照）与 `docs/screens/` 13 张 | 数据层（Schema v2）、服务层、界面层、契约、测试、验收基线；`design/` 与 `PRD_v1.3.md` 本轮未改 |
| 2026-11-21 16:18 | Trae | DEV-B002-010-DOC | ①PRD 补内置奖励 / 默认价、家庭改价、自定义奖励、兑换状态机、装扮收藏与穿戴、冲突处理 ②`design/00/01/02/03/05` 定点同步范围、九页 IA 内页面区域、状态、IR-11/11A/11B 与交接语义 ③`tech/contract.md` 新增 §5 后续模型、迁移、服务、事务、幂等与备份建议 ④明确 Schema v1 / M1 尚无这些能力 ⑤**未改 `src/` 或实际 Schema，未运行测试、构建或功能验收** | 产品方案、设计文档、未来技术契约；运行实现不变 |
| 2026-11-21 11:52 | WorkBuddy | DEV-B002-009 | ①`approval.service.js` 新增 `rejectTask`（tasks+reviews 双表事务，退回不写 `eventKey`、不发分）②新增 `child.service.js`、`streak.service.js` ③`task.service.js` 新增逾期/未来查询，`createTask` 校验孩子存在，`submitTask` 重提清 `revisionReason` ④新增 `pages/assign.js`、`pages/children.js`，家长端改 4 Tab ⑤孩子端 Hero 加连续天数，列表分「今天 / 逾期」，需修改可见原因并预填重提 ⑥新增 4 个测试文件、21 项测试（总 64）⑦更新 `tech/contract.md`、`docs/screens/` 14 张 ⑧**未改** Schema 版本、`design/`、PRD；`src/db/date.js` 仅增加 `shiftDateKey` 工具 | 服务层、界面层、契约、测试、验收基线 |
| 2026-11-21 11:13 | WorkBuddy | DEV-B002-008 | ①重写 `src/app/app.js`（外壳/路由/底部面板/飞星星/Toast）②新增 `store.js`、`ui.js`、`icons.js`、`pet.js`、`pages/{tasks,petPage,review}.js` ③新增 `styles/app.css`、`styles/pages.css`，重写 `tokens.css`、`base.css` ④`main.js` 追加两条样式引入、`index.html` 改 `theme-color` ⑤新增 `docs/screens/` 7 张验收截图 ⑥**未改** `src/db/`、`src/services/`、`tests/`、`design/`、`PRD_v1.3.md`、`tech/contract.md` | 界面层、视觉与交互；数据层契约不变 |
| 2026-11-20 23:27 | Trae | DEV-B002-007 | ①冻结 `design/` 为 v1.0 基线且未改设计/PRD ②修复 R-01/R-02/R-04/R-06 并补多孩子、重复生成、连续退回、复合索引、五表回滚及异常库测试 ③新建 `tech/contract.md` 与 `task.service.js` ④实现一个孩子、三个页面、五条 Seed 任务及启动接库 ⑤新增 `npm run verify`，43/43 单测与生产构建通过 ⑥真实 Chromium 点击闭环并验证刷新持久化 ⑦Q-02/Q-03/Q-05/Q-11 就地降级 | M0 产品、数据层契约、测试、协作状态 |
| 2026-11-20 22:25 | WorkBuddy | DEV-B002-006-RV1 | 逐行读 `src/db/`（6 文件）、`src/services/`（2 文件）、`tests/`（6 文件）与 `package.json`，与 PRD/design v0.4/tech 方案交叉比对；新建 `tech/review/` 与 `DEV-B002-006_交叉技术评审意见.md`（12 项结论、15 条问题 [P0×2/P1×6/P2×7]、四个重点核查项、E4 八条复核、Go/No-Go=B 有条件具备、页面开发三批次）；本文件 §2/§3/§5/§7 更新 | `tech/review/`、双 Builder 协作状态 |
| 2026-11-20 21:40 | Trae | DEV-B002-006 | ①安装 Dexie 4.4.7 + fake-indexeddb 6.2.8 ②新建 `src/db/`（schema/database/migrations/errors/date/ids）与 `src/services/`（approval/points）③Schema v1 共 12 表：`children` / `taskTemplates` / `tasks` / `submissions` / `reviews` / `pointLedger` / `petProgress` / `streaks` / `rewards` / `redemptions` / `settings` / `_meta` ④审核五表事务 + `approval:${taskId}` 幂等 + 余额派生 ⑤`tests/` 32 项 fake-indexeddb 单测（全通过）+ `tests/browser-smoke.html` 真实浏览器 17 项（全 PASS）⑥`package.json` 加 test 脚本 ⑦报告追加第六部分（20 节）⑧本文件第一至五、七节更新 | 数据层、依赖、测试、协作状态 |

### 历史变动

| 时间 | Builder | 任务 | 改了什么 | 影响范围 |
|---|---|---|---|---|
| 2026-11-20 12:45 | Trae | DEV-B002-005 | ①`RD_v1.3.md` → **`PRD_v1.3.md`**（28,080 B、SHA-256 前后一致）②新建 `tech/IndexedDB备份恢复技术方案.md`（962 行）③`DEV-B002-002_阶段交付报告.md` 追加第五部分（DEV-B002-005 交付报告）④本文件第二/三/四/五/七节更新 | 项目根目录文件名、技术恢复方案、协作状态 |
| 2026-11-20 12:41 | Trae | DEV-B002-005 | 开始前现场核验：确认 WorkBuddy R2 已交付、无并发写入；记录 PRD 大小/时间/SHA-256；确认 `tech/` 不存在 | 变更前基线证据 |
| 2026-11-19 23:12 | WorkBuddy | DEV-B002-003-R2 | 设计基线 v0.3 → **v0.4**：`00` 新增 §9.1（G-01/G-05 登记）+ K18 补第三删除路径；`01` 新增 §3.6 删除流程 + P-P5 第 5 分组；`02` 新增 §8.7（DEL-1～6）+ 成功判据 7 条；`03` 新增 IR-41 + IR-37 重写；`05` 新增 §3.12 + 附件条件规格；`06` 追加第四部分；本文件 §1–§5、§7 更新 | `design/` 全部设计口径、双 Builder 协作状态 |
| 2026-11-19 23:05 | Trae | DEV-B002-004 | 创建 `PROJECT_STATE.md`，记录阶段、任务、变动、文件现状、待裁决与冻结规则 | 双 Builder 协作状态事实源 |
| 2026-11-19 21:44–21:48 | WorkBuddy | DEV-B002-003 | 将设计基线修订为 v0.3，更新 `00/01/02/03/05/06` 六份文档；落实决策状态分层、Q-13/14/15 与 PRD 文件事实校正 | `design/` 设计基线与交接口径 |
| 2026-11-19 21:23 | Trae | Owner 指令：PRD 文件落地 | 按提供的正文创建 `RD_v1.3.md`；未改写产品规则 | 项目根目录 PRD 文件 |
|---|---|---|---|---|
| 2026-11-19 21:08–21:09 | Trae | DEV-B002-002 第一阶段 QA 准备 | 复核构建和真实浏览器测试；修正阶段报告中的错误路径写法；创建 `DEV-B002-002_第一阶段QA准备报告.md` | 技术骨架验收证据与路径一致性 |
| 2026-11-19 12:57–13:05 | Trae | DEV-B002-002 第一阶段 | 创建 Vite 骨架、应用入口、CSS Token、PWA Manifest、Service Worker 和图标；执行开发启动与生产构建测试；创建阶段交付报告 | `src/`、`public/`、构建配置、`dist/` |
| 2026-11-19 12:47–12:51 | WorkBuddy | DEV-B002-001 | 创建设计基线及交付报告，共 7 个文件 | `design/` 全部文件 |

（规则：本节只追加不删除，用于承接"最近变动"超 10 条后移出的更早条目。）

## 四、项目文件现状

### 根目录

- `PRD_v1.3.md`：存在，文件名与文档版本仍为 v1.3；2026-11-21 已由 DEV-B002-010-DOC 补充奖励中心与宠物装扮方案。历史基线为 28,080 字节、SHA-256 `3A50D8D77410338EA58D4FA6FF8A1EB520F3FC49EEC680DCF605FC386E7200C9`，仅用于证明 2026-11-20 由 `RD_v1.3.md` 改名前后正文一致，**不再代表当前文件大小或哈希**。根目录已无 `RD_v1.3.md`。
- `package.json`、`vite.config.js`、`index.html`：存在；`package.json` 已配置 `npm test`、`npm run build` 与 `npm run verify`（依次执行单测和生产构建）。
- `src/main.js`、`src/app/app.js`：存在（不在根目录）。
- `public/manifest.webmanifest`、`public/sw.js`、`public/icons/`：存在；图标目录含 `icon-192.png`、`icon-512.png`、`icon-maskable-512.png`。
- `DEV-B002-002_*` 报告：`DEV-B002-002_阶段交付报告.md`、`DEV-B002-002_第一阶段QA准备报告.md`。
- `PROJECT_STATE.md`：本文件。
- `DEV-B002-014-FINAL_上线前自检报告.md`：**2026-11-21 上线前终审新建**，含 14 项必查结论、生产预览核心链路证据、修改清单与上线后待验项。
- 其他：`package-lock.json`、`.gitignore` 存在。`.gitignore` 在终审中补齐为 `node_modules/` / `dist/` / `.shots/` / `.workbuddy/` / `*.log` / `*.crdownload` / `*.local` / `.DS_Store`。

### design/（WorkBuddy 负责）

- `00_设计任务说明.md`
- `01_信息架构.md`
- `02_页面状态矩阵.md`
- `03_交互规则.md`
- `04_视觉规范.md`
- `05_交接说明.md`
- `06_交付报告_DEV-B002-001.md`

共 7 个文件。自 DEV-B002-007 起整目录作为 **v1.0 冻结基线**；DEV-B002-010-DOC 经 Owner 明确授权，仅对奖励中心 / 宠物装扮定点补充 `00/01/02/03/05`，没有重开其他冻结规则。

各文件当前内部版本：`00` **v0.5** / `01` **v0.5** / `02` **v0.5** / `03` **v0.5** / `04` **v0.1（本轮未改）** / `05` **v0.5** / `06` v0.4（历史交付报告，本轮未改）。新增装扮内容均为后续需求，不代表 M1 已实现；当前实现事实仍以 `tech/contract.md` §1–§4 为准，未来建议见 §5。

### src/、dist/（双 Builder 共同维护）

- `src/`：存在。DEV-B002-014（v1.1.0）后结构如下：
  - `main.js`：入口，依次引入 `styles/tokens.css`、`base.css`、`app.css`、`pages.css`、`m1.css`、`m2.css`、`m3.css`、`m4.css`、`m5.css`，再挂载应用；生产环境注册 SW。
  - `app/app.js`：外壳（`.shell` 内新增 `#dock`，底部汇总条挂这里，**不放进 `.page`**）、双端路由（孩子 2 页 / 家长 **6** 页）、顶部、底部导航（家长端 **6 Tab**：确认 / 兑换 / 奖励 / 布置 / 孩子 / 设置）、任务提交/状态/退回/换孩子/奖励编辑/拒绝兑换/设 PIN/改 PIN/关 PIN/导入确认/删模板/**忘记 PIN/恢复码展示/恢复码校验/设新 PIN/删除全部数据（两段式）**等面板、**PIN 门控弹层**、`goPage()` 首行的门控拦截、审核与兑换动作（**M5：`handlePickReward` / `handleSubmitBatch` / `handleAcceptBatch` / `toggleBatchItem` / `recalcBatchCard` / `syncShopDock`**）、PWA 安装入口、异常终态页。
  - `app/store.js`：唯一数据适配层；写操作只调 `submitTask` / `approveTask` / `rejectTask` / `createTask` / `createChild` / `requestRedemption` / `acceptRedemption` / `rejectRedemption` / `equipCostume` / `unequipCostume` / `updateReward` / `setRewardEnabled` / `createCustomReward` / `setParentPin` / `clearParentPin` / **`resetParentPinWithRecovery` / `issueRecoveryCode` / `verifyRecoveryCode` / `wipeAllData`（M4）** / `restoreBackup` / `undoLastRestore` / `createTemplate` / `setTemplateEnabled` / `deleteTemplate`，读操作用服务查询；切换孩子 = 换 `childId` 后整体重载；`boot()` 里 `ensureTodayTemplateTasks()` + `getPinStatus()`；**`state.gateUnlocked` 只存内存**（刷新即失效）；**不写余额/等级字段**。
  - `app/ui.js`：转义、Toast、底部面板、飞星星、数字滚动、日期描述与自然日偏移、`downloadText`（Blob + `<a download>`）/ `formatBytes` / `describeRelative` / **`copyText`（M4：剪贴板 API 不可用时退化 `execCommand`）**。
  - `app/icons.js`：内联 SVG 图标集（M3 新增 `lock` / `download` / `upload` / `trash` / `repeat`，`gear` 重画为滑杆样式；**M4 新增 `key`**）、标题→科目视觉映射、孩子头像 Emoji 映射（纯 UI 常量，不入库）。
  - `app/install.js`：**M3 新增**——`isStandalone()` / `isIos()` / `installState()` / `watchInstallPrompt()`（拦 `beforeinstallprompt`）/ `promptInstall()`，三态文案（已安装 / 可拉起 / iOS 指引）。
  - `app/pet.js`：分层橘猫 SVG（背景 / 服饰 / 围巾 / 眼镜 / 帽子五层，按 `worn` 选择性渲染）+ 由累计经验派生的等级（遵守 R-15，不建状态表）+ 装扮缩略图（`costumeThumb`）。
  - `app/pages/`：`tasks.js`（今日 + 逾期分组）、**`petPage.js`（Hero / 积分商城（M5 多选清单 + 汇总条）/ 我的装扮 / 我的兑换 / 最近星星）**、`review.js`（总览/审核/退回）、`assign.js`（布置任务 + **重复方式选择器 + 固定任务列表**）、`children.js`（孩子管理）、**`redeem.js`（M5 重写：按 `batchId` 分组的批次卡 + 逐件勾选 + 统计实时重算）**、`rewards.js`（奖励管理）、**`settings.js`（M3 新增、M4 扩展：PIN / 恢复码 / 备份 / 固定任务 / 安装 / 存储 / 危险区七块 + 退出按钮）**。
  - `styles/`：`tokens.css`、`base.css`、`app.css`、`pages.css`、`m1.css`、`m2.css`、`m3.css`（M3：6 Tab、PIN 键盘、设置卡片、导入确认、星期选择器、安全区、弹层 `max-height` 滚动，约 700 行）、`m4.css`（M4，约 240 行）、**`m5.css`（M5 新增，约 290 行：可勾选卡片与角标、底部汇总条、批次明细与勾选框、`[hidden]` 覆盖修正）。**
- `src/db/`：`schema.js`（`SCHEMA_VERSION = 2`，`schemaV1` 原样保留 + `schemaV2`）、`database.js`（升级后同步改写 `_meta.schemaVersion`）、`migrations.js`（`UPGRADES` 按版本注册，`upgradeToV2` 防御性回填）、`errors.js`、`date.js`（M3 新增 `weekdayOfDateKey`）、`ids.js`。**Schema 版本 = 2，14 张表**；v1 的表、字段、索引一个未删；**M3 未新增任何表 / 字段 / 索引 / 迁移**。
- `src/services/`：`approval.service.js`（通过 + 退回）、`points.service.js`、`task.service.js`（创建/今日/逾期/未来/提交/Seed）、`child.service.js`、`streak.service.js`、`reward.service.js`、`redemption.service.js`、`costume.service.js`、**`settings.service.js` / `pin.service.js` / `backup.service.js` / `template.service.js`（M3 新增四个）**。
- `docs/screens/`：**52 张验收截图** = 14 张 M1 + 14 张 M2 + 8 张 M3 + 8 张 M4 + **8 张 M5**（兑换多选清单 / 已提交等确认 / 家长批次卡 / 部分勾选 / 换完结果 / 单件批次卡 / 整批退回弹层 / 退回后）。
- `tests/`：**16 个 `*.test.js`（共 130 项）**，fake-indexeddb + `browser-smoke.html` + `test-utils.js`；M3 新增 `pin.service.test.js`（6 项）、`backup.service.test.js`（9 项）、`template.service.test.js`（8 项）；M4 在这两个 M3 文件里各加 6 项与 4 项（PN7–PN12 / BK10–BK13）；**M5 在 `redemption.service.test.js` 加 9 项（M5-RD1～RD9）**。
- **Dexie 4.4.7**（dependencies）、**fake-indexeddb 6.2.8**（devDependencies）；**Schema 版本 = 2**（14 张表：13 业务表 + `_meta`）。
- `dist/`：Vite 生产构建产物（**已加入 `.gitignore`，不推送 GitHub**，Vercel 会自行构建）；终审 `npm run verify` 重新生成：`index-*.css` 68.79 kB / `index-*.js` 316.50 kB，另有 `index.html`、`manifest.webmanifest`、`sw.js`、`icons/`。
- `node_modules/`：本地依赖目录（验收用的 `puppeteer-core` 与临时验收脚本 `.shots/` 每轮结束前删除，不进入 `package.json`）。
- `src/pages/` 仍未创建；页面由 `src/app/pages/` 管理。

### tech/（2026-11-20 由 Trae 创建）

- `tech/IndexedDB备份恢复技术方案.md`：962 行，v1.0，状态待技术评审。含九步流程落地、三种写入方案比较、半成品库状态机、七条判据技术实现、存储空间预检、失败三档、G-05 删除可靠性、G-01 分支 A/B、一致性检查、验证边界清单（E1=0）。M0 未实现备份恢复。
- `tech/contract.md`：**DEV-B002-014 已更新为 M3 + M4 + M5 契约（v1.1.0，约 1127 行）**；**§8 为 M5 实施结果**（语义变更对照、`batchId` 无索引、交互落地、三个踩坑、130 项测试映射与浏览器证据）；§1 `redemptions` 补 `batchId` 行，§2.2 补 4 个 M5 服务签名。以下为 M4 时的说明：**DEV-B002-013 已更新为 M3 + M4 契约（约 1015 行）**。§7 为 M4 实施结果（恢复码规范、彻底清空语义、与任务书的 10 处差异、PWA 封版清单、121 项测试映射与两条浏览器证据、未做清单）；§1 `settings` 键表补 5 个恢复码键；§2.5 / §2.6 补 6 个 M4 服务签名。以下为 M3 时的说明：§1 含 **14 张表**字段（含此前缺失的 `taskTemplates` 与 `settings` 两张 v1 预留表，以及 v2 新增的奖励扩字段、申请快照、装扮收藏与穿戴）；§2 为 M1 的 13 个服务 + §2.1–§2.3 的 16 个 M2 服务 + **§2.4–§2.7 的四个 M3 服务模块**（设置 / PIN / 备份 / 模板，含常量、入参、返回、事务与纪律）；§3 幂等键（`generationKey` 已真正用于防重）；§4 决策状态（Q-03 / Q-06 / Q-09 因 M3 落地而更新）；§5 保留 M2 方案原文与差异；**§6 为 M3 实施结果**（备份文件格式、10 条导入校验、PIN 会话语义、与任务书的 6 处差异、测试与浏览器证据映射、未做清单）。
- `tech/review/DEV-B002-006_交叉技术评审意见.md`：保留为评审历史与后续问题清单；R-01/R-02/R-04/R-06 已修，R-05 未修。
- `docs/DEPLOY.md`：**M4 新建**——《本地部署与真机测试指南》，含本地构建 / Vercel / Cloudflare Pages / 上线 5 项自检 / 安卓与 iOS 安装步骤 / iOS 显示细节 / 数据与备份纪律 / 版本更新后的缓存行为 / 真机内测清单 / 常见问题表。

### 交付报告位置

- `DEV-B002-002_阶段交付报告.md` 的**第五部分**即《DEV-B002-005 交付报告》（16 节）。未新建独立报告文件，因为本轮授权只允许新建 `tech/IndexedDB备份恢复技术方案.md`。

## 五、已知不一致 / 待裁决

> 口径说明：Q 类 11 项是「设计侧提出的待确认建议（D2）」；G 类 4 项是「PRD 与设计基线的范围冲突」（含本轮已解决的 G-09）。两类分开计数，不混在一起凑数。
> 判定基准：**是否阻塞第二阶段（业务页面 + 数据模型）**。凡"实现后可能需要改结构"的都写"不阻塞但需保留可换空间"。

| 编号 | 内容 | 影响 | 待谁裁决 | 阻塞第二阶段？ |
|---|---|---|---|---|
| G-01 | PRD §5.3 要求文字/照片提交（照片原图存本地库），设计基线为"点一下完成"，范围冲突 | 数据模型（Blob）、P-C2、P-P3、备份体积与校验 | **Owner 已于 2026-11-20 裁决：第一版不做照片、保留文字提交**（待 QA 确认关闭） | **数据层阻塞已解除**：`submissions` 固定字段 + 文字载体字段已落地，附件字段仅预留、未建附件表。照片分支仍未冻结，若日后恢复需加字段/加表，不重建 `submissions` |
| G-05 | PRD §11.6 要求删除全部家庭数据；设计已于 v0.4 补齐（P-P5 危险分组 + 重验 PIN + 勾选确认 + 6 态 + 三档失败） | 家长端 P-P5 | **Owner 已确认（未否决），2026-11-21 由 DEV-B002-013 实现** | **已关闭**：`wipeAllData` 单事务清空 14 张表 + 重写 `_meta` + 清快照 + 强制刷新；重验 PIN 与勾选确认两道门；BK10–BK13 + 浏览器闭环验证 |
| 文件名 | ~~`RD_v1.3.md` 统一为 `PRD_v1.3.md`~~ | 文档引用一致性 | **已由 Trae 执行（2026-11-20）**，哈希前后一致 | 已解决。残留：`design/00` §7.1 仍写"当前实际文件名 `RD_v1.3.md`"，待 WorkBuddy 下轮更新 |
| G-08 | **（2026-11-20 新增）** PRD §11.4 规定 JSON 格式备份；若 G-01 选分支 A，照片 base64 内嵌 100 张 2MB 即达 267MB，单文件 JSON 可能不可行（需 ZIP 容器或允许"不含照片导出"） | 备份格式、导出/导入可行性 | Owner（确认是否随 G-01 裁决关闭） | **已降级为不阻塞**：Owner 裁决第一版不做照片，JSON 备份体积风险大幅下降。备份尚未实现，Schema 未写死 base64 结构 |
| **G-09** | 旧 PRD / 设计排除宠物装扮且只写 3 个占位奖励，与本轮内置生活奖励 + 简单宠物装扮方案冲突 | PRD §2.2/§6.4、设计范围与 P-C3/P-P4 | **Owner 已于 2026-11-21 通过 DEV-B002-010-DOC 裁决：允许系统内嵌 SVG 的简单装扮，仍排除复杂宠物游戏** | **已解决，不新增待裁决项**：PRD §17 与设计 `00` §7.2 已登记冲突处理；Q-13 库存 / 限兑禁令不变，收藏唯一不等于库存 |
| Q-01 | 备份"过期"阈值（≤7 天不提示 / 8–14 L1 / ≥15 L2）与 PRD §11.2"首页持续显示备份状态"冲突（G-03） | 家长端首页 | Owner | 不阻塞（阈值写成常量可调） |
| Q-02 | 连续学习天数断点判定（今天或昨天有通过则保留，≤前天归零；只在日期变更与审核时判定） | 连续学习 P-C4 | Owner（M1 已按建议口径展示，口径待确认） | **不阻塞**：M1 已在孩子端 Hero 展示连续天数，算法集中在 `streak.service.js` 的 `STREAK_RULE` + `getCurrentStreak`，改口径只动一处；streaks 仍只记每日通过数量 |
| Q-03 | 每周固定任务必须指定生成星期、可多选（未选不能保存） | 任务生成 P-P2 | Owner（M0/M1 均就地降级） | **不阻塞 M1**：不使用任务模板，Seed 与家长布置都直接写入 `tasks`，仅在 `tech/contract.md` 登记未来待实现 |
| Q-05 | 宠物经验与积分是否 1:1（数据层"分开记账"已确认，仅系数待定） | 积分体系 P-C3/P-P4 | Owner（M0/M1 均就地降级） | **不阻塞 M1**：保持 `EXP_PER_POINT = 1 // TODO(decision: Q-05)`；积分与经验继续分表记账，界面按真实流水展示 |
| Q-06 | 孩子 PIN 位数（按 4 位）与是否允许不同孩子重复 | 身份识别 P-C1 | Owner | 不阻塞（校验规则集中一处） |
| Q-07 | 家庭孩子数量上限（按不设硬上限） | P-C1 头像墙布局 | Owner | 不阻塞（列表本就无上限） |
| Q-08 | 重新生成恢复码是否立即作废旧码（按立即作废） | 恢复码流程 | Owner（**M4 已按"立即作废"实现**） | **已按建议口径落地**：`resetParentPinWithRecovery` / `issueRecoveryCode` 覆盖 hash + salt，旧码即刻失效（PN9 守着）；普通改 PIN 不轮换恢复码 |
| Q-09 | 退出家长模式是否需再输 PIN（按不需要） | 家长端操作步数 | Owner | 不阻塞（仅会话状态） |
| Q-11① | 第一版是否提供历史回看入口（按不做，记 V2-01） | 页面数 9 或 10 | Owner（M0/M1 均就地降级） | **不阻塞 M1**：不加入口、零代码改动；历史任务、审核与流水数据继续保留 |
| Q-11② | **历史任务/审核记录/积分流水/连续记录不得删除（= K18，已确认）** | 数据保留策略 | — 已确认，不待裁决 | 不阻塞（是硬约束，实现须遵守） |
| Q-12 | 往期未完成任务是否有补交时间窗口（按不设窗口，全部可补交） | 今日任务区规模 | Owner | 不阻塞（查询不写死时间窗；折叠必须在渲染层） |
| Q-16 | PWA 项目的开发/验收 SOP 缺失（现有 7 份 SOP 均面向 Chrome 扩展） | 交付验收规范依据 | Owner / 后续任务 | 不阻塞编码（影响验收标准，建议二阶段并行补） |
| **RV-01** | **（2026-11-20 更新）** DEV-B002-007 指定的四个 P0 已修：R-01 `generationKey` 加入 `childId`；R-02 通过审核写 `approval:${taskId}`、退回记录不写 `eventKey` 属性；R-04 `streaks` 改按 `[childId+date]` 查询并用真实 id 更新；R-06 启动时识别 `restoreState`，半成品/来源不明业务库抛 `DB_INVALID_STATE`，不自动盖章或覆盖数据 | 数据层契约与 M0 页面起点 | Trae 已执行，待 QA 复核 | **不再阻塞 M0**：相关单测已纳入 43/43 通过；原评审中的 **R-05（`DB_READ_FAILED` 与界面格映射）不在本轮范围，仍未修**，不得视为已关闭 |
| **RV-02** | **（2026-11-20 更新）** 历史证据曾不一致：Trae 报告声明 Node **24.18.0**，WorkBuddy 环境实测 **v22.22.2** 且 32/32 未复现；本轮 Trae 现场实测为 **Node v24.18.0 / npm 11.16.0**，43/43 与生产构建通过 | 交付证据的可追溯性与跨版本复现 | QA 跨版本复核 | 否（不影响 M0 代码）；本轮结果支持原 Trae 环境记录，但不据此否定 WorkBuddy 在 v22.22.2 的历史结果 |
| **DOC-01** | **（2026-11-20 新增）** 设计文档与实现开始漂移，需下轮设计任务结清：① G-01 已由 Owner 裁决"不做照片、保留文字"，但 `design/00` §4/§7.2/§9.1、`01` §2.2、`03` IR-03 仍写"未裁决/阻塞" ② 宠物模型：`design/05` §2.3 写"等级/当前经验"，实现只有 `petProgress` 经验流水（等级派生），文档需改为"不建状态表" ③ `tech` §2.1 表清单仍写 11 张，实际 11 业务表 + `_meta` | 页层实现口径（照文档做会造出第二真相） | WorkBuddy（下一次设计任务） | 否（不阻塞编码，但照现有文档做会出错） |

**计数核对**：Q 类 **11 项**（Q-01、Q-02、Q-03、Q-05、Q-06、Q-07、Q-08、Q-09、Q-11、Q-12、Q-16），其中 Q-11 拆①②两层、②已确认为 K18 不待裁决；G 类 **4 项**（G-01、G-05、G-08、G-09；G-09 已解决）；另有 **评审类 2 项**（RV-01、RV-02）与 **文档漂移 1 项**（DOC-01），**不计入 Q/G 计数**，也不与它们合并凑数。**2026-11-21 M1 变化**：Q-02 已按建议口径在界面展示（口径待 Owner 确认，不阻塞）；Q-03 仍未用模板、Q-05 仍为 `EXP_PER_POINT = 1`、Q-11 仍无历史入口，降级边界不变。当前**无阻塞 M1 的 G/Q 项**。**M2 变化（2026-11-21）**：奖励兑换、装扮收藏与穿戴**已实现并验证**（88/88 单测 + 浏览器闭环），不再是"未做"项；Q-13"无库存、无限兑"按冻结规则实现，未新增待裁决项。**M3 变化（2026-11-21）**：家长 PIN 与备份 / 恢复**已实现并验证**（111/111 单测 + 三条浏览器闭环），不再是"未做"项；**Q-03（每周固定任务 / 模板）已实现**，`taskTemplates` 开始写入；**Q-06 按 4 位落地**（家长端一把锁，不按孩子区分）、**Q-09 按"退出不需再输、再进要输"落地**（会话内存态），两项目前按建议口径实现，Owner 若改口径的改动面已在 `pin.service.js` 收敛为常量与一个函数。~~**G-05（删除全部家庭数据）仍未做**~~ —— **M4 已落地（2026-11-21）**：设置页危险区 → 重验 PIN → 勾选确认 → 单事务清空 + 强制刷新，BK10–BK13 四项单测 + 浏览器闭环守着。**M4 变化（2026-11-21）**：**G-05 关闭**；**Q-08（重新生成恢复码是否立即作废旧码）按"立即作废"实现**（`resetParentPinWithRecovery` / `issueRecoveryCode` 覆盖 hash + salt，PN9 守着）；**"忘记 PIN 找回"不再是"未做"**。**当前仍未做**：恢复码有效期 / 多份并存、家长协助者 / 多账号、AI 生成学习计划与错题解析、照片提交、历史回看、奖励删除与库存 / 限兑、云同步 / 自动定时备份、**iOS Safari 与安卓真机安装 / 离线冷启动 / Lighthouse 实跑**。**RV-01 中 R-01/R-02/R-04/R-06 已修；R-05 未修，保留在后续评审清单。** DOC-01 的既有条目不因本轮自动关闭；**M4 当前实现以 `tech/contract.md` §1–§4（含 §2.1–§2.7）与 §6 / §7 为准**。**M5 变化（2026-11-21）**：不新增 G / Q 待裁决项；兑换的 pending 约束由"最多一条"改为"最多一批（1–6 件）"，属 Owner 本轮明确要求的规则演进，**已在 `tech/contract.md` §8.2 登记并标注 PRD §6.5 需下版同步**；Q-13（无库存 / 限兑）不受影响，批量提交仍不做库存扣减。当前实现以 `tech/contract.md` §1–§4 与 §6 / §7 / §8 为准。**上线前终审（2026-11-21，DEV-B002-014-FINAL）**：不新增 G / Q 待裁决项；遗留三项均不阻塞上线——①**任务书写的 v1.0.0 与仓库实际 v1.1.0 不一致**（1.1.0 为 M5 既定版本，已通过设置页展示，未回退）；②**任务编号重号**（014 同时指 M5 与本轮终审，本轮以 `-FINAL` 后缀区分）；③**iOS Safari / 安卓真机安装与离线冷启动、Vercel 线上实跑仍未验**（清单见 `docs/DEPLOY.md` §10），不得表述为"全端通过"。此外 PRD §6.5 的"最多一条 pending"仍待下版与 `tech/contract.md` §8 同步。

## 六、冻结规则（不得回退，新任务不得重新讨论）

- 任务四状态：待完成 / 待家长确认 / 已通过 / 需修改
- 审核通过 = 五表原子事务（tasks / reviews / pointLedger / petProgress / streaks）
- 事件幂等键：`approval:${taskId}`
- K18：历史任务、审核记录、积分流水、连续记录不得删除
- 逾期任务查询取全量，渲染层折叠，禁止查询阶段 limit
- Q-13：第一版不支持奖励限量/限兑
- Q-14：第一版按日期级截止，默认当天 23:59
- Q-15：第一版不支持主动放弃任务
- 积分余额由 pointLedger 汇总派生
- 备份导入前自动备份 + 二次确认 + 覆盖恢复
- **（M2 新增）兑换扣分只在 `acceptRedemption` 单事务内发生，幂等键 `redemption:${redemptionId}`**
- **（M2 新增）申请只写快照、不扣分、不冻结积分；确认只认 `costSnapshot`，不读 `rewards.cost`**
- **（M2 新增）星星不够就不生成申请**：按 `balance < cost` 在孩子端直接挡回并提示还差几颗，家长只处理已够数的申请；家长确认时的余额复核保留为兜底
- **（M2 新增，M5 修订）同一孩子同时最多一批 pending（1–6 件，共用 `batchId`）；`accepted` / `rejected` 均为终态，不可互转** —— M5 之前为"最多一条"，一次提交多件后按"一批"计；批量确认时**未勾选的件必须在同一事务里退回**，不许留悬挂 pending
- **（M2 新增）装扮只改外观：不写 `pointLedger` / `petProgress`，不改经验、等级、连续天数**
- **（M2 新增）Schema 只加不删：v1 表 / 字段 / 索引永久保留，升级走 `migrations.js` 版本化迁移，禁止删库重建**
- **（M3 新增）备份必须覆盖全部 14 张表（含 `settings`、`petCostumeOwnerships`、`petCostumeStates`）；少一张即视为坏文件，导入阶段直接拒绝**
- **（M3 新增）导入 = 先校验、再单事务清空 + 写入。校验不通过一律零写入；写入中途失败整笔回滚，库保持导入前原样**
- **（M3 新增）导入前自动留快照（`localStorage["b002.preRestoreSnapshot"]`，上限 4MB）；快照不入库，撤销时不再生成新快照（防套娃）**
- **（M3 新增）PIN 以本机为准：导入备份时先删备份里的 5 个 PIN 键，再写回本机原值；PIN 明文永不入库，只存盐 + 摘要**
- **（M3 新增）PIN 只做防误触，不做防篡改**：不得在文档或界面里表述为"安全加密"；也不得因"反正能改库"而撤掉门控
- **（M3 新增）家长端会话态只存内存**（`state.gateUnlocked`）：刷新 = 新会话 = 重新验证；不得把它写进 `settings` 或 `sessionStorage`
- **（M3 新增）固定任务防重只认 `generationKey` + `&generationKey` 唯一索引 + 事务内查重**：不得靠"启动只跑一次"或界面禁用按钮来保证不重复
- **（M3 新增）删除模板不删历史任务，模板停用不删已生成任务**（K18 的延伸）；`tasks.templateId` 允许悬空
- **（M4 新增）恢复码只存摘要（`recovery:` 域前缀 + 独立盐），明文只在生成那一瞬间返回一次**：任何页面、日志、备份都不得出现明文；弹层必须勾选"我记下了"才能关闭
- **（M4 新增）重置 PIN = 换码**：`resetParentPinWithRecovery` 与 `issueRecoveryCode` 一律覆盖旧 hash + salt，**旧恢复码立即作废**（Q-08 按"立即作废"落地）；相反，普通"改 PIN"**不轮换**恢复码
- **（M4 新增）恢复码与 PIN 的失败计数、锁定时间必须分开**：不得共用一个计数器（否则孩子乱猜恢复码会把家长自己的 PIN 输错额度耗光）
- **（M4 新增）删除全部家庭数据必须"重验 PIN（已配置时）+ 勾选确认 + 单事务"三件齐**：不得复用会话解锁态，不得只清业务表而留下 `settings` / `_meta` 半残，不得软删除
- **（M4 新增）清空后 `_meta` 必须写回 `restoreState: "complete"` 与当前 `schemaVersion`**：少了这一行，下次 `openDatabase()` 会把库判成 `DB_INVALID_STATE`，等于把用户锁在门外
- **（M4 新增）清空要连 `localStorage["b002.preRestoreSnapshot"]` 一起清**：留着快照等于"删了还能一键恢复"，与用户点删除时的预期冲突；但**绝不碰**用户已经下载到硬盘的 JSON 文件
- **（M4 新增）版本号只有一个来源（`package.json`）**，经 `vite.config.js` 的 `define` 注入 `__APP_VERSION__`；不要在页面里再手写一遍版本串
- **（M5 新增）一次提交 = 一个 `batchId`，每件仍是独立 `redemptions` 行（各自快照、各自 `eventKey`）**：不要为了"批量"把多件塞进一行，那会破坏快照与幂等
- **（M5 新增）批次确认只有一个事务入口 `acceptRedemptionBatch`**：勾选的通过、未勾选的同事务退回、余额按**合计**校验；页面里不得逐件循环调用 `acceptRedemption`（会出现"扣了三件中两件"的半成功）
- **（M5 新增）`batchId` 无索引、不加迁移**：分组在内存里做（`row.batchId ?? row.id`）；不要为它开 v3，也不要给老数据批量回填
- **（M5 新增）`position: fixed` 的元素不得放进 `.page`**：`.page` 带 `rise-in` 动画（`transform` 不归零），会成为 fixed 的包含块，元素会被排到视口外。底部汇总条挂 `#dock`
- **（M5 新增）新增带 `display` 的组件要显式写 `[hidden] { display: none }`**：`.redeem__warn` / `.shop-bar` 都踩过，UA 的 `[hidden]` 打不过作者样式
- **（M5 新增）不要用 `data-balance` 标记"非余额"的数字**：`paintBalance()` 会扫全文档 `[data-balance]` 并改写内容；批次统计用 `data-batch-balance`

## 七、下一位 Builder 的必读清单

- 读 `PROJECT_STATE.md`（本文件）
- 读 `PRD_v1.3.md`（文件名 / 文档版本仍为 v1.3；2026-11-21 已补奖励中心与宠物装扮方案，旧哈希仅为历史证据）
- 读 `design/` 全部 7 个文件；奖励中心 / 宠物装扮以 `00/01/02/03/05` 的 **v0.5** 为准，`04` v0.1 与历史 `06` 未改。其他历史冲突仍按各文档修订记录处理
- 读第三节最近 3 条变动
- 读第五节"已知不一致 / 待裁决"和第六节"冻结规则"
- **上线 / 部署前读 `DEV-B002-014-FINAL_上线前自检报告.md`**（2026-11-21 终审，结论 GO：`.gitignore` 已补漏、`base: "./"` 正确、预览零控制台错误、SW `activated`、130/130 通过；真机与线上实跑仍未验）
- **读 `tech/review/DEV-B002-006_交叉技术评审意见.md`**（数据层评审结论、15 条问题、Go/No-Go 与页面开发顺序）
- Trae 另读 `DEV-B002-002_阶段交付报告.md` 与 `DEV-B002-002_第一阶段QA准备报告.md`

**本轮（R2）新增强制必读项（不做会出错）**：

1. **`00` §9.1（G-01）**：未裁决前**不要建 Blob 表**、不要把"任务记录很小"写进任何容量/性能假设；备份格式**必须带版本字段**（无论 G-01 怎么裁决都要做）。
2. **`03` IR-37 与 `02` §8.6.3（7 条成功判据）**：恢复成功不再是"5 条"，且**必须逐表比对**，禁止只比总记录数。
3. **`05` §3.10「半成品库判定」**：写入失败后重载必须拦在 F2，不能进业务界面；需要显式的"写入完成标记"。
4. **`03` IR-41 与 `02` §8.7（删除全部家庭数据）**：必须**重验 PIN**（不复用会话）+ 勾选确认；失败三档不得显示成功；**异常页永远不放这个入口**。
5. **`03` IR-03 的"无附件"已降为临时口径**：不要把它当成冻结规则写进不可逆假设。

**Trae 需要先给方案的两处**（`05` §4 第 13–17 条）：~~恢复的写入架构（临时库/就地/可回滚）、单事务写 Blob 的可行性（若 G-01 含附件）~~ → **已于 2026-11-20 给出**（见下条），**方案未获评审通过**。

**本轮（DEV-B002-005）新增必读**：

- 读 `tech/IndexedDB备份恢复技术方案.md`：九步流程落地、七条判据技术实现、三种写入方案比较（推荐"临时库切换 + 旧库延迟删除"）、半成品库状态机与启动检查、存储空间预检、失败三档、G-05 删除可靠性、G-01 分支 A/B、一致性检查、验证边界清单。
- **验证边界纪律**：该文档 E1（真机已验证）= 0 条。所有浏览器行为均为 E2（文档依据）/ E3（原理推导）/ E4（待验证），**不得当已验证事实引用**；"单事务上限""临时库切换耗时""iOS Safari Blob 可靠性"三条尤其不得写成确定结论。

**DEV-B002-006 交付时必读（历史状态；启动接库、提交服务与测试总数已由 DEV-B002-007 更新，见文末）**：

- **Schema 版本 = 1**，共 12 张表：`children` / `taskTemplates` / `tasks` / `submissions` / `reviews` / `pointLedger` / `petProgress` / `streaks` / `rewards` / `redemptions` / `settings` / `_meta`。定义在 `src/db/schema.js`，迁移注册在 `src/db/migrations.js`，任何结构变化必须加新版本 + upgrade，不得删库重建。
- **`submissions` 结构取向**：固定字段 `taskId` / `childId` / `submittedAt` / `version` / `status`；`contentType` / `content` 为真实可写字段（Owner 裁决第一版只做文字）；`attachmentIds` **仅预留、不写值、不建附件表**。G-01 若恢复照片，做"加字段 / 加 attachments 表"，**不要重建 `submissions`**。
- **审核通过**在 `src/services/approval.service.js`：单事务写 tasks / reviews / pointLedger / petProgress / streaks，幂等键 `approval:${taskId}`，`approvalDate` 用本地自然日。
- **积分**在 `src/services/points.service.js`：余额只从 `pointLedger` 汇总，无缓存字段；手动调整必须写流水 + 原因；余额不得为负。
- **测试**：`npm test`（32 项，**fake-indexeddb**）；真实浏览器冒烟页 `tests/browser-smoke.html`（17 项 PASS，但环境是 **TraeCN 内置 Chromium 142 / Electron**，不等于 Chrome/Edge/Safari 正式版）。
- **页面开发前缺口**：应用启动流程尚未接入 `openDatabase()`（打开失败态未做 UI）；提交服务未写；Q-02/03/05/11 口径未确认。
- 读 `DEV-B002-002_阶段交付报告.md` **第六部分**（20 节，含未验证假设登记表 E4-01～E4-08）。

**本轮（DEV-B002-006-RV1）新增必读（评审结论，不是裁决）**：

1. **读 `tech/review/DEV-B002-006_交叉技术评审意见.md` 全文**，尤其 §2.1 问题表（R-01～R-15）与 §6 必修清单。
2. **两条 P0 契约（写代码前就要守）**：
   - **R-01**：`generationKey` 必须含 `childId`。现仓库里的样例是 `daily:模板id:日期`（`tests/test-utils.js:54`、`tests/browser-smoke.html:94`、`tests/database.test.js:117`），**照抄会在"一个模板分给两个孩子"时撞 `&generationKey` 唯一索引**。
   - **R-02**：`reviews.eventKey` 的"留空"= **不写该属性**，不是写 `""`。依据：`tests/database.test.js:132` 那条断言证明空字符串是合法键值、会被索引。退回服务开工前必须先把这条写进注释并补测试。
3. **R-04（建议与 P0 同级）**：`streaks` 查询改用 `where("[childId+date]")`，不要用 `${childId}:${date}` 确定性主键 `get()` —— 主键格式一旦不符，`add` 会撞唯一复合索引，**整笔审核失败**。
4. **R-06 / R-07（备份轮次前置）**：`database.js` 的 `ensureMetadata` 会在每次打开时补写 `_meta.schemaVersion`，等于给"恢复写了一半的库"盖章；且它只在缺失时写，未来 v2 升级不会更新。做恢复前必须先改启动检查（`tech` §6.3–6.5 的 `restoreState`）。
5. **R-08（页层文案/分组）**：流水按 UTC 的 `createdAt` 排序，**禁止**对 ISO 字符串截前 10 位当日期；按 `approvalDate` 分组。
6. **测试边界**：`tests/browser-smoke.html` 17 项**全是成功路径，零失败注入**。回滚结论目前只来自 fake-indexeddb（E4-01）；不得表述为"真实浏览器验证通过"。
7. **R-15**：宠物**只有经验流水、没有状态表**，等级由累计经验派生。**不要**新建 `pets` 表或往 `children` 加等级字段。

**本轮（DEV-B002-007）新增必读（M0 当前事实源）**：

1. **先读 `tech/contract.md`**：M0 只使用 `children` / `tasks` / `submissions` / `reviews` / `pointLedger` / `petProgress` / `streaks` / `_meta` 八张表；服务签名与幂等键以该契约为准。发现实现与冻结设计不一致时改契约，不改 `design/`。
2. **四个 P0 已落地**：固定任务生成键为 `${type}:${childId}:${templateId}:${dateKey}`，临时任务不写 `generationKey`；审核通过写 `approval:${taskId}`，退回记录不写 `eventKey`；streaks 按 `[childId+date]` 查询；`restoring` 或有业务数据但缺 `complete` 的库进入 `DB_INVALID_STATE`，不得删库重建。R-05 未修。
3. **M0 已启动接库并有提交服务**：`src/app/app.js` 启动执行 `openDatabase() → ensureSeedData() → refreshData()`；`src/services/task.service.js` 提供 create/list/submit/seed。一个孩子“朵朵”、五个 Seed、三个页面均已可点击操作。
4. **M0 降级边界**：Q-02 不展示也不算连续天数；Q-03 不用模板；Q-05 保持 `EXP_PER_POINT = 1 // TODO(decision: Q-05)`；Q-11 不加历史入口。不得把上述降级误解为数据删除或许可合并积分/经验流水。
5. **当前验证命令**：`npm run verify` = `npm test && npm run build`；本轮结果 **43/43 单测通过 + 构建成功**。006 的“32 项”“启动未接入”“提交服务未写”仅为当时历史状态。
6. **真实浏览器证据边界**：已在当前 Chromium 自动化环境实际点击完成“整理书包”文字提交与家长审核，随后刷新仍为已完成、1/5、星星 5。该结果不等于外部 QA PASS，不覆盖 Safari、真机或其他孩子/任务。
7. `design/` 已作为 **v1.0 冻结基线**；本轮没有修改设计文件、`PRD_v1.3.md`，也没有另写 P0 修复报告。交付状态为 **WAITING_FOR_QA**。

**本轮（DEV-B002-008）新增必读（界面层当前事实源）**：

1. **只换皮不换芯**：`src/db/`、`src/services/`、`tests/`、`design/`、`PRD_v1.3.md`、`tech/contract.md` 本轮零改动。改界面只动 `src/app/**` 与 `src/styles/**`（外加 `main.js` 的样式引入）。
2. **数据入口统一在 `src/app/store.js`**：新页面不要直接 `getDb().tasks.update/add`，那会绕开契约、状态校验与幂等键。
3. **事件委托绑在 `document` 而不是 `.shell`**：底部提交面板渲染在 `#sheet-layer`（shell 之外），绑到 shell 会漏掉面板内表单，表现为原生提交 + 整页刷新。本轮已踩过一次，勿回退。
4. **退回按钮没有服务实现**：`tech/contract.md` 只有 `approveTask`。本轮保留「退回」视觉与位置但点击只提示，**没有**自造 reviews/tasks 写入路径。要做真退回，先加 `reviewTask` 服务 + 契约 + 测试，再改按钮。
5. **R-08 仍生效**：流水日期标签一律用 `approvalDate`，禁止对 `createdAt` 这类 ISO 时间戳截前 10 位当日期。
6. **等级与经验是派生的**：`src/app/pet.js` 用 `EXP_PER_LEVEL = 40` 现算等级与进度，不建表、不写字段；调数值只改这一个常量。
7. **验证口径**：`npm run verify`（43/43 单测 + 构建）+ 真实浏览器手动闭环 `todo → submitted → approved → 刷新`；`docs/screens/` 是该轮视觉基线，改版后对照避免回退。
8. **仍未验证**：本轮只在 Chromium 430×932 跑通，Safari / iOS / 真实平板、离线首开、安全区适配均未验，不得表述为"全端通过"。

**本轮（DEV-B002-009）新增必读（M1 当前事实源）**：

1. **服务清单以 `tech/contract.md` 为准（已更新为 M1）**：`rejectTask` / `listOverdueTasks` / `listUpcomingTasks` / `listChildren` / `createChild` / `getChild` / `getCurrentStreak` 是新增的，签名、返回与错误码都写在该文件 §2。
2. **退回纪律（R-02 已落地，别改回去）**：`reviews` 的退回记录**不写 `eventKey` 属性**，也不写 `approvalDate`；写了空字符串会撞 `&eventKey` 唯一索引，导致第二次退回整笔失败。退回只改 `tasks` + `reviews` 两张表，**不发积分、不发经验、不动 streaks**。
3. **多孩 = 换 `childId` 后整体重载**：`store.switchChild()` 会重查任务、流水、提交、经验、连续天数；任何页面都不得缓存上一个孩子的 `tasks` / `balance`。`children` 表**没有新增字段**，Schema 仍是 v1，旧库直接可用。
4. **布置任务**：`createTask` 在事务里校验孩子存在，不存在直接拒绝，不留孤立 task；`dueDate` 支持今天/明天，`listUpcomingTasks` 只查明天~第 7 天，不含今天。
5. **逾期口径**：`dueDate < 今天 && status !== approved`，查询取全量、不 limit，折叠只在渲染层（`state.showOverdue`）；补交通过后按**实际审核日**记 streak，不回填原截止日。
6. **连续天数**：Q-02 建议口径已实现并展示（今天或昨天有通过则保留），集中在 `streak.service.js` 的 `STREAK_RULE` 与 `getCurrentStreak`；Owner 改口径只动这一处，不要散落到页面里。
7. **M1 仍未做**：家长 PIN、备份/恢复、删除全部家庭数据、奖励兑换、照片、历史回看。项目里**没有任何"删除数据"入口**，别为了让按钮可点而私造。
8. **验证口径**：`npm run verify` = **64/64 单测 + 构建**；真实浏览器已跑通「布置 → 提交 → 退回 → 重提 → 通过 → 刷新」与两个孩子的数据隔离，控制台零错误。Safari / 真机 / 离线仍未验。`docs/screens/` 14 张为当轮视觉基线。

**本轮（DEV-B002-010-DOC）新增必读（奖励中心 / 宠物装扮未来需求）**：

1. **产品主规则**：读 `PRD_v1.3.md` §6.4、§6.5、§7.4 与 §17；11 个内置奖励的积分均为建议默认值，家长改价后不得被刷新、重进或 Seed 覆盖。
2. **页面与交互**：读 `design/01` 的 P-C3 / P-P4、`design/02` §2.3 / §2.8、`design/03` IR-11 / IR-11A / IR-11B；仍复用九页 IA，不新增核心页面。
3. **兑换纪律**：申请不扣分、不冻结、不写流水；确认按申请快照重新汇总余额并单事务扣分，装扮同时入收藏；拒绝不扣分，重复确认不得重复写流水 / 收藏。
4. **装扮边界**：只用系统内嵌 SVG；收藏与穿戴按 childId 持久化，未拥有不能正式穿戴，穿戴 / 卸下不写积分或经验，Q-13 无库存 / 限兑规则不变。
5. **技术差异与后续事项**：读 `tech/contract.md` §5。后续开发须另立任务，以新 Schema 版本 + upgrade 补奖励字段、申请快照、收藏和穿戴模型及服务；该轮没有修改 `src/`、实际 Schema，也没有运行测试、构建或功能验收。**以上"未实施"的表述已被 DEV-B002-011 取代。**

**本轮（DEV-B002-011）新增必读（M2 当前事实源）**：

1. **Schema 版本 = 2，14 张表**。升级逻辑只在 `src/db/migrations.js` 的 `UPGRADES[2]`（`upgradeToV2`），对旧记录**只补缺失字段、不覆盖 `cost` / `enabled` / `name`**。已发布的 `schemaV1` 一个字都不能改；要加东西就再开 v3。禁止删库重建、禁止用 `db.delete()` 绕过迁移。
2. **唯一索引两个坑（会直接让写入整笔失败）**：① 自定义奖励**不写 `templateKey` 属性**——空字符串是合法索引键值，第二条自定义奖励会撞 `&templateKey`；② `petCostumeOwnerships.sourceRedemptionId` 唯一，同一申请不能重复到账，`&[childId+costumeKey]` 保证同一孩子同一装扮只收藏一份。
3. **兑换只有一个扣分入口**：`acceptRedemption`。`requestRedemption` 只写 `pending` + 5 个快照字段，**不写流水、不冻结、不扣分**；**星星不够时它直接抛错拒绝**（`还差 N 颗星星…`），不生成必然被驳回的申请，也不占"同时一条 pending"的名额；`rejectRedemption` 只改状态。任何 UI 都不要直接 `pointLedger.add` 或改余额。
4. **快照不可回改**：确认扣分只认 `costSnapshot`，**不读** `rewards.cost`。家长改价只影响之后的新申请，已提交的 pending 与历史一律按快照结算（有测试 RD4 守着）。
5. **幂等与并发**：`pointLedger.eventKey = redemption:${redemptionId}` 是"一分只扣一次"的唯一保证；并发双击由事务内前置查重 + `ConstraintError` 兜底返回 `duplicate`（RD8：两次并发确认 = 1 次 accepted + 1 次 duplicate，只扣一次）。
6. **装扮只改外观**：不写 `pointLedger` / `petProgress`，不改经验、等级、连续天数；未拥有的装扮不能穿戴（服务层校验同孩子收藏）；`petCostumeStates` 每个孩子一条，未穿戴的 slot **省略属性**而不是写 `""`。目录 `COSTUME_CATALOG` 是代码内只读常量，不入库、不可上传。
7. **家长端现在是 5 个 Tab**（确认 / 兑换 / 奖励 / 布置 / 孩子），角标来源两个：`review`（待确认任务）与 `redeem`（待处理兑换）。内置奖励**只能改 `cost`**，传 `name` 会抛错；停用只阻止新申请，不删历史。
8. **验证口径**：`npm run verify` = **88/88 单测 + 构建成功**；真实 Chromium 430×932 已跑通「攒 20 星 → 申请小草帽 → 家长通过（-20）→ 穿戴 → 刷新保持 → 改价 20→25 → 停用动画片 → 孩子端只见 5 条生活奖励」，控制台零错误。`docs/screens/` 28 张为当轮视觉基线。Safari / 真机 / 离线仍未验。
9. **M2 仍未做**：备份 / 恢复（新表尚未纳入备份范围）、家长 PIN、删除全部家庭数据、历史回看、照片提交、奖励删除与库存 / 限兑（Q-13 永久不做第一版）。

**本轮（DEV-B002-012）新增必读（M3 当前事实源）**：

1. **Schema 仍是 v2，14 张表，没有 v3**。M3 之所以不升版本，是因为 `settings`（`settings: "key"`）与 `taskTemplates`（`id, type, enabled, *childIds`）在 v1 就已建好，`tasks.templateId` / `tasks.generationKey` 也在 v1 里。**不要为了让文档看起来完整而补一个空的 v3 迁移**——空迁移同样会触发 `onupgradeneeded`，是无收益的写入风险。
2. **备份必须覆盖 14 张表**（`BACKUP_TABLES` 的顺序就是依赖顺序，表集合由 `validateBackupPayload` 严格比对）。新增表/字段时，**第一件事是把新表加进 `BACKUP_TABLES` 与 `PRIMARY_KEYS`**，否则用户导出的备份会悄悄缺数据，而导出不会报错。
3. **导入是"先校验、后单事务"**，校验器 `validateBackupPayload` 是**纯只读函数**（BK9 守着）。不要在校验阶段"顺手修数据"或"补默认值"，那会让"坏文件被修好后写进库"变成现实。
4. **导入前快照与撤销**：快照在 `localStorage`（`b002.preRestoreSnapshot`，上限 4MB），`undoLastRestore` 用 `skipSnapshot: true` 防止快照套娃。快照**不入库**——入库会让每次导入都膨胀一次备份体积。
5. **PIN 以本机为准**：`restoreBackup` 在事务内先删备份里的 5 个 PIN 键再写回本机值（BK8）。**不要"为了忠实还原"把备份里的 PIN 写回去**——换设备或导回旧备份会把 PIN 改回半年前的，甚至直接锁死家长。
6. **`generationKey` 是防重的唯一依据**：`${type}:${childId}:${templateId}:${dateKey}`，`&generationKey` 唯一索引 + 事务内先查后写 + `ConstraintError` 兜底。**不要用"启动时只跑一次"或"按钮只点一次"来代替**——多设备、刷新、切页都会重跑。
7. **`daily` 模板不写 `weekdays` 属性**（不是 `[]`、不是 `null`）；`weekly` 的 `weekdays` 取值是 `Date.getDay()` 口径（0=周日），展示顺序是周一→周日，别把两套顺序混用。
8. **PIN 会话态只在内存**：`state.gateUnlocked`，`boot()` 里强制置 `false`。写进 `settings` 或 `sessionStorage` 都会让"刷新即失效"的产品语义破功。
9. **门控的判断点在 `goPage()` 入口**，不是 Tab 上绑事件：任何新增的家长页都必须走 `PAGES[page].mode === "parent"` 这条判断，否则新页面会绕开 PIN。被拦下时 `mode` 仍为 `kid`。
10. **验证口径（M3 当轮；M4 已提升到 121 项，见第 15 条）**：`npm run verify` = **111/111 单测 + 构建成功**；真实 Chromium 430×932 已跑通任务书要求的三条闭环（PIN 拦截 / 导出导入恢复 / 固定任务次日生成），控制台零错误。当轮 `docs/screens/` 36 张。**Safari、iOS 真机、离线、安全区实测仍未验**，不得表述为"全端通过"。
11. **安装按钮在开发地址下不出现不是 bug**：Service Worker 只在 `import.meta.env.PROD`（生产构建）注册，localhost 下 Chrome 不触发 `beforeinstallprompt`，`installState().canPrompt` 为 false。此时设置页显示「看安装步骤」按钮（弹层给电脑 Chrome/Edge、安卓 Chrome、iPhone Safari 三套做法），**不要把它当成"安装功能没开发"**；要验证真正的一键安装，用 `npm run build && npm run preview` 或部署到 HTTPS。说明文字里的强调色不加蓝，避免看起来像可点链接。
12. **恢复码是"最后一把钥匙"，改它之前先读 `tech/contract.md` §7.1**：①`hashPin` 被 PIN 与恢复码共用，靠 `recovery:` 前缀做域分离，别把前缀去掉；②`setParentPin` 只在"这台设备还没有恢复码"时生成并返回，**已有码时改 PIN 不轮换**（`recoveryCode: null`），别顺手改成每次都换——家长纸上那串会瞬间失效；③恢复码字符集剔掉了 `0 O 1 I L`，改字符集会让已发出去的码全部作废，属于破坏性变更。
13. **删除数据只有 `wipeAllData` 一个入口，且必须整笔事务**：先 `clear` 14 张表再重写 `_meta`（`schemaVersion` / `createdAt` / `restoreState: complete`），最后清 `localStorage` 快照。**不要**在页面里直接 `db.delete()`、不要逐表删、不要忘了 `restoreState`——BK12/BK13 就是为这两件事写的。删除后由 `boot()` 重新种子，不要在清空函数里顺手造"朵朵"。
14. **PWA 封版口径**：`manifest` 的 `theme_color` / `background_color` 必须与页面一致（`#FF8A3D` / `#FFF8F0`）；SW 里所有 `cache.put` 必须挂 `event.waitUntil`，否则 SW 被回收时缓存会静默丢；`localhost` 下不出现一键安装按钮是**预期行为**（见上一条），验证真安装要用 `npm run preview` 或 HTTPS。
15. **验证口径（M4）**：`npm run verify` = **121/121 单测 + 构建成功**；真实 Chromium 430×932 已跑通任务书的两条闭环（恢复码重置 PIN / 彻底删除数据），控制台零错误。`docs/screens/` 44 张为当前视觉基线。**iOS Safari、安卓真机、离线冷启动、Lighthouse 仍未实测**，`docs/DEPLOY.md` §10 是内测清单，不得把"清单写了"当成"已经验过"。

**本轮（DEV-B002-014）新增必读（M5 当前事实源）**：

1. **兑换的"一个"单位变了**：从"一条申请"变成"一批（`batchId`）"。读 `tech/contract.md` §8 再动兑换相关代码；`redemptions` 的 `batchId` **没有索引**，分组在内存做（`row.batchId ?? row.id`，老数据兜底）。
2. **扣分入口是两个，不是一个**：单件 `acceptRedemption`（M2 兼容）与 `acceptRedemptionBatch`（M5 主路径）。**页面里禁止循环调用单件版本来"模拟批量"**——那不是同一个事务，会出现"三件里扣了两件"的半成功。
3. **余额校验按合计**：`requestRedemptions` 用 `ΣcostSnapshot` 比余额，`acceptRedemptionBatch` 同理。单件都买得起但加起来不够时，必须在孩子端挡回，不能生成半批申请。
4. **未勾选的件必须同事务退回**：这不是 UI 优化而是不变式——留一条 pending，孩子就再也发不出新一批（服务层"同孩子最多一批"会把新提交直接拒掉）。M5-RD5 守着这条。
5. **底部汇总条在 `#dock`，不在 `.page` 里**：`.page` 的 `rise-in` 动画让 `transform` 不归零，会成为 `position: fixed` 的包含块，条子会被排到视口外（第一次实测就是这样翻车的）。要加别的固定条也照这个来。
6. **新增带 `display` 的组件记得补 `[hidden]` 规则**，**不要用 `data-balance` 标记非余额数字**（`paintBalance()` 会扫全文档改写）。这两条各踩过一次，见 §8.5。
7. **验证口径（M5）**：`npm run verify` = **130/130 单测 + 构建成功**；真实 Chromium 430×932 跑通「勾 3 件 → 一起提交 → 家长一张卡 → 取消 1 件 → 通过 2 件」，控制台零错误；`docs/screens/` 52 张为当前视觉基线。真机 / 离线仍未验。
8. **PRD 待同步一处**：`PRD_v1.3.md` §6.5 仍写"同一孩子同一时间最多一条 pending"，实现已改为"最多一批（1–6 件）"。**改口径以 `tech/contract.md` §8 为准**，PRD 下一版再同步，不要反向把实现改回一条。


## 八、更新规则

1. 每次任务开始前读本文件，确认当前阶段、正在执行的任务、最近变动。
2. 任务结束时更新：当前阶段、正在执行的任务、最近完成的变动、文件现状、待裁决、必读清单。
3. 不删除历史条目，只追加；最近变动保留 10 条，更早的移到“历史变动”子节。
4. 不修改第六节“冻结规则”，除非 Owner 明确解除冻结。
