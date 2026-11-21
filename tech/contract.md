# 技术契约（M3 + M4 + M5，v1.1.0）

> 基线：DEV-B002-013 / **Schema 仍为 v2**，14 张表。M4（恢复码、彻底清空、PWA 封版）同样**没有新增表、字段、索引**——恢复码只是 `settings` 里的 5 个新键，彻底清空是"删行"不是"改结构"。M3 的三项能力（家长 PIN、备份 / 恢复、固定任务模板）也**没有新增结构**，因此**不升 v3、不写迁移脚本**——理由是 `settings`（`settings: "key"` 键值表）与 `taskTemplates`（`id, type, enabled, *childIds`）在 **Schema v1 就已存在并建好索引**，M3 只是开始往这两张预留表里写行。依据见 `src/db/schema.js` 的 `schemaV1` 与 `src/services/settings.service.js` 顶部注释；`tasks.templateId` / `tasks.generationKey` 也早就在 v1 的 `tasks` 里。老库（v1 或 v2）直接可用，**不需要任何升级动作**。
> `design/` 冻结为 v1.0，不一致时修订本契约，不修改设计文件。
> M1 能力：退回（`rejectTask`）、多孩（`createChild` / `listChildren`）、布置任务（`createTask`）、逾期与未来查询、连续天数（`getCurrentStreak`）。
> M2 能力：奖励配置（6 生活 + 5 装扮内置模板、家庭改价、启停、自定义生活奖励）、兑换申请与家长审核（含余额校验与幂等扣分）、宠物装扮收藏与穿戴 / 卸下。实现与建议的差异见 §5.6。
> **M3 新增能力**：家长 PIN 门控（会话级）、全量备份导出 / 严格校验 / 单事务原子恢复 / 撤销上次导入、固定任务模板（每日 / 每周几）与启动自动补齐。服务见 §2.4–§2.7，备份文件格式见 §6.1，测试映射见 §6.5。
> **M4 新增能力**：PIN 恢复码（忘记 PIN 可自助重置，旧码即时作废）、彻底删除全部家庭数据（G-05，单事务 + 重验 PIN + 勾选确认）、PWA 封版（manifest 补全、iOS 安全区 / 双击缩放、SW 缓存修正）与《本地部署与真机测试指南》。服务见 §2.5 / §2.6 的 M4 标注，实施结果与测试映射见 §7。
> **M5 新增能力**：兑换多选一起提交（一批 N 件、家长一张卡一次确认、可逐件勾选）。`redemptions` 只加一个无索引的 `batchId`，**Schema 仍为 v2、无迁移**。服务见 §2.2 的 M5 标注，语义变更与实测见 §8。
> 迁移纪律：v1 → v2 由 `src/db/migrations.js` 的 `upgradeToV2` 完成，**只加不删、不重建、不删库**；`tests/migration.v2.test.js` 用真实 v1 旧库逐表比对验证无损。**M3 不新增 `UPGRADES[n]`**；恢复 v1 备份时复用 `upgradeToV2(tx)` 在同一个事务里补字段。

## 1. 表字段表

“必填”指 M0 写入路径必须提供；“可选”表示按场景写入，未使用时不得用空字符串、null 或 undefined 代替本应省略的键。

### children

索引：主键 `id`；普通索引 `createdAt`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| nickname | string | 必填 | 孩子昵称 |
| avatarKey | string | 必填 | 头像键 |
| hasChildPin | boolean | 必填 | M0 固定 false |
| childPinHash | string | 可选 | M0 不写 |
| childPinSalt | string | 可选 | M0 不写 |
| createdAt | ISO string | 必填 | 创建时间；索引 |

### taskTemplates（v1 已存在，M3 起真正写入）

索引：主键 `id`；普通索引 `type`、`enabled`；多值索引 `*childIds`。一个模板可以同时派给多个孩子（`childIds` 多值索引支持 `where("childIds").equals(childId)`）。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键，`tpl_*` |
| title | string | 必填 | 任务名，trim 后 1–20 字（`TEMPLATE_TITLE_MAX_LENGTH`） |
| points | integer | 必填 | 1–50（`TEMPLATE_POINTS_MAX`），生成任务时为 `tasks.points` |
| type | "daily" \| "weekly" | 必填 | `daily` = 每天都生成；`weekly` = 只在 `weekdays` 命中的星期生成；索引 |
| childIds | string[] | 必填 | 至少一个孩子；多值索引，生成时逐个孩子派任务 |
| weekdays | number[] | 条件必填 | **仅 `weekly` 写**（0=周日 … 6=周六，与 `Date.getDay()` 同口径）；`daily` **不写该属性** |
| enabled | boolean | 必填 | 索引；停用只影响后续生成，**不删除已生成的任务** |
| createdAt | ISO string | 必填 | 创建时间 |
| updatedAt | ISO string | 必填 | 最近启用 / 停用时间 |

### tasks

索引：主键 `id`；普通索引 `childId`、`status`、`type`、`dueDate`、`templateId`；唯一索引 `generationKey`；复合索引 `[childId+dueDate]`、`[childId+status]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| childId | string | 必填 | 所属孩子；索引 |
| title | string | 必填 | 任务名 |
| points | integer ≥ 0 | 必填 | 通过后发放积分 |
| type | "daily" \| "weekly" \| "temp" | 必填 | Seed 与家长手填用 `temp`；由固定任务模板生成时写模板的 `daily` / `weekly` |
| status | "todo" \| "submitted" \| "approved" \| "revision" | 必填 | 四状态；索引 |
| dueDate | YYYY-MM-DD string | 必填 | 本地自然日；索引 |
| templateId | string | 条件必填 | **M3 起：模板生成的任务必写**，指向 `taskTemplates.id`；手填临时任务不写。模板被删后允许悬空（历史任务不回收） |
| generationKey | string | 条件必填 | 模板生成的任务必填且**全局唯一**，格式见 §3；临时任务不写属性 |
| submittedAt | ISO string | 可选 | 提交时写入 |
| approvedAt | ISO string | 可选 | 通过时写入 |
| approvalDate | YYYY-MM-DD string | 可选 | 实际通过日期 |
| revisionReason | string | 可选 | 退回原因；退回时写入，重提时删除该键 |
| returnCount | integer ≥ 0 | 可选 | 被退回次数；每次退回 +1，首次退回前不存在 |
| createdAt | ISO string | 必填 | 创建时间 |

### submissions

索引：主键 `id`；普通索引 `taskId`、`childId`、`status`；复合索引 `[childId+submittedAt]`、`[taskId+version]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| taskId | string | 必填 | 任务 ID；索引 |
| childId | string | 必填 | 孩子 ID；索引 |
| submittedAt | ISO string | 必填 | 提交时间；复合索引 |
| version | integer ≥ 1 | 必填 | 同一任务递增；复合索引 |
| status | "submitted" | 必填 | M0 提交记录状态；索引 |
| contentType | "text" | 必填 | M0 只允许文字 |
| content | string | 必填 | 非空文字正文 |
| attachmentIds | string[] | 可选 | 仅预留，M0 不写、不实现附件 |

### reviews

索引：主键 `id`；普通索引 `taskId`、`childId`、`result`；唯一索引 `eventKey`；复合索引 `[childId+reviewedAt]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| taskId | string | 必填 | 任务 ID；索引 |
| childId | string | 必填 | 孩子 ID；索引 |
| result | "approved" \| "revision" | 必填 | 审核结果；索引 |
| reason | string \| null | 可选 | 通过记录现有实现写 null |
| reviewedAt | ISO string | 必填 | 审核时间；复合索引 |
| approvalDate | YYYY-MM-DD string | 条件必填 | 通过时写实际审核日期 |
| eventKey | string | 条件必填 | 通过写 `approval:${taskId}`；退回不写属性 |
| reviewer | string | 必填 | 审核人，M0 默认 parent |

### pointLedger

索引：主键 `id`；普通索引 `childId`、`source`、`taskId`；唯一索引 `eventKey`；复合索引 `[childId+createdAt]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| childId | string | 必填 | 孩子 ID；索引 |
| delta | integer | 必填 | 正加负减，余额由本表求和派生 |
| reason | string | 必填 | 流水原因 |
| source | "task" \| "redeem" \| "manual" | 必填 | 来源；索引 |
| taskId | string | 条件必填 | 任务奖励写入；索引 |
| redemptionId | string | 条件必填 | **M2 起兑换扣分写入**；任务奖励与手动调分不写该属性 |
| eventKey | string | 必填 | 任务奖励 `approval:${taskId}`、兑换扣分 `redemption:${redemptionId}`，全局唯一 |
| approvalDate | YYYY-MM-DD string | 条件必填 | 仅任务奖励写实际审核日期；**兑换扣分不写**（兑换不算当天学习完成） |
| createdAt | ISO string | 必填 | 流水时间；复合索引 |
| actor | string | 可选 | 手动调整时写入，M0 闭环不使用 |

### petProgress

索引：主键 `id`；普通索引 `childId`、`taskId`；唯一索引 `eventKey`；复合索引 `[childId+createdAt]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| childId | string | 必填 | 孩子 ID；索引 |
| delta | integer ≥ 0 | 必填 | 经验增量，独立于积分 |
| taskId | string | 必填 | 来源任务；索引 |
| eventKey | string | 必填 | 任务奖励与审核同键，唯一 |
| approvalDate | YYYY-MM-DD string | 必填 | 实际审核日期 |
| createdAt | ISO string | 必填 | 流水时间；复合索引 |

### streaks

索引：主键 `id`；普通索引 `childId`、`date`；唯一复合索引 `[childId+date]`。查询必须按复合关系，不依赖 id 格式。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键；新建通常为 `${childId}:${date}` |
| childId | string | 必填 | 孩子 ID；索引及复合索引 |
| date | YYYY-MM-DD string | 必填 | 实际审核日期；索引及复合索引 |
| approvedCount | integer ≥ 1 | 必填 | 当天通过数量，不是连续天数 |
| createdAt | ISO string | 必填 | 创建时间 |
| updatedAt | ISO string | 必填 | 最近更新时间 |

### rewards（v2 扩字段）

索引：主键 `id`；唯一索引 `&templateKey`；普通索引 `source`、`category`、`enabled`、`createdAt`。**主键规则：内置 = `rw_${templateKey}`，自定义 = `rw_custom_*`（运行时生成）。**

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| source | "builtin" \| "custom" | 必填 | 来源；索引 |
| templateKey | string | 条件必填 | **仅内置写**（如 `life_play15`、`costume_hat_straw`）；自定义**不写该属性**，不是 `""` / null / undefined |
| category | "life" \| "costume" | 必填 | 分类；索引 |
| name | string | 必填 | 名称，≤ 12 字；内置名称只读 |
| description | string | 可选 | ≤ 20 字 |
| iconKey | string | 必填 | 图标键，取值见 `REWARD_ICON_KEYS` |
| defaultCost | integer ≥ 1 | 条件必填 | 内置的系统建议价，只用于对照；自定义不写 |
| cost | integer 1–999 | 必填 | **本家庭当前价**，新申请按它写 `costSnapshot` |
| enabled | boolean | 必填 | 索引；停用只阻止新申请，不删除历史 |
| costumeKey | string | 条件必填 | 装扮类必填，取值见 `COSTUME_CATALOG`；生活类不写 |
| createdAt | ISO string | 必填 | 创建时间；索引 |
| updatedAt | ISO string | 条件必填 | 改价 / 启停时写入 |

### redemptions（v2 扩快照字段）

索引：主键 `id`；普通索引 `childId`、`rewardId`、`status`、`requestedAt`；复合索引 `[childId+status]`、`[childId+requestedAt]`、`[status+requestedAt]`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| childId | string | 必填 | 申请人；索引 |
| rewardId | string | 必填 | 奖励 ID；索引 |
| status | "pending" \| "accepted" \| "rejected" | 必填 | accepted / rejected 均为终态；索引 |
| rewardNameSnapshot | string | 必填 | 申请时的奖励名快照 |
| costSnapshot | integer ≥ 0 | 必填 | **申请时的家庭价快照，确认扣分只认它** |
| categorySnapshot | "life" \| "costume" | 必填 | 申请时分类快照 |
| costumeKeySnapshot | string | 条件必填 | 装扮类必填 |
| assetKeySnapshot | string | 条件必填 | 装扮类必填，等于 `costumeKeySnapshot` |
| requestedAt | ISO string | 必填 | 申请时间；索引 |
| batchId | string | 条件必填（M5 起） | 一次提交共用的批次号，`bat_` 前缀；**无索引**（按 `status` 取当天 pending 后在内存按批次分组，家庭数据量下不需要索引）。M2 老数据没有此键，读时按"自身 `id` 当批次号"兼容 |
| handledAt | ISO string | 条件必填 | 通过 / 拒绝时间；pending 时不写 |
| parentMessage | string | 可选 | 拒绝留言，≤ 40 字；为空时**删除该键** |

### petCostumeOwnerships（v2 新表）

索引：主键 `id`；普通索引 `childId`、`costumeKey`、`acquiredAt`；唯一复合索引 `&[childId+costumeKey]`；唯一索引 `&sourceRedemptionId`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| id | string | 必填 | 主键 |
| childId | string | 必填 | 归属孩子；索引 |
| costumeKey | string | 必填 | 装扮键；索引 |
| sourceRedemptionId | string | 必填 | 来源申请；唯一，防同一申请重复到账 |
| acquiredAt | ISO string | 必填 | 到账时间（等于确认时刻） |

### petCostumeStates（v2 新表）

索引：主键 `childId`；普通索引 `updatedAt`。**每个孩子一条记录**。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| childId | string | 必填 | 主键 |
| hat | string | 可选 | 当前帽子 costumeKey；未穿戴**省略属性** |
| glasses | string | 可选 | 当前眼镜 costumeKey；同上 |
| scarf | string | 可选 | 当前围巾 costumeKey；同上 |
| outfit | string | 可选 | 当前服饰 costumeKey；同上 |
| background | string | 可选 | 当前背景 costumeKey；同上 |
| updatedAt | ISO string | 必填 | 最近穿戴 / 卸下时间；索引 |

### settings（v1 已存在，M3 起真正写入）

索引：主键 `key`。纯键值表，**没有固定字段**，一条键一行。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| key | string | 必填 | 主键；已使用的键见下表，新键必须先登记到 `SETTING_KEYS` |
| value | string \| number \| null | 必填 | 值；**不存明文 PIN**，只存盐与摘要 |
| updatedAt | ISO string | 必填 | 写入时间 |

M3 已使用的键（`src/services/settings.service.js` 的 `SETTING_KEYS`）：

| 键 | 值 | 写入方 | 说明 |
|---|---|---|---|
| `parentPinHash` | string（32 位十六进制） | `setParentPin` | PIN 摘要；**永不存明文** |
| `parentPinSalt` | string | `setParentPin` | 每个家庭随机盐 |
| `parentPinUpdatedAt` | ISO string | `setParentPin` | 最近设置 / 修改时间 |
| `parentPinFailedCount` | number | `checkParentPin` | 连续错误次数，成功即删该键 |
| `parentPinLockedUntil` | ISO string | `checkParentPin` | 连错 5 次后的锁定截止时间 |
| `parentPinRecoveryHash` | string（32 位十六进制） | `setParentPin` / `resetParentPinWithRecovery` / `issueRecoveryCode` | **M4**：恢复码摘要（带 `recovery:` 域前缀），永不存明文 |
| `parentPinRecoverySalt` | string | 同上 | **M4**：恢复码独立盐（与 PIN 的盐分开） |
| `parentPinRecoveryUpdatedAt` | ISO string | 同上 | **M4**：恢复码生成时间 |
| `parentPinRecoveryFailedCount` | number | `verifyRecoveryCode` | **M4**：恢复码连错次数，与 PIN 的计数**分开记** |
| `parentPinRecoveryLockedUntil` | ISO string | `verifyRecoveryCode` | **M4**：恢复码连错 5 次的锁定截止时间 |
| `lastBackupAt` | ISO string | `exportBackup` | 最近一次导出时间 |
| `lastBackupFileName` | string | `exportBackup` | 最近一次导出的文件名 |
| `lastBackupVersion` | number | `exportBackup` | 导出时的 Schema 版本 |

纪律：读不到就是"未配置"，**不补默认值、不造空行**；`clearParentPin` 会把这 **10 个** PIN / 恢复码键全部删除（关掉门就要把钥匙一起扔掉）；导入备份时 **PIN 与恢复码都以本机为准**（见 §2.6 `restoreBackup`）。彻底清空时 `settings` 整表清空（§2.6 `wipeAllData`）。

### _meta

索引：主键 `key`。

| 字段 | 类型 | 必填/可选 | 说明 |
|---|---|---|---|
| key | "schemaVersion" \| "createdAt" \| "restoreState" \| "lastRestoreAt" | 必填 | 元数据键；**升级后 `schemaVersion` 必须同步改写为 2**；`lastRestoreAt` 由 M3 的 `restoreBackup` 首次写入 |
| value | number \| string | 必填 | 版本号、ISO 时间或 complete/restoring |
| updatedAt | ISO string | 必填 | 更新时间 |

## 2. 服务函数签名

### createTask(input)

- 入参：`{ childId: string, title: string, points: integer ≥ 0, dueDate?: YYYY-MM-DD }`；dueDate 缺省为设备本地今天。
- 返回：写入后的完整 task；id 自动生成，type=`temp`，status=`todo`，不写 templateId/generationKey。
- 错误：入参非法、**孩子不存在**或 dueDate 不是真实日期时抛 `DbError(DB_VALIDATION_FAILED)`；写库失败抛对应 `DbError`。
- 事务：`children`（只读校验）+ `tasks`（写入）同一读写事务，不留孤立 task。
- 幂等：无调用级幂等键；每次合法调用生成新 id，调用方必须防止重复点击。

### listOverdueTasks(childId)

- 入参：非空 childId。
- 返回：`dueDate < 本地今天` 且 `status !== approved` 的任务数组，按 dueDate、createdAt 正序。
- 错误：非法 childId 抛 `DbError(DB_VALIDATION_FAILED)`。
- 事务：只读 `[childId+dueDate]` 范围查询；**取全量，不 limit**，折叠在渲染层。
- 幂等：只读。

### listUpcomingTasks(childId, { days = 7 })

- 入参：非空 childId；days 为正整数。
- 返回：`dueDate` 在**明天 ~ 今天+days** 之间的任务，按 dueDate、createdAt 正序；不含今天。
- 错误/事务/幂等：同 `listOverdueTasks`。每日查询，不做跨表聚合。

### listTodayTasks(childId)

- 入参：非空 childId。
- 返回：该孩子 dueDate 为本地今天的 task 数组，按 createdAt、id 正序；无数据返回 `[]`。
- 错误：非法 childId 抛 `DbError(DB_VALIDATION_FAILED)`；读取失败抛对应 `DbError`。
- 事务：只读 `[childId+dueDate]` 查询，无写事务。
- 幂等：只读，不改变数据。

### submitTask({ taskId, childId, contentType, content })

- 入参：taskId/childId 为非空字符串；contentType 只能为 `text`；content 为非空文字。
- 返回：`{ status: "submitted", taskId, submissionId, version, submittedAt }`。
- 错误：任务不存在、归属不符、状态不是 todo/revision 或内容非法时抛 `DbError(DB_VALIDATION_FAILED)`；写库失败抛对应 `DbError`。
- 事务：同一读写事务更新 tasks、新增 submissions；version 为该任务既有提交数 + 1。
- 修订：重提时**删除 `revisionReason` 键**（原因历史保留在 reviews），任务记录只表示"当前是否还有待处理的修改意见"。
- 幂等：无独立幂等键；首次成功后任务进入 submitted，重复调用被状态校验拒绝，不重复新增提交。

### approveTask({ taskId, reviewerId })

- 入参：taskId 非空；reviewerId 缺省为 `parent`。保留现有可选参数 `now`、`expPerPoint`、`db`；旧参数 `reviewer` 作为 reviewerId 的兼容别名。
- 返回：成功为 `{ status: "approved", taskId, childId, approvalDate, approvedAt, points, exp, eventKey, reviewId, ledgerId, petId, streakId }`；重复请求返回 status=`duplicate`，历史任务已通过返回 status=`already-approved`。
- 错误：任务不存在、不是 submitted、积分或日期参数非法时抛 `DbError(DB_VALIDATION_FAILED)`；写库失败抛对应 `DbError`。
- 事务：tasks/reviews/pointLedger/petProgress/streaks 五表同一读写事务，任一步失败全部回滚。
- 幂等：以 `approval:${taskId}` 检查 reviews；重复审核不重复写审核、积分、经验或 streak。

### getBalance(childId)

- 入参：非空 childId；保留现有可选第二参 `db` 供隔离测试。
- 返回：`{ childId, balance, entryCount }`；balance 为该孩子全部 pointLedger.delta 之和。
- 错误：非法 childId 抛 `DbError(DB_VALIDATION_FAILED)`；读取失败抛底层数据库错误。
- 事务：只读流水，无写事务；没有可写余额字段。
- 幂等：只读，不改变数据。

### rejectTask({ taskId, reason?, reviewerId? })

- 入参：taskId 非空；reason 可为空字符串，trim 后最多 **60 字**；reviewerId 缺省 `parent`。保留可选 `now`、`db`。
- 返回：`{ status: "revision", taskId, childId, revisionReason, returnCount, reviewId, reviewedAt }`。
- 错误：任务不存在 / 不是 submitted / 已通过 / 原因超长时抛 `DbError(DB_VALIDATION_FAILED)`。
- 事务：`tasks` + `reviews` 同一读写事务，任一步失败整体回滚。
- 数据纪律：
  - `reviews` 记录 `result="revision"`，**不写 `eventKey` 属性**（不是 `""`、`null`、`undefined`），也不写 `approvalDate`；
  - 任务 `status → revision`、`returnCount+1`；原因非空写 `revisionReason`，为空则删除该键；
  - **不发积分、不发经验、不改 streaks**。
- 幂等：无幂等键；首次退回后状态变为 revision，再次退回被状态校验拒绝。

### listChildren()

- 入参：无（可注入 db）。
- 返回：全部孩子，按 createdAt、id 正序；空库返回 `[]`。
- 事务：只读 `children`。

### getChild(childId)

- 入参：非空 childId。
- 返回：孩子记录；不存在返回 `null`（由界面决定空态，不抛错）。
- 错误：非法 childId 抛 `DbError(DB_VALIDATION_FAILED)`。
- 事务：只读单条。

### createChild({ nickname, avatarKey })

- 入参：nickname 非空、trim 后 ≤ 12 字；avatarKey 必须是 `cat|rabbit|bear|fox|panda|owl|dino|whale` 之一。
- 返回：写入后的孩子记录 `{ id, nickname, avatarKey, hasChildPin: false, createdAt }`。
- 错误：非法入参抛 `DbError(DB_VALIDATION_FAILED)`。
- 事务：单表写入，无跨表事务。
- 幂等：无幂等键；每次创建新 id，UI 必须防重复点击。
- 兼容：**不新增字段、不升 Schema 版本**，旧库中的 `c_m0` 原样保留。

### getCurrentStreak(childId, { now? })

- 入参：非空 childId；now 缺省当前时间。
- 返回：`{ childId, days, lastDate, countedToday }`，只读 `streaks`。
- 口径（Q-02 建议值，抽在 `STREAK_RULE`）：今天有通过从今天往前数；今天没有、昨天有则从昨天往前数；最后通过 ≤ 前天归零。`approvedCount = 0` 的记录不算一天。
- 事务/幂等：只读，不写任何表。

### ensureSeedData()

- 入参：无。
- 返回：`{ childId: "c_m0", addedChild: boolean, addedTasks: integer, taskCount: integer }`。
- 错误：Seed 写入失败抛对应 `DbError`，界面进入错误态，不删库重建。
- 事务：children/tasks 同一读写事务；固定写入一个孩子 `c_m0` 和五条固定 id 的 temp 任务，dueDate 为本地今天。
- 幂等：按固定主键只补缺失记录，不覆盖已有孩子、任务状态或历史；重复调用返回 addedTasks=0（记录齐全时）。
- 多孩：只补种 `c_m0`，**不创建、不修改其他孩子**，也不给新孩子自动派任务。

### 2.1 M2 新增服务（`src/services/reward.service.js`）

常量：`REWARD_SOURCE`（builtin / custom）、`REWARD_CATEGORY`（life / costume）、`BUILTIN_REWARD_TEMPLATES`（11 个：6 生活 `life_play15 20 / life_cartoon 30 / life_park 50 / life_gift 60 / life_book 80 / life_family 100`，5 装扮 `costume_hat_straw 20 / costume_glasses_round 25 / costume_scarf_knit 30 / costume_outfit_vest 40 / costume_bg_starry 50`）、`REWARD_ICON_KEYS`（14 个图标键）、名称 ≤ 12 字、说明 ≤ 20 字、积分 1–999。

#### ensureBuiltinRewardConfigs(db?)

- 入参：可注入 db（默认 `getDb()`）。
- 返回：`{ added: integer, total: integer }`。
- 行为：按 `templateKey` 查（兜底按 `rw_${templateKey}` 主键查），**缺失才写**；已有记录一个字段都不改。
- 事务：`rewards` 单表读写事务；启动时（`store.boot()`）调用一次，重复调用 `added=0`。
- 幂等：以 `templateKey` 唯一索引保证不重复；**家长改过的 cost / enabled 永不被覆盖**。

#### listRewards({ category?, enabledOnly = false, db? })

- 返回：奖励数组，内置在前、自定义在后；同类内置按模板顺序。
- 事务/幂等：只读。

#### getReward(rewardId, db?)

- 返回：奖励记录或 `null`（不存在不抛错，由界面决定空态）。

#### createCustomReward({ name, cost, description = "", iconKey = "sparkle", db? })

- 返回：写入后的奖励记录；`source=custom`、`category=life`、`enabled=true`、主键 `rw_*` 运行时生成。
- 错误：名称 / 说明 / 积分非法抛 `DbError(DB_VALIDATION_FAILED)`。
- 数据纪律：**不写 `templateKey`、不写 `costumeKey` 属性**（空字符串是合法索引键值，会与第二条自定义奖励撞唯一索引）。
- 幂等：无幂等键；UI 必须防重复点击。

#### updateReward({ rewardId, cost, name?, description?, iconKey?, db? })

- 返回：更新后的记录，并写 `updatedAt`。
- 内置（`source=builtin`）：**只允许改 `cost`**，传 `name` / `description` / `iconKey` 抛 `DbError(DB_VALIDATION_FAILED)`。
- 自定义：可改名称、说明、图标、积分。
- 影响范围：只影响后续新展示与新申请的 `costSnapshot`，**不回溯已提交的申请**。

#### setRewardEnabled({ rewardId, enabled, db? })

- 返回：更新后的记录。
- 行为：只写 `enabled` 与 `updatedAt`；停用不删除奖励、不删除历史申请、不删除装扮收藏；**已有 pending 仍可审核通过**。

### 2.2 M2 新增服务（`src/services/redemption.service.js`）

常量：`REDEMPTION_STATUS`（pending / accepted / rejected）、`REDEMPTION_RESULT`（accepted / rejected / duplicate）、`PARENT_MESSAGE_MAX_LENGTH = 40`、`redemptionEventKey(id)` → `redemption:${id}`；M5 追加 `MAX_BATCH_ITEMS = 6`、`makeRedemptionBatchId()` → `bat_…`。

#### requestRedemption({ childId, rewardId, now?, db? })

- 返回：写入后的 `redemptions` 记录（`status=pending`，含 5 个快照字段）。
- 错误（均抛 `DbError(DB_VALIDATION_FAILED)`）：孩子不存在、奖励不存在、奖励已停用、**该孩子已有一条 pending**、**星星不够（`balance < cost`）**、装扮已拥有、快照异常。
- 事务：`children` + `rewards` + `redemptions` + `petCostumeOwnerships` + `pointLedger`（读余额）同一读写事务。
- 关键纪律：**不写流水、不冻结积分、不扣分**；**星星不够就不生成申请**——`requestRedemption` 在事务内重算余额，`balance < reward.cost` 直接抛错（`message = 还差 N 颗星星…`，`context.shortage` 带差额），孩子端读到就提示、不写 pending，也不占用"同时一条 pending"的名额。家长审核侧的余额校验仍然保留，作为"申请之后星星被花掉"的兜底。
- 幂等：靠"同孩子最多一条 pending"的状态校验 + 事务内复查防重；不依赖按钮禁用。

#### acceptRedemption({ redemptionId, now?, db? })

- 返回：`{ status: "accepted", redemptionId, childId, rewardName, cost, balanceBefore, balanceAfter, ledgerId, eventKey, ownershipId, costumeKey, handledAt }`；重复确认返回 `status="duplicate"`（含原 `handledAt`），**零写入**。
- 错误：申请不存在、已 rejected、已非 pending、**余额不足**、`costSnapshot` 异常 → `DbError(DB_VALIDATION_FAILED)`，整笔回滚零写入。
- 事务：`redemptions` + `pointLedger` + `petCostumeOwnerships` 同一读写事务，顺序为：
  1. 按 `eventKey=redemption:${id}` 查 `pointLedger`，命中即返回 duplicate；
  2. 复查 `status === pending`；
  3. 重新汇总该孩子全部 `pointLedger.delta` 得余额，与 `costSnapshot` 比较，不足即抛错；
  4. 写负向流水：`delta = -costSnapshot`、`source="redeem"`、`redemptionId`、`eventKey`、`createdAt`，**不写 `approvalDate`、不写 `taskId`**；
  5. 申请置 `accepted` + `handledAt`；
  6. 装扮类在同一事务写 `petCostumeOwnerships`（`sourceRedemptionId` 唯一；已拥有则不重写收藏，但这次扣分依然成立）。
- 幂等：`redemption:${redemptionId}` 唯一事件键 + 事务内前置查重 + `ConstraintError` 兜底（并发下另一个事务先写入时按 duplicate 返回）。

#### rejectRedemption({ redemptionId, parentMessage = "", now?, db? })

- 返回：`{ status: "rejected", redemptionId, childId, rewardName, parentMessage, handledAt }`；重复拒绝返回 `status="duplicate"`。
- 错误：申请不存在、已 accepted、留言 > 40 字 → `DbError(DB_VALIDATION_FAILED)`。
- 事务：`redemptions` + `pointLedger` 同一读写事务（只写 `redemptions`，`pointLedger` 保持零写入）。
- 纪律：**只改状态，不扣分、不发装扮、不写流水**；`parentMessage` 为空时**删除该键**（不写 `""`）。

#### listRedemptionRequests({ status = "pending", db? })

- 返回：`status` 对应的申请数组（按 `requestedAt` 正序），每项附带 `child`（孩子档案或 null）与 `balance`（该孩子**当前**流水余额）。
- 事务/幂等：只读。`balance` 仅供展示与"是否够扣"提示，真正校验在 `acceptRedemption` 事务内。

#### listRedemptionsByChild(childId, db?)

- 返回：该孩子申请历史，按 `requestedAt` **倒序**（`[childId+requestedAt]` 反向区间查询）。
- 事务/幂等：只读。

#### requestRedemptions({ childId, rewardIds, now?, db? })（M5）

- 返回：`{ batchId, childId, requestedAt, totalCost, balance, records }`，`records` 是同一批次的多条 pending 行（每件一条，各自快照与 `eventKey`）。
- 入参：`rewardIds` 先去空、去重（同一件重复传只算一次）；空数组或超过 `MAX_BATCH_ITEMS = 6` 直接抛错。
- 错误：孩子不存在、奖励不存在 / 停用、`cost` 异常、**该孩子已有一批 pending**、装扮已拥有或同批重复、**合计不够（`balance < ΣcostSnapshot`）** → 全部 `DbError(DB_VALIDATION_FAILED)`，整批零写入。
- 事务：`children` + `rewards` + `redemptions` + `petCostumeOwnerships` + `pointLedger`（读余额）同一读写事务；`bulkAdd` 一次落库。
- 纪律：**合计校验，不是逐件校验**——单件都买得起但加起来不够，也要整批挡回（`context.shortage = totalCost - balance`），不生成半批申请。
- 幂等：靠"同孩子最多一批 pending"的状态校验 + 事务内复查；不依赖按钮禁用。

#### requestRedemption({ childId, rewardId, now?, db? })

- M2 兼容入口：等价于 `requestRedemptions({ rewardIds: [rewardId] })` 后取 `records[0]`，返回值形状不变。

#### acceptRedemptionBatch({ batchId, acceptedIds?, parentMessage?, now?, db? }）（M5）

- 返回：`{ status: "accepted", batchId, childId, accepted: [{ id, rewardName, cost, ledgerId, ownershipId, costumeKey }], rejected: [{ id, rewardName }], totalCost, balanceBefore, balanceAfter, handledAt }`；整批都处理过时返回 `status="duplicate"`（`accepted: []`，零写入）。
- 入参：`acceptedIds` 省略 = 通过该批全部 pending；给了 `[]` 直接抛错（"至少勾一件再通过"）。
- 事务：`redemptions` + `pointLedger` + `petCostumeOwnerships` 同一读写事务，顺序为：
  1. 取该批全部行（`row.batchId ?? row.id === batchId`，兼容 M2 老数据）；没有 pending 时按 duplicate / 已退回分别处理；
  2. `acceptedIds` 给了就拆成"通过 / 退回"两组；
  3. 按通过件的 `costSnapshot` **合计**与余额比较，不足即抛错，整批零写入；
  4. 逐件：幂等查 `eventKey` → 写负向流水 → 置 accepted；
  5. 装扮件逐件写 `petCostumeOwnerships`；
  6. 未勾选的件在**同一事务**置 rejected（写 `parentMessage`、`handledAt`），**绝不留悬挂 pending**。
- 纪律：`balanceAfter` 只减一次合计；重复确认不会重复扣分（逐件 `eventKey` 兜底）。

#### rejectRedemptionBatch({ batchId, parentMessage?, now?, db? }）（M5）

- 返回：`{ status: "rejected", batchId, childId, rejected: [...], parentMessage, handledAt }`；没有 pending 时返回 `duplicate`（已是 rejected）或抛错（已 accepted）。
- 事务：只写 `redemptions`；**不扣分、不发装扮、不写流水**。

### 2.3 M2 新增服务（`src/services/costume.service.js`）

常量：`COSTUME_SLOT`（hat / glasses / scarf / outfit / background）、`COSTUME_SLOTS`（固定顺序数组）、`COSTUME_SLOT_LABEL`、`COSTUME_CATALOG`（代码内只读目录，5 件，含 `costumeKey / slot / name / description / assetKey / defaultCost`）、`COSTUME_KEYS`。**目录不是数据库表，不随备份迁移，家长不上传或编辑素材。**

#### getCostume(costumeKey)

- 返回：目录项或 `null`；纯函数，不读库。

#### listCostumeCollection(childId, db?)

- 返回：`{ childId, owned, ownedKeys, worn, bySlot }`；`bySlot[slot]` 为该类别下已拥有装扮数组，按目录顺序稳定排序。
- 事务/幂等：只读 `petCostumeOwnerships` + `petCostumeStates`，按 `childId` 隔离。

#### equipCostume({ childId, costumeKey, now?, db? })

- 返回：`{ childId, slot, costumeKey, worn }`。
- 错误：未知装扮、**同孩子未拥有该装扮**、非法 childId → `DbError(DB_VALIDATION_FAILED)`。
- 事务：`petCostumeStates` + `petCostumeOwnerships` 同一读写事务；同类别自动替换，只改该 slot，其它 slot 不动。
- 纪律：**不写 `pointLedger` / `petProgress`**，不改经验、等级、连续记录。

#### unequipCostume({ childId, slot, now?, db? })

- 返回：`{ childId, slot, changed, worn }`。
- 幂等：本来就没穿时 `changed=false`，**不写库**。
- 事务：`petCostumeStates` 单表读写；只删该 slot 属性，不写空字符串。

#### addOwnershipInTransaction(db, { childId, costumeKey, sourceRedemptionId, acquiredAt })

- 内部接口，**只允许 `acceptRedemption` 事务调用**；写一条 `petCostumeOwnerships`，返回记录。

### 2.4 M3 新增服务（`src/services/settings.service.js`）

常量：`SETTING_KEYS`（见 §1 `settings` 键表）。

#### readSetting(key, db?)

- 入参：非空字符串 key。
- 返回：值；**不存在返回 `null`**（不补默认值、不造空行）。
- 错误：非法 key 抛 `DbError(DB_VALIDATION_FAILED)`。
- 事务 / 幂等：只读。

#### readSettings(keys, db?)

- 返回：`{ [key]: value | null }`；底层用 `bulkGet` 一次取回。
- 事务 / 幂等：只读。

#### writeSetting(key, value, { db?, now? } = {})

- 行为：`put` 一行 `{ key, value, updatedAt }`，覆盖同键旧值。
- 事务：`settings` 单表写入（调用方如需多键原子，自己起事务）。

#### deleteSetting(key, db?)

- 行为：删除该键；不存在不报错。
- 纪律：删除即"回到未配置"，不要写 `""` 或 `null` 代替。

### 2.5 M3 / M4 服务（`src/services/pin.service.js`）

常量（M3）：`PIN_LENGTH = 4`、`PIN_MAX_ATTEMPTS = 5`、`PIN_LOCK_MS = 60_000`、`PIN_PATTERN = /^\d{4}$/`、`WEAK_PIN_HINTS`（`0000/1111/1234/4321/0123/2222`，仅界面提示，不强制拦截）。

常量（M4 恢复码）：`RECOVERY_CODE_LENGTH = 8`、`RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"`（去掉 `0 O 1 I L` 等易混字符）、`RECOVERY_MAX_ATTEMPTS = 5`、`RECOVERY_LOCK_MS = 60_000`、`RECOVERY_RAW_PATTERN = /^[A-Z0-9]{8}$/`（归一化后的校验口径）。

#### hashPin(pin, salt)

- 返回：32 位十六进制摘要。512 轮双种子混合（FNV 风格 `Math.imul`），**纯 JS，Node 与浏览器结果一致**。
- 定位：**这不是密码学，也不承担密码学职责**——PIN 只防误触，本地库对同机的人是可读的。真密码学需要 `crypto.subtle`（异步、需 HTTPS），对"防孩子误点"是过度设计。

#### getPinStatus(db?)

- 返回：`{ configured, updatedAt, failedCount, lockedUntil, recoveryConfigured, recoveryUpdatedAt }`（后两项 M4 新增）。
- **不返回哈希与盐**，界面拿不到敏感值，也拿不到恢复码本身（它只在生成时以返回值出现一次）。

#### lockRemainingMs(status, now?)

- 返回：锁定剩余毫秒；未锁定返回 0。纯函数。

#### checkParentPin({ pin } = {}, { db?, now? } = {})

- 返回：`{ allowed, configured, reason: "unset"|"ok"|"mismatch"|"format"|"locked", remainingAttempts?, retryAfterMs? }`。
- **未设置 PIN 时 `allowed: true, reason: "unset"`**（老用户默认不验证，这是产品要求）。
- 失败计数：错误一次 `parentPinFailedCount + 1`；累计 5 次写 `parentPinLockedUntil = now + 60s` 并清零计数；**锁定期内即使输对也拒绝**（`reason: "locked"`）；成功后删除两个计数字键。
- 事务：`settings` 单表读写；计数写入失败**不让"PIN 错误"变成"系统错误"**（try/catch 忽略）。
- 幂等：验证本身无副作用级幂等键；失败计数是刻意累加的。

#### setParentPin({ pin, currentPin } = {}, { db?, now? } = {})

- 返回：`{ configured: true, updatedAt, recoveryCode: string|null, recoveryIssued: boolean }`（后两项 M4 新增）。
- **已配置时必须提供 `currentPin` 且验证通过**，否则抛 `DbError(DB_VALIDATION_FAILED)`（锁定态提示"试错次数太多"）。
- 事务：`settings` 单表读写，一次写 salt / hash / updatedAt 并清空失败计数。
- **M4 恢复码**：若 `recoveryConfigured === false`（首次设置，或 M3 老用户改 PIN），顺手生成一个恢复码并在返回值里交出去（明文只此一次）；已有恢复码时改 PIN **不轮换**，返回 `recoveryCode: null`（改 PIN ≠ 换钥匙，纸上那串继续有效）。
- 纪律：**旧 PIN 只被覆盖，不留历史**；库里永远没有明文。

#### clearParentPin({ currentPin } = {}, { db?, now? } = {})

- 返回：`{ configured: false }`；本来没配置时直接返回，不抛错。
- 必须验证当前 PIN；事务内删除全部 **10 个** PIN / 恢复码键（含失败计数与锁定时间）。

#### generateRecoveryCode() → string（M4，纯函数）

- 返回 8 位大写字母数字，字符集 `RECOVERY_CODE_ALPHABET`；用 `crypto.getRandomValues`，无则退化 `Math.random`。

#### formatRecoveryCode(code) → string（M4，纯函数）

- `A1B2C3D4` → `A1B2-C3D4`；非法输入原样返回。**只影响展示与输入，摘要始终按去掉分隔符后的 8 位算。**

#### normalizeRecoveryCode(input) → string（M4，纯函数）

- 去空格 / 横线（含全角破折号）、转大写；长度不是 8 或含非法字符返回 `""`。

#### hashPin(pin, salt) / 内部 hashRecovery(code, salt)

- 恢复码复用同一个 512 轮混合摘要，但输入加 `recovery:` 域前缀 —— **PIN 与恢复码的摘要不能互相顶替**。

#### verifyRecoveryCode({ recoveryCode } = {}, { db?, now? } = {})（M4）

- 返回：`{ ok, reason: "ok"|"unset"|"no-recovery"|"format"|"mismatch"|"locked", remainingAttempts?, retryAfterMs? }`。
- **只校验、不改 PIN**：给界面做"两步引导"（先验码、再设新 PIN）。
- 失败计数写 `parentPinRecoveryFailedCount`，连错 5 次锁 60 秒（`parentPinRecoveryLockedUntil`）；**与 PIN 的失败计数分开**，避免"猜恢复码"把家长自己的 PIN 输入顶进锁定。
- 成功即清掉恢复码的两个计数字键。

#### resetParentPinWithRecovery({ recoveryCode, pin } = {}, { db?, now? } = {})（M4）

- 返回：`{ configured: true, updatedAt, recoveryCode: string }` —— **新恢复码**（明文，只此一次）。
- 内部先 `verifyRecoveryCode`；失败按原因抛 `DbError(DB_VALIDATION_FAILED)`，`context.reason` 保留 `unset` / `no-recovery` / `format` / `mismatch` / `locked`。
- 事务：一次写入新 PIN 的 salt / hash / updatedAt **与**新恢复码的 salt / hash / updatedAt，同时清空四个计数 / 锁定键 —— 不会出现"PIN 换了但恢复码还是旧的"。
- 纪律：**旧恢复码立刻作废**，旧 PIN 即刻失效。

#### issueRecoveryCode({ db?, now? } = {})（M4）

- 返回：`{ recoveryCode, updatedAt }`，覆盖原恢复码（旧的立刻失效）。
- 用途：M3 时期设置的 PIN 没有恢复码，家长进设置页后补一份；也可主动"换一把钥匙"。
- 前置：必须已配置 PIN，否则抛 `DB_VALIDATION_FAILED`。**调用方必须已处于家长模式**（本函数不再要求输入 PIN）。

### 2.6 M3 新增服务（`src/services/backup.service.js`）

常量：`BACKUP_FORMAT = "b002-family-workbench-backup"`、`BACKUP_FORMAT_VERSION = 1`、`SUPPORTED_FORMAT_VERSIONS = [1]`、`BACKUP_TABLES`（14 张，按依赖顺序）、快照键 `localStorage["b002.preRestoreSnapshot"]`。

#### buildBackup({ db?, now? } = {})

- 返回：`{ format, formatVersion, schemaVersion, appName, exportedAt, counts, data }`，`data` 是 14 张表的全量数组。
- **导出时把 `_meta.restoreState` 统一改写成 `complete`**，不把"半成品标记"带进备份文件。
- 事务 / 幂等：只读。

#### backupFileName(now?)

- 返回：`学习工作台-备份-2026-11-21-1730.json`（本地日期 + 时分）。纯函数。

#### serializeBackup(payload)

- 返回：`JSON.stringify(payload, null, 2)`——缩进 2 空格，家长用记事本能看一眼。

#### exportBackup({ db?, now? } = {})

- 返回：`{ payload, text, fileName, counts, bytes }`。
- 副作用：写 `lastBackupAt` / `lastBackupFileName` / `lastBackupVersion` 三个键（所以"导出后设置表 +3 条"是正常的，写测试取基线要在导出之后）。
- 下载动作在界面层（`ui.downloadText`），服务不碰 DOM。

#### validateBackupPayload(payload)

- 返回：`{ payload, counts, total, schemaVersion, exportedAt, tables }`。
- **纯只读，不改库**。校验项见 §6.2；任何一项不过就抛 `DbError(DB_VALIDATION_FAILED)`，**坏文件绝不进入写入阶段**。

#### parseBackupText(text)

- 先 `JSON.parse` 再走 `validateBackupPayload`；返回同上。
- 错误：不是 JSON、字段缺失、表不全、主键重复、引用悬空 → 统一 `DB_VALIDATION_FAILED` + 中文原因。

#### restoreBackup(input, { db?, now?, skipSnapshot? } = {})

- 入参：备份文本或已解析的 payload。
- 返回：`{ restored: {表: 条数}, total, fromSchemaVersion, migrated, snapshot }`。
- 流程（**全部在一个 `db.transaction("rw", db.tables)` 里**）：
  1. 校验（不通过直接抛，零写入）；
  2. 事务外先存"导入前快照"到 `localStorage`（上限 4MB，失败则中止导入而不是硬着头皮覆盖）；
  3. 记下本机 5 个 PIN 键；
  4. 事务内：14 张表 `clear()` → `bulkAdd()` → `fromSchemaVersion < 2` 时复用 `upgradeToV2(tx)` 补字段 → 改写 `schemaVersion` / `restoreState=complete` / `lastRestoreAt` / 缺则补 `createdAt` → **删掉备份里的 PIN 键再写回本机 PIN**。
- 纪律：**要么全成、要么全回滚**；写一半失败时库保持导入前原样（`tests/backup.service.test.js` BK5 用"写入阶段炸掉"验证 14 张表计数、孩子昵称、余额全不变）。
- 幂等：不是幂等的（覆盖语义），重复导入同一个文件结果一致；防重复点击由界面 `state.busy` 保证。

#### undoLastRestore({ db?, now? } = {})

- 用快照把自己换回去，`skipSnapshot: true`（**快照不套娃**），成功后 `clearPreRestoreSnapshot()`。
- 错误：没有快照 → `DbError(DB_VALIDATION_FAILED)`「没有可以撤销的导入记录」。

#### readPreRestoreSnapshot() / clearPreRestoreSnapshot()

- 同步函数；前者返回 `{ payload, savedAt, total }` 或 `null`，后者清空（内存与 localStorage 双清）。

#### backupOverview({ db? } = {})

- 返回：`{ lastBackupAt, lastBackupFileName, lastBackupVersion, counts, total, canUndo, undoSnapshotAt, undoSnapshotTotal }`。
- 事务 / 幂等：只读；设置页每次进入前调一次。`total` 含 `_meta` 行（清空后为 3）。

#### wipeAllData({ db?, now? } = {})（M4 / G-05）

- 返回：`{ wiped: Record<表名, 清掉的条数>, total, wipedAt }`。
- **单事务**清空 `BACKUP_TABLES`（14 张，含 `settings`），随后**重写 `_meta`**：`schemaVersion = 当前版本`、`createdAt = now`、`restoreState = "complete"`。少了 `restoreState`，下次 `openDatabase()` 的 `ensureMetadata` 会把库判成异常库（`DB_INVALID_STATE`）。
- 与 `restoreBackup` 的区别：**不写入任何数据**，也不生成快照；清完就交给 `boot()` → `ensureSeedData()` 重新种出「朵朵 + 5 条示例任务」。
- 副作用：清掉 `localStorage["b002.preRestoreSnapshot"]`——那也是一整份家庭数据，留着等于"删了还能一键恢复"，与用户点下删除时的预期不符。
- **不碰**任何已下载到硬盘的 JSON 备份文件（服务层没有文件系统权限，这也是产品边界）。
- 失败即整笔回滚；`tests/backup.service.test.js` BK12 用注入式写失败验证"一条也不删"。

### 2.7 M3 新增服务（`src/services/template.service.js`）

常量：`TEMPLATE_TYPE`（daily / weekly）、`TEMPLATE_TYPE_LABEL`、`TEMPLATE_TITLE_MAX_LENGTH = 20`、`TEMPLATE_POINTS_MAX = 50`、`WEEKDAY_OPTIONS`（展示顺序周一→周日，值仍是 `Date.getDay()` 口径 0=周日）。

#### generationKeyOf({ type, childId, templateId, dateKey })

- 返回：`${type}:${childId}:${templateId}:${dateKey}`。纯函数，**这是防重的唯一依据**。

#### describeTemplate(template)

- 返回：中文描述，如「每天」「每周六、周日」。纯函数。

#### createTemplate({ title, points, type?, childIds, weekdays?, now?, db? })

- 返回：写入后的模板记录。
- 错误：标题超长 / 空、积分不在 1–50、`childIds` 为空、`weekly` 没选星期、星期不在 0–6、孩子不存在 → `DbError(DB_VALIDATION_FAILED)`。
- 事务：`children`（只读校验）+ `taskTemplates`（写入）同一事务，不留孤儿模板。
- 纪律：`daily` **不写 `weekdays` 属性**（不是 `[]`）；`weekdays` 去重并按「周一在前、周日在后」排序。
- 幂等：无幂等键；双击会建两个模板，界面需禁用按钮。

#### listTemplates(db?)

- 返回：全部模板（含停用），按 `createdAt`、`id` 正序。

#### setTemplateEnabled({ templateId, enabled, now?, db? })

- 返回：更新后的模板；只写 `enabled` 与 `updatedAt`。
- 纪律：停用**不删除已生成的任务**，只是以后不再生成。

#### deleteTemplate({ templateId, db? })

- 返回：`{ deleted: true, templateId }`。
- 纪律：**只删模板，不删历史任务**；`tasks.templateId` 允许悬空，备份校验把它当软引用（见 §6.2）。

#### generateTemplateTasks({ dateKey?, now?, db? } = {})

- 返回：`{ dateKey, created, skipped, tasks }`。
- 行为：事务内遍历全部启用模板；`weekly` 先比对 `weekdays.includes(weekdayOfDateKey(dateKey))`；对每个 `childIds` 逐个孩子算 `generationKey`，**先 `where("generationKey").equals(key).first()` 查重**，命中即 `skipped++`；`add` 撞 `ConstraintError` 也按"已存在"处理（并发兜底）。
- 事务：`taskTemplates` + `tasks` + `children`（只读）同一读写事务。
- 幂等：**同一个 `dateKey` 反复调用只会生成一次**——这是本能力最关键的不变式，`tests/template.service.test.js` TP2/TP6 守着。

#### ensureTodayTemplateTasks({ now?, db? } = {})

- 等价于 `generateTemplateTasks({ dateKey: toLocalDateKey(now) })`；`store.boot()` 里调用，失败被 catch（固定任务生成不出来，不该拦着孩子用工作台）。

#### childNamesOf(template, children)

- 返回：孩子昵称拼接串；孩子都删了返回「（孩子已删除）」。

## 3. 幂等键格式

- 审核通过：`approval:${taskId}`。
- **兑换扣分（M2 / M5）：`redemption:${redemptionId}`**，写在 `pointLedger.eventKey`，**逐件一条**；这是"一分只扣一次"的唯一保证。申请本身没有幂等键，靠"同一孩子同时最多一批 pending"的状态校验防重（M5 起一批可含多件）。
- 装扮到账：`petCostumeOwnerships.sourceRedemptionId` 唯一索引（同一申请不得重复到账）+ `&[childId+costumeKey]`（同一孩子同一装扮只收藏一份）。
- **固定任务生成键（M3 起真正使用）：`${type}:${childId}:${templateId}:${dateKey}`**，写在 `tasks.generationKey`，由 `&generationKey` 唯一索引兜底；同一个孩子 + 同一个模板 + 同一天，全局只可能有一条。
- streaks 唯一关系：`childId + date`，使用 `&[childId+date]` 查询与约束。
- 退回记录：**不写 `eventKey` 属性**；属性必须不存在，不是 `""`、`null` 或 `undefined`。退回没有幂等键，靠状态校验（只有 submitted 能退回）防重。
- 临时任务：**不写 `generationKey` 属性**；Seed 与家长手填的任务都用 `type="temp"` 且不写 `templateId`，不参与模板防重。
- **备份 / 恢复没有幂等键**：覆盖语义，天然可重放（同一文件导入两次结果一致）；"只成功一次"由界面 `state.busy` + 单事务原子性保证。
- 手动调分：`manual:${entryId}`（界面未开放入口）。

## 4. 决策状态

- Q-02（连续天数）：M1 **已实现展示**，口径为"今天或昨天有通过则保留"，常量 `STREAK_RULE.KEEP_ALIVE_DAYS`；仍待 Owner 确认，改口径只需改 `streak.service.js` 一处。
- Q-03（每周固定任务 / 模板）：**M3 已实现**。家长在「布置任务」里选「每天」或「每周几」，写入 `taskTemplates`；启动与切页时 `ensureTodayTemplateTasks()` 补齐当天任务。原设计"未选星期不能保存"已满足（`weekly` 的 `weekdays` 为空直接报错）；"必须指定生成星期"按 `Date.getDay()` 口径 0–6 实现。
- Q-06（PIN 位数 / 是否允许跨孩子重复）：**M3 按 4 位实现**（`PIN_LENGTH = 4` + `PIN_PATTERN`），家长 PIN 是**整个家长端一把锁**，不按孩子区分；弱 PIN（`0000`/`1234`…）只提示不拦截。
- Q-09（退出家长模式是否需再输 PIN）：**M3 按"不需要"实现**——「退出家长」一键回到孩子端；只有"再进家长端"才要验证。
- Q-05（经验:积分）：保持 `EXP_PER_POINT = 1 // TODO(decision: Q-05)`，积分与经验继续分表记账。
- Q-11（历史回看）：仍未加入口；逾期查询只覆盖"未通过"的任务，不含已通过历史。
- Q-13（奖励库存 / 限兑）：**M2 按"无库存、无限兑"实现**——不建 `stock` / `remaining` / `quantity` / `maxPerChild`；生活奖励可重复兑换，同一孩子同一装扮只收藏一份，已拥有后不再提供兑换。
- Q-05 延伸：兑换**不发经验、不写 `petProgress`、不计连续天数**；`EXP_PER_POINT` 仍只作用于任务通过。
- 奖励定价权：家长可改任意奖励的 `cost`（1–999），内置奖励名称只读；改价只影响新申请，不影响已提交申请的 `costSnapshot`。

## 5. 奖励中心与宠物装扮（DEV-B002-010-DOC 方案 → DEV-B002-011 已实施）

> 本节记录方案原文与落地结果。**§5.1–§5.5 在 M2 已全部实施**（Schema v2 + 三个新服务 + 家长两页 + 孩子端商城与衣柜 + 88 项测试），保留原文用于对照；实现与原文的差异集中在 **§5.6**。
> 落地后状态：Schema v2、14 张表、M1 的 13 个服务 + M2 的 16 个新服务（见 §2.1–§2.3），`rewards` / `redemptions` 扩字段与索引，新增 `petCostumeOwnerships` / `petCostumeStates`。

### 5.1 当时的契约差距（已消除）

- ~~`rewards` 当前只有 `id, enabled, createdAt` 索引及基础字段注释，不能表达内置 / 自定义来源、生活 / 装扮分类、模板默认价、家庭当前价和装扮关联。~~ → **v2 已补全**，见 §1 `rewards`。
- ~~`redemptions` 当前只有基础关联、状态与时间字段，没有奖励名称、申请价格、类别、装扮及素材快照。~~ → **v2 已补 5 个快照字段**，见 §1 `redemptions`。
- ~~`pointLedger` 已允许 `source="redeem"`、可选 `redemptionId` 和唯一 `eventKey`，但 M1 不写兑换流水。~~ → **M2 起兑换扣分写此表**，`eventKey=redemption:${id}`。
- ~~Schema v1 没有孩子装扮收藏与当前穿戴模型。~~ → **v2 新增两张表**，见 §1。
- `petProgress` 只记录任务经验，`taskId` 必填且 `delta ≥ 0`；装扮兑换、穿戴、卸下**仍然不得**写该表，也不得改变等级、经验或连续记录。此条**保持有效**。

### 5.2 建议的数据语义与迁移方向

| 对象 | 后续建议 | 关键约束 |
|---|---|---|
| 家庭奖励配置 `rewards` | 增加 `source`（builtin/custom）、`templateKey`、`category`（life/costume）、`name`、`description`、`iconKey`、`defaultCost`、`cost`、`enabled`、`costumeKey`、`createdAt`、`updatedAt` | 内置以稳定 `templateKey` 对应系统模板；`defaultCost` 只存建议价，`cost` 才是新申请使用的家庭当前价。自定义奖励 `source=custom`、只建生活奖励且必须显式设置 `cost`，不继承默认价 |
| 兑换申请 `redemptions` | 增加 `rewardNameSnapshot`、`costSnapshot`、`categorySnapshot`；装扮申请另加 `costumeKeySnapshot`、`assetKeySnapshot` | 快照在提交时写入且不可回改；审核展示和扣分只取快照，家长后续改名、改价或停用不影响 pending / 历史申请 |
| 系统装扮目录 | 建议作为代码内只读目录：`costumeKey`、`slot`（hat/glasses/scarf/outfit/background）、名称、`assetKey`、建议默认积分、内嵌 SVG 素材 | 系统目录不是孩子收藏；内置素材由系统维护，家长只调积分和启停，不上传或编辑图片 |
| 孩子装扮收藏 `petCostumeOwnerships`（建议新表） | `id`、`childId`、`costumeKey`、`sourceRedemptionId`、`acquiredAt` | 唯一 `(childId, costumeKey)` 防重复收藏，唯一 `sourceRedemptionId` 防同一申请重复到账；这是收藏去重，不是库存或限兑 |
| 孩子当前穿戴 `petCostumeStates`（建议新表） | 以 `childId` 为主键，各 slot 保存当前 `costumeKey`，未穿戴的 slot 省略属性，另存 `updatedAt` | 每类别最多一件，不同类别可共存；所有读取和写入按 `childId` 隔离，写入前校验同孩子收藏 |

- 实施时应新增 Schema 版本并提供 `upgrade`，保留已有孩子、任务、流水、奖励和申请数据；具体索引在开发任务中按查询确定，但不能省略上述唯一约束。
- 当前架构是一份本地数据库对应一个家庭空间，因此不为本轮方案新增 `familyId`。不同本地家庭空间自然隔离，模板补齐不得跨空间回写。
- 奖励采用编辑 / 停用，不在本版删除；停用只阻止新申请，不删除既有申请、积分流水或装扮收藏，已有 pending 仍可审核。
- 不增加 `stock`、`remaining`、`quantity`、`maxPerChild` 等库存 / 限兑字段。生活奖励可重复兑换；同一孩子同一 `costumeKey` 只收藏一份，已拥有后不再提供兑换。

### 5.3 内置模板初始化与家庭改价

1. 首次建立某内置奖励的家庭配置时，按系统模板写入 `defaultCost` 和建议的 `cost`；此后家长修改的是本家庭 `cost`。
2. 刷新、重进、重启及重复 Seed / 模板补齐只能按 `templateKey` 补缺失配置，**不得覆盖已有 `cost`、`enabled` 或家长编辑内容**。
3. 新展示和新申请读取家庭当前 `cost`；申请成立后固定使用 `costSnapshot`。默认价只用于初始建议与对照，不能作为审核扣款来源。
4. 自定义奖励必须单独填写名称、说明、系统内置图标和积分，可编辑、启停；没有系统默认价，也不得自动套用某个内置奖励价格。

### 5.4 建议服务与事务边界

| 建议服务 | 必要行为 |
|---|---|
| `ensureBuiltinRewardConfigs()` | 幂等补齐缺失模板配置，不覆盖家庭现有设置 |
| `createCustomReward(input)` / `updateReward(input)` / `setRewardEnabled(input)` | 管理本家庭自定义奖励及内置奖励的当前价、启停；保存时校验类别和必填字段 |
| `listRewardCenter(childId)` | 返回启用奖励、该孩子 pending、余额、装扮收藏与穿戴；查询必须带 `childId` |
| `requestRedemption({ childId, rewardId })` | 事务内复查奖励启用、孩子归属、该孩子无其他 pending；装扮还须未拥有。写 pending 与完整快照，不写流水、不冻结积分 |
| `listRedemptionRequests()` | 审核列表返回孩子、申请时间、名称 / 价格快照及该孩子当前流水余额 |
| `acceptRedemption({ redemptionId })` | 见下方确认事务；余额不足、非 pending 或归属非法不得写入 |
| `rejectRedemption({ redemptionId, parentMessage? })` | 仅允许 pending → rejected，可写留言；不扣分、不发装扮 |
| `listCostumeCollection(childId)` | 只返回该孩子收藏和当前穿戴 |
| `equipCostume({ childId, costumeKey })` / `unequipCostume({ childId, slot })` | 校验同孩子收藏后更新穿戴；预览不调用持久化写入，操作不写积分或经验流水 |

**孩子申请事务**：同一孩子同时最多一条 pending，必须在写入事务内再次检查，不能只依赖按钮禁用。**星星不够时在申请阶段就拒绝**（不生成 pending、不占名额、不打扰家长），家长只处理"孩子确实攒够了"的申请；申请后积分仍可通过任务审核或手动调分变化，所以家长确认时仍要再校验一次。

**家长确认事务**必须在一个 Dexie 读写事务中完成：

1. 重新读取申请并确认仍为 `pending`，同时核对申请的孩子归属。
2. 从该孩子全部 `pointLedger.delta` 重新汇总余额，与 `costSnapshot` 比较；不足则整笔不写并返回余额不足，由家长选择稍后处理或“先不换了”（后者走拒绝）。
3. 新增负向流水：`delta = -costSnapshot`、`source="redeem"`、`redemptionId=申请 id`、`eventKey="redemption:${redemptionId}"`，并保证事件键唯一。
4. 将申请改为 `accepted` 并写 `handledAt`；装扮申请在同一事务新增该孩子收藏。
5. 任一步失败，流水、申请状态和收藏全部回滚；不得先显示兑换或装扮到账再等待事务结果。

`accepted` 与 `rejected` 都是终态。重复确认已 accepted 的申请只返回原处理结果，不新增流水或收藏；rejected 不可再确认，accepted 不可再拒绝。UI 禁用只是辅助，数据层状态条件、唯一事件键和收藏唯一约束必须同时生效。

### 5.5 持久化、备份与后续验证要求

- 收藏与穿戴写入本地数据库，刷新 / 重进后按当前 `childId` 重读；不能只存页面内存。未拥有装扮的临时预览不得恢复成正式穿戴。
- 穿戴 / 卸下 / 同类别切换不扣分、不写 `pointLedger` / `petProgress`；写入失败保持原正式状态。
- 后续备份 / 恢复须纳入新增奖励配置字段、申请快照、`petCostumeOwnerships` 和 `petCostumeStates`，并保留 `childId`、申请、流水与收藏之间的关联。
- 验收已覆盖（M2 实测）：模板重复初始化不改家庭价格、不同孩子隔离、申请不扣分、快照不受改价影响、余额不足零写入、重复确认零重复流水 / 收藏、停用后历史可追溯、刷新后的收藏与穿戴保持。对应用例见 §5.6 测试映射。

### 5.6 M2 实施结果与方案差异

**与方案的差异（4 处；前 3 处是实现细化，第 4 处是产品行为调整）**

| 项 | 方案原文 | 实现 | 原因 |
|---|---|---|---|
| 兑换流水 `eventKey` 唯一性 | 要求"保证事件键唯一" | 事务内**先按 `eventKey` 查重 → 命中返回 `duplicate`**，再用 `ConstraintError` 兜底（并发时另一个事务先写入） | fake-indexeddb / 真实 IndexedDB 在并发下都可能让后到的事务抛唯一约束错误，仅靠约束会让 UI 看到报错而不是"已处理" |
| 申请幂等 | "必须在事务内再次检查" | 事务内查 `[childId+status]`，存在 pending 即拒绝；**同时**在 UI 侧对"该奖励已有 pending"单独给出文案 | 数据层保证唯一，界面负责解释 |
| `petCostumeStates` 索引 | 建议"各 slot 保存当前 costumeKey" | 主键 `childId` + `updatedAt` 索引，未穿戴 slot **省略属性** | 不写 `""`，避免"空穿戴"被当作已穿戴 |
| 星星不够的拦截位置 | "申请时余额不足不阻止提交，由家长拒绝" | **改为在 `requestRedemption` 事务内直接拒绝**（孩子端按钮变「还差 X 颗」+ 点击提示）；家长端余额校验降级为兜底 | 一条必然被驳回的申请对孩子没有价值，只是多一次无效往返；申请后星星仍可能被花掉，所以确认侧校验不能删 |

**测试映射（`npm test`，共 88 项全通过）**

| 契约条款 | 用例 |
|---|---|
| v1 → v2 无损迁移、重复打开不重复迁移、旧唯一索引仍生效 | `tests/migration.v2.test.js` M2-MG1 ~ MG3 |
| 内置模板幂等补齐、不覆盖家长改价 / 启停 | `tests/reward.service.test.js` RW1、RW2 |
| 自定义奖励不撞唯一索引、内置只能改价 | `tests/reward.service.test.js` RW3 ~ RW5 |
| 申请不扣分、同孩子仅一条 pending、装扮未拥有校验 | `tests/redemption.service.test.js` RD1、RD2、RD5、RD6 |
| 星星不够时申请被挡回（零 pending、不占名额），攒够后仍可申请 | `tests/redemption.service.test.js` RD3 |
| 申请后星星被花掉，确认被拒且零写入、申请保持 pending | `tests/redemption.service.test.js` RD3B |
| 快照不受后续改价影响 | `tests/redemption.service.test.js` RD4 |
| 并发确认只扣一次（`Promise.allSettled`，恰 1 accepted + 1 duplicate） | `tests/redemption.service.test.js` RD8 |
| 拒绝只改状态、不扣分、不写流水 | `tests/redemption.service.test.js` RD7、RD9 |
| 收藏写入、穿戴 / 卸下 / 同类别替换、未拥有不可穿、跨孩子隔离 | `tests/costume.service.test.js` CT1 ~ CT6 |

**未做（明确留待后续任务）**

- 备份 / 恢复未接入新表与新字段（备份功能本身尚未实现）。
- 奖励不支持删除，只支持改价与停用；不做库存、限兑、有效期。
- 装扮目录是代码内只读常量，家长不能上传、编辑或新增素材。
- 装扮不影响经验、等级、连续天数；无宠物状态机、无喂养 / 心情 / 掉落。

## 6. M3 实施结果（DEV-B002-012）

> 落地后状态：**Schema 仍为 v2、14 张表、零结构变更**；新增 4 个服务（`settings` / `pin` / `backup` / `template`）、家长端第 6 个 Tab「设置」、PIN 门控弹层、导入确认弹层、布置页的重复方式选择器。测试总数 **88 → 111**。

### 6.1 备份文件格式（`formatVersion: 1`）

```json
{
  "format": "b002-family-workbench-backup",
  "formatVersion": 1,
  "schemaVersion": 2,
  "appName": "小学生学习家庭工作台",
  "exportedAt": "2026-11-21T09:34:12.000Z",
  "counts": { "children": 1, "taskTemplates": 0, "tasks": 5, "...": 0 },
  "data": {
    "children": [], "taskTemplates": [], "tasks": [], "submissions": [],
    "reviews": [], "pointLedger": [], "petProgress": [], "streaks": [],
    "rewards": [], "redemptions": [], "petCostumeOwnerships": [],
    "petCostumeStates": [], "settings": [], "_meta": []
  }
}
```

- **两个版本号是两件事**：`formatVersion` 描述"文件长什么样"（由 `SUPPORTED_FORMAT_VERSIONS` 控制），`schemaVersion` 描述"数据表结构到哪一版"。M3 只用到 `formatVersion: 1`，因为 14 张表的结构没变。
- `data` 必须**正好**包含 14 张表（顺序即 `BACKUP_TABLES`：children → taskTemplates → tasks → submissions → reviews → pointLedger → petProgress → streaks → rewards → redemptions → petCostumeOwnerships → petCostumeStates → settings → _meta），多一张少一张都算坏文件。
- 主键字段：`settings` / `_meta` 用 `key`，`petCostumeStates` 用 `childId`，其余用 `id`。
- 文件名 `学习工作台-备份-YYYY-MM-DD-HHmm.json`；文本 `JSON.stringify(payload, null, 2)`。
- **`_meta.restoreState` 导出时统一写成 `complete`**，防止把"写了一半"的标记带到别人机器上。
- 备份**包含 `settings` 表**（含 PIN 的盐与摘要），但**导入时 PIN 键会被本机值覆盖**，见 §2.6。

### 6.2 导入校验（`validateBackupPayload`，纯只读）

必须全部通过才进入写入阶段，任何一项不过就抛错并中断：

| # | 校验项 | 不过时的提示 |
|---|---|---|
| 1 | 是对象、`format` 等于本工作台标识 | 这个文件不是本工作台导出的备份 |
| 2 | `formatVersion` 在 `SUPPORTED_FORMAT_VERSIONS` 内 | 备份格式版本不认识 |
| 3 | `schemaVersion` 是 ≥1 的整数且 **不大于当前应用版本** | 备份来自更新的版本，请先升级应用 |
| 4 | `data` 是对象，表集合**正好 14 张**（不认识 / 缺表分别报） | 备份里有不认识的表 / 备份缺少表 |
| 5 | 每张表是数组，每条记录是对象 | 表 X 的内容不是数组 / 有不是对象的记录 |
| 6 | 每条记录主键非空字符串、同表内不重复 | 缺少主键 / 重复主键 |
| 7 | 至少有一个孩子 | 备份里没有任何孩子 |
| 8 | **硬引用**必须闭合：`childId` 指向存在的孩子；`submissions/reviews` 的 `taskId`、`pointLedger/petProgress` 的 `taskId`、`petCostumeOwnerships.sourceRedemptionId` 指向存在的记录 | 有记录指向不存在的孩子 / 任务 / 兑换申请 |
| 9 | **软引用允许悬空**：`tasks.templateId`、`redemptions.rewardId` | —（模板可删、奖励可停用，历史不该因此判坏） |
| 10 | `generationKey` 同文件内不重复（否则导入后必撞唯一索引） | 有任务重复了同一个生成键 |

`tests/backup.service.test.js` 的 BK3 用 **9 种坏文件**逐一验证"拒绝且库内一条不动"：格式不对、formatVersion 不支持、表缺失、表多出来、主键缺失、主键重复、孩子为空、引用悬空、generationKey 重复。

### 6.3 PIN 门控的会话语义

- `state.gateUnlocked` **只存在内存里**，`boot()` 里强制置 `false`。所以：**刷新页面 = 新会话 = 要重新输**；同一会话内家长端各 Tab 之间来回切不需要重复验证；点「退出家长」调用 `lockParent()` 立刻清零。
- 门控只在 `goPage()` 进入 `mode === "parent"` 的页面前触发；被拦下时 `mode` 仍是 `kid`（顶栏与底栏都不会提前变成家长端）。
- 老用户没设 PIN：`checkParentPin` 直接 `allowed: true`，但仍然走同一段代码路径——**不写"没设就跳过"的特例分支**，避免两套逻辑分叉。
- 家长端设置页在未配置时显示「建议设置家长 PIN」+ 说明"只防误触，不是密码"；已配置时显示「家长 PIN 已开启」+ 修改 / 关闭。
- 连续 5 次错误锁 60 秒；锁定期内即使输对也拒绝，弹层提示剩余秒数。

### 6.4 与任务书的差异 / 关键设计决定

| 项 | 任务书原文 | 实现 | 原因 |
|---|---|---|---|
| 新建表 | "必要时新增 `settings` 字段或 `taskTemplates` 表，**务必写 Schema 升级脚本**" | **不需要**：`settings` 与 `taskTemplates` 在 v1 已存在且已建索引，`tasks.templateId` / `generationKey` 也在 | 为了"看起来像做了迁移"而平白升一次版本号，会给老库带来无收益的写入风险；升版本要有理由 |
| 密码学强度 | "不需要做复杂的加密" | 加盐 + 512 轮混合摘要，纯 JS，Node 与浏览器结果一致 | 只用 WebCrypto 会让单测（Node 环境）与运行时不同源，反而出现"测试过、线上不过" |
| 导入的后悔药 | "必须弹窗二次确认" | 二次确认 + **自动快照 + 「撤销上次导入」按钮** | 只有确认没有退路，家长手一抖就没了；快照放 localStorage，不入库（否则套娃） |
| 换设备后 PIN | 未提 | **导入时不改本机 PIN**（先删备份里的 PIN 键，再写回本机值） | 否则把旧备份导回来会把 PIN 改回半年前的，甚至锁死 |
| 固定任务生成时机 | "应用启动或孩子第二天打开时" | `boot()` 调 `ensureTodayTemplateTasks()`；家长新建模板后也立刻补当天 | 只靠启动会漏掉"当天上午刚建的模板" |
| 生成失败 | 未提 | `boot()` 里 `try/catch` 静默 | 固定任务生成不出来，不该拦着孩子用工作台；下次启动会补上 |
| 「添加到主屏幕」按钮 | 检查安装逻辑 | **只有浏览器触发 `beforeinstallprompt` 时才显示一键安装按钮**；开发地址（localhost）下 Service Worker 只在生产注册（`import.meta.env.PROD`），事件不会触发，此时卡片显示可点的「看安装步骤」按钮，弹层给电脑 Chrome/Edge、安卓 Chrome、iPhone Safari 三套步骤 | 原先只有一段蓝色加粗说明文字，看起来像链接却点不动；改为明确的按钮 + 分设备指引，并说清"localhost 下不会有按钮，部署到正式网址后自动出现" |

### 6.5 测试映射（M3 阶段 `npm test` 共 111 项；M4 后为 121 项，见 §7.5）

| 契约条款 | 用例 |
|---|---|
| 未设 PIN 默认放行、状态不泄露哈希 | `tests/pin.service.test.js` M3-PN1 |
| 设置后错拒对通过、库里无明文 | M3-PN2 |
| 非 4 位一律拒绝 | M3-PN3 |
| 改 / 关 PIN 必须验证当前 PIN | M3-PN4 |
| 连错 5 次锁 60 秒、锁定期内输对也拒 | M3-PN5 |
| 设 PIN 只写 `settings`，不动其他表 | M3-PN6 |
| 导出包含 14 张表、表头齐全 | `tests/backup.service.test.js` M3-BK1 |
| 导出的文本能原样解析回来 | M3-BK2 |
| 9 种坏文件全部拒绝且库内零改动 | M3-BK3 |
| 覆盖恢复回到备份那一刻（新增的孩子被覆盖掉） | M3-BK4 |
| 恢复原子性：写到一半失败，14 张表计数 / 昵称 / 余额全不变 | M3-BK5 |
| v1 老备份导入时自动补 v2 字段 | M3-BK6 |
| 导入前自动快照、可撤销、撤销后快照清空 | M3-BK7 |
| 导入不改本机 PIN | M3-BK8 |
| 校验器是纯函数，不改库 | M3-BK9 |
| 每日模板生成且 `generationKey` 格式正确 | `tests/template.service.test.js` M3-TP1 |
| **同一天重复生成不会出现第二条** | M3-TP2 |
| 每周模板只在选中的星期生成 | M3-TP3 |
| 停用不生成、删模板不删历史任务 | M3-TP4 |
| 两个孩子各生成一条、生成键不互撞 | M3-TP5 |
| 不同日期互不干扰 | M3-TP6 |
| 7 种非法入参在写库前被拒 | M3-TP7 |
| 中文描述与列表排序 | M3-TP8 |

**浏览器闭环（真实 Chromium 430×932，控制台零错误）**

| 任务书要求 | 实测证据 |
|---|---|
| ① 设 PIN → 退出 → 进家长端被拦 → 输对进入 | 设置 4826 → 标题变「家长 PIN 已开启」→ 点「退出家长」`mode=kid` → 点家长 Tab 弹 PIN 键盘（`mode` 仍为 `kid`）→ 输 `1111` 提示「PIN 不对，还能试 4 次」且仍被拦 → 输 `4826` 后 `mode=parent` 并进入「确认」页 |
| ② 导出 JSON → 新增一个孩子 → 导入 JSON → 数据恢复如初 | 导出 `学习工作台-备份-2026-11-21-1734.json`（14 张表 / 23 条）→ 新增「小宝」变 2 个孩子 → 导入同一文件（未勾选时「覆盖并恢复」不可点）→ 提示「已恢复 23 条记录」→ 孩子回到 1 个 → 点「撤销上次导入」→ 回到 2 个孩子且撤销入口消失 |
| ③ 布置「每日任务」→ 今天库里有记录 → 模拟第二天启动 → 自动生成 | 布置「朗读课文 / 每天 / 10 星」→ 当天 `dueDate=2026-11-21` 多出 1 条，`generationKey=daily:c_m0:tpl_…:2026-11-21`，今日共 6 条中只有 1 条是模板生成 → 把时钟拨快一天重载 → `2026-11-22` 生成 1 条，键尾变为 `:2026-11-22` → **同一天再启动一次，仍是 1 条**（防重生效） |

### 6.6 M3 未做

- **PIN 不防篡改**：本机 IndexedDB 可被开发者工具直接改，PIN 只防误触。真防护需要后端或加密库，超出本地优先架构。
- 不做"忘记 PIN"的找回流程 —— **M4 已补上恢复码**（见 §7.1）。
- 备份不含照片 / 附件（G-01 已裁决不做照片）。
- 不做云同步、不做自动定时备份（只有手动导出 + 导入前自动快照）。
- PWA 的"添加到主屏幕"只在 Chromium 里验证过引导文案与 `beforeinstallprompt`，**iOS Safari 与真机未验证**。
- 安全区 padding 已按 `env(safe-area-inset-*)` 写入，但**没有真机刘海 / 底部横条实测**（M4 补齐了实现与自查清单，真机仍待内测，见 §7.4）。




## 7. M4 实施结果（DEV-B002-013，v1.0.0 封版）

### 7.1 恢复码规范

| 项 | 规定 |
|---|---|
| 形态 | 8 位大写字母数字，展示为 `A1B2-C3D4`；**不含 `0 O 1 I L`**（家长是抄在纸上的，读错一个字符等于把自己锁在门外） |
| 生成时机 | 首次设置 PIN（`setParentPin` 且此前未配置恢复码）、凭码重置成功、设置页「换一个恢复码」 |
| 存储 | `parentPinRecoveryHash` + `parentPinRecoverySalt`，摘要 = `hashPin("recovery:" + code, salt)`，**带域前缀**，与 PIN 摘要不可互相顶替 |
| 明文暴露 | **只在生成的那一次以返回值出现**；库里没有明文，`getPinStatus` 也不返回 |
| 重置流程 | 门控弹层「忘记 PIN 了？」→ 输入恢复码 → 校验 → 设新 4 位 PIN → 返回新恢复码并强提示保存 → 直接解锁进家长端 |
| 旧码作废 | 重置 / 换码时覆盖 hash + salt，旧码立刻失效（PN9 验证） |
| 失败限制 | 连错 5 次锁 60 秒；**计数与 PIN 的分开记**（`parentPinRecoveryFailedCount` / `parentPinRecoveryLockedUntil`） |
| 改 PIN | **不轮换恢复码**（改 PIN ≠ 换钥匙）；只有"重置"与"换一个"会作废旧码 |
| 物理边界 | 恢复码与 PIN 同时丢失时无解；界面写明「纯本地版本没有后门」，并给出可行退路：清空后导入之前导出的 JSON，任务与星星都能回来 |

界面强制项：恢复码弹层必须勾选「我记下了，知道它只出现这一次」才能关闭（`data-recovery-done` 默认 `disabled`），并提供「复制」按钮（`ui.copyText`，剪贴板 API 不可用时退化 `execCommand`）。颜色用亮黄 + 蓝（`--star` / `--blue` 系），与危险操作的红色明确区分。

### 7.2 彻底清空（G-05）语义

- 入口：设置页最底部红色卡片「删除全部家庭数据」→ `openWipeSheet()`。
- 两道门：**已配置 PIN 时必须重验 PIN**（`doRecheckPin`，不改会话解锁状态）→ 勾选「我确认所有孩子数据将被永久抹除」→ 红色实心按钮才可点。没设 PIN 时跳过第一道门，但仍有勾选确认。
- 执行：`wipeAllData()` 单事务清空 14 张表 + 重置 `_meta` + 清 `localStorage` 快照；随后 `window.location.reload()`，`boot()` 重新种出「朵朵 + 5 条示例任务」。
- 边界：**不删**硬盘上的 JSON 备份；**不改**任何代码与静态资源；不做"软删除"。

### 7.3 与任务书的差异 / 关键设计决定（M4）

| 项 | 任务书原文 | 实现 | 原因 |
|---|---|---|---|
| 恢复码长度 | "8 位字符（如 `A1B2-C3D4`）" | 8 位，字符集剔掉 `0 O 1 I L` | 抄写场景下，易混字符是"锁死自己"的第一大原因 |
| 恢复码存储 | "同样不存明文，存加盐哈希" | 同 PIN 的 512 轮混合摘要 + `recovery:` 域前缀 + **独立盐** | 复用一套摘要便于双端一致；域前缀保证两种凭据不能互换 |
| 改 PIN 是否换码 | 未提 | **不换**；只有"重置 / 换一个恢复码"才换 | 家长把码抄在纸上后改 PIN 是常见动作，每次都作废等于逼人反复抄 |
| 恢复码失败计数 | 未提 | 与 PIN 分开计数、各自锁定 | 否则孩子乱猜恢复码会把家长自己的 PIN 输错额度耗光 |
| 老用户（M3 设过 PIN） | 未提 | 设置页显示「还没有恢复码」+ 一键生成；**改 PIN 时也会顺手补一份**并强提示 | M3 升级上来的用户不能因为没有恢复码就永久失去自救通道 |
| 删除数据的前置验证 | "要求重新验证家长 PIN" | 已配置 PIN 才验证；未配置时只勾选确认 | 没设 PIN 的用户没有可验的东西，硬卡会把人锁在门外 |
| 删除后的状态 | "强制刷新，回到初始化界面" | 清空 + `reload()`，由 `boot()` 重新种子 | 保证"回到第一次打开"的观感一致，也顺带验证库结构仍然合法 |
| 快照处理 | 未提 | 清空时**连同 `b002.preRestoreSnapshot` 一起删** | 否则"删了还能一键恢复"，与用户的删除预期冲突 |
| 部署方式 | "提供一键打包和部署的建议" | `docs/DEPLOY.md` 给 Vercel / Cloudflare Pages 两条路径 + 上线自检表 + 真机内测清单 | 不引入额外依赖，纯静态产物可直接托管 |
| iOS 显示 | "状态栏颜色、安全区、防双击缩放" | `apple-mobile-web-app-status-bar-style=default`；顶栏 / 底栏 / 弹层 / 键盘全部 `env(safe-area-inset-*)`；`html { touch-action: manipulation }`；输入框字号 ≥16px 防聚焦缩放 | 双击缩放会让按钮"点不中"，而禁用整体缩放会伤害可读性，故只关双击 |
| 版本号 | 未提 | `package.json` 升到 `1.0.0`，经 `vite.config.js` 的 `define` 注入 `__APP_VERSION__`，设置页显示「v1.0.0 · 封版」 | 真机验收时要能一眼确认装的是哪一版；版本号只保留一个来源 |

### 7.4 PWA 封版清单

| 项 | 状态 |
|---|---|
| `manifest.webmanifest` | 补 `id`、`display_override`、`orientation: portrait`、`dir`、`categories`、`prefer_related_applications: false`；`theme_color` / `background_color` 与页面配色统一（`#FF8A3D` / `#FFF8F0`） |
| 图标 | 192 / 512 / maskable-512 三份齐备 |
| Service Worker | `CACHE_VERSION` v1 → **v2**（老缓存随新 SW 激活清理）；`cache.put` 全部挂到 `event.waitUntil`，避免 SW 被回收导致"缓存没写进去、离线打不开" |
| 注册时机 | 仅 `import.meta.env.PROD`（开发环境不注册，避免干扰热更新）；`localhost` 下 Chrome 不会触发 `beforeinstallprompt`，设置页显示「看安装步骤」而非一键安装 |
| iOS | 状态栏 `default`；上下安全区；双击缩放关闭；`color-scheme` 固定浅色；`apple-touch-icon` 已有 |
| 离线 | 导航网络优先 + 外壳兜底；静态资源缓存优先 |

**仍未验**：iOS Safari 真机、iPad 横屏、离线冷启动、刘海 / 横条实测、Lighthouse 实跑分数 —— 均列入 `docs/DEPLOY.md` §10 内测清单，**不得表述为"全端通过"**。

### 7.5 测试映射（`npm test`，共 121 项全通过；M4 新增 10 项）

| 契约条款 | 用例 |
|---|---|
| 首次设 PIN 生成恢复码、明文不落库、已有码时改 PIN 不轮换 | `tests/pin.service.test.js` M4-PN7 |
| 凭恢复码重置：旧 PIN 失效、新 PIN 生效、换新码 | M4-PN8 |
| 重置后旧恢复码立即作废 | M4-PN9 |
| 恢复码输入容错（横线 / 空格 / 小写）与格式拒绝、字符集不含易混字符 | M4-PN10 |
| 恢复码连错 5 次锁 60 秒、锁定期内正确码也拒 | M4-PN11 |
| 未设 PIN / 关闭 PIN 后恢复码一并清空、不留孤儿键 | M4-PN12 |
| 彻底清空：14 张表归零、`_meta` 重置、PIN 与快照一起清掉 | `tests/backup.service.test.js` M4-BK10 |
| 清空后重新初始化回到「朵朵 + 5 条示例任务」 | M4-BK11 |
| 清空原子性：注入写失败后一条也不删 | M4-BK12 |
| 清空后的库仍能正常打开（不报 `INVALID_STATE`） | M4-BK13 |

**浏览器闭环（真实 Chromium 430×932，控制台零错误）**

| 任务书要求 | 实测证据 |
|---|---|
| ① 设 PIN → 退出 → 忘记 PIN → 输恢复码 → 改新 PIN → 成功进入 | 设 `4826` → 弹出恢复码 `NYRF-WG9Q`（未勾选时「存好了」不可点，勾选后可点）→ 退出 `mode=kid` → 点家长被拦 → 「忘记 PIN」→ 输 `ZZZZZZZZ` 提示「恢复码不对，还能试 4 次」→ 输小写带空格的正确码通过 → 设新 PIN `9137` → 弹出**新**恢复码 `6URX-TH7T`（与旧码不同）→ `mode=parent` 落到「今天要确认的」→ 退出再进，输旧 `4826` 提示「PIN 不对，还能试 4 次」且仍被拦，输 `9137` 后 `mode=parent` |
| ② 点删除数据 → 重验 PIN → 勾选确认 → 回到全新空白状态 | 设置页记录总数 `26` → 点「删除全部家庭数据」→ 输错 `1111` 提示「PIN 不对，还能试 4 次」且确认弹层不出现 → 输 `9137` 进入确认页（未勾选时红按钮不可点，勾选后可点）→ 点「永久删除并重置」→ 自动刷新 → 孩子端显示「朵朵」、5 条示例任务、星星 0、0/5 → 直接点家长 Tab **没有 PIN 弹层**（`mode=parent`）→ 设置页「建议设置家长 PIN」、版本「v1.0.0 · 封版」、记录总数 `20`（重新种子后） |

截图归档：`docs/screens/37–44`（设置页 PIN 与恢复码 / 恢复码首次生成 / 忘记 PIN 输入恢复码 / 设新 PIN / 删除二次确认 / 删除后回到初始 / PIN 拦截含忘记入口 / 设置页危险区）。

### 7.6 M4 未做

- 恢复码没有"有效期"，也不支持多份并存（一份作废即换新）。
- 不做家长协助者 / 多账号（PRD 第三阶段，家庭共用同一 PIN 已够用）。
- 不做 AI 生成学习计划、AI 解析错题（无后端，纯前端调不动模型；若要做需引入云端服务，与"数据不上云"的定位冲突，需 Owner 裁决）。
- 不做云端自动备份 / 多设备同步；跨设备仍靠手动导出导入。
- 真机（iOS Safari / 安卓 Chrome）安装、离线冷启动、Lighthouse 评分未实测。

## 8. M5 实施结果（DEV-B002-014：兑换多选后一起提交）

### 8.1 一句话

孩子端商城从「点一件 → 提交 → 等家长确认 → 才敢点下一件」改成「一次勾几件 → 一次提交 → 家长一张卡一次确认」。

### 8.2 唯一一条规则变更

| 项 | M2 / M4 | M5 |
|---|---|---|
| pending 约束 | 同一孩子同时最多 **1 条** 申请 | 同一孩子同时最多 **1 批** 申请（1–6 件） |
| 申请时余额校验 | 逐件 `balance ≥ cost` | **合计** `balance ≥ ΣcostSnapshot` |
| 确认粒度 | 一件一次事务 | 一批一次事务（勾选的通过，未勾选的同事务退回） |
| 家长看到的卡片 | 一件一张 | **一批一张**（老数据仍是一件一张） |

> PRD v1.3 §6.5 第 3 步与"状态与幂等"第 2 条写的是"同一孩子同一时间最多一条 `pending` 申请"。本次按 Owner 要求落地为"一批"，**本文件为准**；建议 PRD 下一版同步这一条，其余（不扣分、快照扣分、终态、幂等键）完全不变。

### 8.3 数据结构

- `redemptions` 新增 `batchId`（`bat_…`），**不建索引、不写迁移、`SCHEMA_VERSION` 仍为 2**：家长待处理列表本来就按 `status` 索引取全量，再在内存按 `batchId` 分组，家庭数据量下不需要新索引。
- M2 老数据没有 `batchId`：客户端分组与服务端查询统一用 `row.batchId ?? row.id` 兜底，所以老的单件申请照样能确认 / 退回，行为与 M2 一致（`M5-RD9` 守着）。

### 8.4 交互落地

孩子端（`src/app/pages/petPage.js` + `#dock`）：

- 卡片右侧按钮变「选这个 / 已选」；按钮带透明覆盖层铺满整卡，**点卡片任何位置都算勾选**（小手指友好）。
- 勾选后卡片描边变蜜橘色、左上角出现小勾、按钮变实心「已选」。
- 底部固定汇总条：`已选 N 件 · 共 M 颗 · 换完剩 X 颗`（不够就写「还差 X 颗」并禁用提交）+「清空」+「一起告诉爸爸妈妈」。
- 提交成功后整页重载：蓝色横幅列出这批名称与合计，其余卡片变「等这批确认」，商城进入只读态。

家长端（`src/app/pages/redeem.js`）：

- 一批一张卡：头部「朵朵想换 3 件 · 一批」+ 逐件明细（名称快照 / 类别 / 当时价格）。
- 多件时才出现勾选框（默认全勾）；取消后该行变灰划线，`选中 / 合计要扣 / 换完剩` 三个数字与主按钮文案**实时重算**，不够扣时按钮禁用并给出差额。
- 主按钮「通过 N 件 · 扣 M 颗」；未勾选的件在同一事务里按拒绝处理。
- 「先不换这批」复用原说明弹层，标题改「先不换这批（N 件）」并列出明细。

### 8.5 三个踩过的坑（都已修，写下来防复发）

1. **汇总条不能放在 `.page` 里**：`.page` 带 `rise-in` 动画（`transform` 停在 `translateY(0) scale(1)` 而非 `none`，`fill-mode: both`），会成为 `position: fixed` 的包含块，汇总条被排到视口外（首次实测完全看不见）。改为挂在 `.page` 之外的 `#dock`（`.shell` 内、`.tabbar` 之前）。
2. **`[hidden]` 打不过 `display: flex`**：`.redeem__warn` 自带 `display: flex`，余额够时"还差 0 颗"的警告条仍然显示。补 `.redeem__warn[hidden] { display: none }`（`.shop-bar[hidden]` 同理已补）。
3. **统计节点不能用 `data-balance`**：`paintBalance()` 会扫全文档 `[data-balance]` 并把内容刷成孩子当前余额，导致「换完剩」显示成 120。改用 `data-batch-balance`。

另外一条不变式，不是 UI 优化：**未勾选的件必须在同一个事务里退回**，否则孩子会有一条永久悬挂的 pending，再也发不出新一批。

### 8.6 测试与实测

`npm run verify`：**130 / 130 通过**（原 121 项 + 9 项 M5），构建成功。

| 契约条款 | 用例 |
|---|---|
| 一次提交多件：同 `batchId`、逐件快照、不扣分不写流水 | `tests/redemption.service.test.js` M5-RD1 |
| 单件都够但合计不够：整批挡回、零写入、`shortage` 正确 | M5-RD2 |
| 已有待确认批次时不能再开新批 | M5-RD3 |
| 按批确认：一次扣合计、逐件流水、逐件到账 | M5-RD4 |
| 只勾其中几件：未勾选同事务退回、不留悬挂 pending | M5-RD5 |
| 重复确认整批：不重复扣分、不重复收藏 | M5-RD6 |
| 整批退回：不扣分、全部终态、不能再确认 | M5-RD7 |
| 同件重复传只算一次；超上限 / 空数组拒绝 | M5-RD8 |
| M2 老数据（无 `batchId`）仍按单件确认 | M5-RD9 |

顺手修掉一个既有偶发失败：`M3-TP8` 断言"模板按创建时间正序"，但两条模板在同一毫秒创建、`id` 随机，排序断言约 1/3 概率失败。改为显式错开 `now`，连跑三次稳定通过。

**浏览器闭环（真实 Chromium 430×932，控制台零错误）**

| 任务书要求 | 实测证据 |
|---|---|
| ① 孩子多选后一起提交，家长一次确认 | 内测充值后余额 `120` → 勾 3 件（20+30+50）→ 汇总条 `已选 3 件 共 100 颗 换完还剩 20 颗`、3 张卡 `is-picked` → 点「一起告诉爸爸妈妈」→ 横幅「你申请换「…」共 3 件 100 颗，等爸爸妈妈确认」、汇总条 `hidden=true`、3 个按钮 `disabled` |
| ② 家长端一批一张卡，可只通过其中几件 | 兑换审核页 `1` 张批次卡 / `3` 行明细，英雄区「有 1 批兑换等你处理（共 3 件）」，主按钮「通过 3 件 · 扣 100 颗」→ 取消 50 颗那件 → 按钮变「通过 2 件 · 扣 50 颗」，统计变「选中 2 件 / 合计要扣 50 颗 / 朵朵换完剩 70 颗」→ 通过 → 待处理卡归零，弹「现在没有要处理的兑换」 |
| ③ 结果对得上：余额、申请状态、流水 | 回孩子端余额 `70`；「我的兑换」3 条：公园「没换成」、动画与 15 分钟「已换到」；流水 `−30 / −20`；商城恢复 4 个可选按钮（余额不够的两件显示「还差 X 颗」） |
| ④ 单件走同一条路，不被"批量"改坏 | 只勾 1 件（30 颗）→ 汇总条「已选 1 件 共 30 颗 换完还剩 30 颗」→ 提交 → 家长卡**无明细行、无勾选框**，头部「看一集动画片 + 生活奖励」，三格「申请时价格 30 / 朵朵现在有 60 / 换完剩 30」，按钮「通过并扣 30 颗」→ 点「先不换」→ 弹层标题「先不换「看一集动画片」」且不带整批明细 → 退回后余额仍 `60`、状态「没换成」、横幅消失、商城 4 个可选 |

截图归档：`docs/screens/45–52`（多选清单 / 已提交等确认 / 家长批次卡 / 部分勾选 / 换完结果 / 单件批次卡 / 整批退回弹层 / 退回后）。共 8 张。

### 8.7 M5 未做

- 不做"跨孩子合并一批"：一批只属于一个孩子，家长按孩子逐批确认（避免一张卡里混两个人）。
- 不做批次级的"部分件改价"：扣分仍只认每件的 `costSnapshot`。
- 不做过期自动退回：pending 仍由家长手动处理（PRD 未定义超时语义）。
