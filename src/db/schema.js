/**
 * 数据库 Schema 定义
 *
 * 依据：`PRD_v1.3.md` §9.3 / §10 / §6.4 / §6.5 / §7.4、
 *      `design/05_交接说明.md` §2.2–2.4、`tech/contract.md` §5–§6。
 *
 * 纪律：
 * 1. 表结构变化必须新增 Dexie 版本 + 迁移逻辑（见 migrations.js），
 *    不允许删库重建、不允许复用已发布的版本号。
 * 2. 业务常量（Q-02 连续天数断点、Q-03 生成星期、Q-05 经验系数、Q-11 历史入口）
 *    尚未确认，本文件**不写死任何一项**；对应能力都留在字段/配置层。
 * 3. `submissions` 的内容载体字段受 G-01 影响，结构待定，见字段注释。
 *
 * 版本历史：
 * - v1（DEV-B002-006）：12 张表，M0/M1 使用。
 * - v2（DEV-B002-011）：rewards / redemptions 补字段，新增宠物装扮收藏与穿戴两张表。
 *   **只加不删**：v1 全部表、全部字段与索引保留，旧库升级无需重建、不丢数据。
 */

/** 当前 Schema 版本（Dexie 版本号，与备份文件的 schemaVersion 同义） */
export const SCHEMA_VERSION = 2

/** 默认数据库名（备份恢复的临时库/指针切换在后续任务实现，本轮不引入） */
export const DB_NAME = "b002_family_workbench"

export const TABLE_NAMES = Object.freeze({
  CHILDREN: "children",
  TASK_TEMPLATES: "taskTemplates",
  TASKS: "tasks",
  SUBMISSIONS: "submissions",
  REVIEWS: "reviews",
  POINT_LEDGER: "pointLedger",
  PET_PROGRESS: "petProgress",
  STREAKS: "streaks",
  REWARDS: "rewards",
  REDEMPTIONS: "redemptions",
  COSTUME_OWNERSHIPS: "petCostumeOwnerships",
  COSTUME_STATES: "petCostumeStates",
  SETTINGS: "settings",
  META: "_meta",
})

/**
 * 第一版表结构与索引（已发布，不得修改）。
 *
 * Dexie 语法速记：
 * - `&xxx`         唯一索引
 * - `[a+b]`        复合索引
 * - `&[a+b]`       唯一复合索引
 * - `*xxx`         多值索引（数组元素逐个入索引）
 * - 未写进索引串的字段仍会被完整保存，只是不可索引查询
 */
export const schemaV1 = {
  /** 孩子：id / nickname / avatarKey / hasChildPin / childPinHash / childPinSalt / createdAt */
  children: "id, createdAt",

  /** 固定任务模板：id / name / points / type(daily|weekly|temp) / childIds(数组) / weekdays(数组) / enabled / createdAt */
  taskTemplates: "id, type, enabled, *childIds",

  /**
   * 任务实例：id / childId / title / points / type / status / dueDate(YYYY-MM-DD)
   * / templateId / generationKey / submittedAt / approvedAt / approvalDate
   * / revisionReason / returnCount / createdAt
   *
   * - `&generationKey`：固定任务防重复生成，格式为 `${type}:${childId}:${templateId}:${dateKey}`。
   *   临时任务**不写该属性**（不是空字符串、不是 null、不是 undefined），
   *   记录缺少该键时不进入唯一索引，因此可以存在任意多条。
   * - 状态只有四值：todo / submitted / approved / revision（Q-15：不加第五个值）。
   * - dueDate 是日期级字符串，不是时间戳（Q-14）。
   */
  tasks: "id, childId, status, type, dueDate, templateId, &generationKey, [childId+dueDate], [childId+status]",

  /**
   * 任务提交记录（一次提交一条，退回后重新提交新增一条，历史不删）
   *
   * 固定字段（无论 G-01 最终形态都必须保留）：
   *   taskId / childId / submittedAt / version / status
   *
   * 内容载体字段（受 G-01 影响，结构待定，迁移方式见 tech 方案 §11）：
   *   contentType —— 预留：文字 / 照片 / 家长确认。当前只允许写入 "text" 或留空；
   *                   Owner 2026-11-20 裁决"第一版不做照片、保留文字提交"。
   *   content     —— 预留：文字提交正文（纯文本）。
   *   attachmentIds —— 预留：照片等附件关联（第一版不实现，不建附件表）。
   *
   * 这些字段**不填充默认值、不在界面使用、不冻结结构**；G-01 最终裁决后靠"填充字段"
   * 而不是"重建表"落地。
   */
  submissions: "id, taskId, childId, status, [childId+submittedAt], [taskId+version]",

  /**
   * 家长审核记录：id / taskId / childId / result(approved|revision) / reason
   * / reviewedAt / approvalDate / eventKey
   *
   * `&eventKey`：审核通过记录必须写 `eventKey = "approval:${taskId}"`；
   * 退回记录**不写 eventKey 属性**（属性不存在，不是 ""、null 或 undefined），不进入该唯一索引。
   */
  reviews: "id, taskId, childId, result, &eventKey, [childId+reviewedAt]",

  /**
   * 积分流水（余额的唯一权威来源）：id / childId / delta / reason / source(task|redeem|manual)
   * / taskId / redemptionId / eventKey / approvalDate / createdAt
   *
   * - 不存可写的 balance 字段；余额永远由本表汇总派生。
   * - `&eventKey`：与 reviews / petProgress 各自独立约束，防止重复发放。
   * - K18：本表不做时间裁剪、不做归档删除。
   */
  pointLedger: "id, childId, source, taskId, &eventKey, [childId+createdAt]",

  /**
   * 宠物经验流水（与积分流水**分开记账**，不共用字段、不共用常量）：
   * id / childId / delta / taskId / eventKey / createdAt
   *
   * Q-05（经验与积分比例）待 Owner 确认，系数抽在 services 层常量，不在本表写死。
   */
  petProgress: "id, childId, taskId, &eventKey, [childId+createdAt]",

  /**
   * 连续学习记录：id / childId / date(YYYY-MM-DD) / approvedCount / createdAt / updatedAt
   *
   * `&[childId+date]`：每孩子每天唯一。
   * Q-02（断点判定与展示口径）待确认，本表只记录"当天实际审核通过数量"，
   * 不做连续天数展示算法，不回填历史日期。
   */
  streaks: "id, childId, date, &[childId+date]",

  /**
   * 奖励定义（v1 形态，v2 扩字段）：
   * id / name / description / cost / enabled / createdAt（Q-13：不含库存/限兑字段）
   */
  rewards: "id, enabled, createdAt",

  /**
   * 兑换申请（v1 形态，v2 扩快照字段）：
   * id / childId / rewardId / status(pending|accepted|rejected) / requestedAt / handledAt / parentMessage
   */
  redemptions: "id, childId, rewardId, status, [childId+status], [childId+requestedAt]",

  /**
   * 家庭设置（键值表）：key / value / updatedAt
   * 预期键（后续任务写入）：lastBackupAt / lastBackupVersion / lastBackupFileName /
   * storagePersisted / parentPinHash / parentPinSalt / recoveryCodeHash / recoveryCodeSalt。
   * 不存明文 PIN 或明文恢复码。
   */
  settings: "key",

  /**
   * 数据库元数据（键值表）：key / value / updatedAt
   * 预期键：schemaVersion / createdAt / restoreState（新装写 complete；恢复中写 restoring）。
   */
  _meta: "key",
}

/**
 * 第二版表结构：在 v1 基础上扩展奖励与兑换，并新增装扮收藏 / 穿戴两表。
 *
 * 迁移原则（见 migrations.js 的 v2 upgrade）：
 * - 所有 v1 表与索引原样保留，不删表、不删字段、不重建；
 * - 新增字段对旧记录做**防御性回填**，不覆盖已有的 cost / enabled；
 * - `costSnapshot` 等快照字段只在写申请时落库，旧申请（若有）按只读兜底补齐。
 */
export const schemaV2 = {
  ...schemaV1,

  /**
   * 奖励定义（v2 完整形态）
   *
   * id / source(builtin|custom) / templateKey / category(life|costume) / name / description
   * / iconKey / defaultCost / cost / enabled / costumeKey / createdAt / updatedAt
   *
   * - `&templateKey`：内置奖励以稳定模板键去重。**自定义奖励不写该属性**
   *   （不是 ""、null 或 undefined）——空字符串是合法键值，会与第二个自定义奖励撞唯一索引。
   * - `defaultCost` 只存系统建议价，用于展示与对照；`cost` 才是本家庭当前价，
   *   也是新申请展示与写入 `costSnapshot` 的来源。
   * - 停用只阻止新申请，不删除既有申请、流水或装扮收藏（Q-13：无库存、无限兑）。
   */
  rewards: "id, &templateKey, source, category, enabled, createdAt",

  /**
   * 兑换申请（v2 完整形态）
   *
   * id / childId / rewardId / status(pending|accepted|rejected)
   * / rewardNameSnapshot / costSnapshot / categorySnapshot
   * / costumeKeySnapshot / assetKeySnapshot
   * / requestedAt / handledAt / parentMessage
   *
   * - 快照在提交时写入，之后不可回改：家长改名、改价、停用都不影响既有申请。
   * - 确认扣分只认 `costSnapshot`，**不读** rewards.cost。
   * - 同一孩子同时最多一条 pending，判断在事务内完成，不依赖按钮禁用。
   */
  redemptions:
    "id, childId, rewardId, status, requestedAt, [childId+status], [childId+requestedAt], [status+requestedAt]",

  /**
   * 孩子装扮收藏：id / childId / costumeKey / sourceRedemptionId / acquiredAt
   *
   * - `&[childId+costumeKey]`：每孩子同一装扮最多一份（收藏去重，不是库存或限兑）。
   * - `&sourceRedemptionId`：同一条申请不得重复到账。
   * - 只有家长确认通过（同一事务）才写入本表，申请时不写。
   */
  petCostumeOwnerships: "id, childId, costumeKey, &[childId+costumeKey], &sourceRedemptionId, acquiredAt",

  /**
   * 孩子当前穿戴：主键 childId，各 slot 直接存 costumeKey
   * （hat / glasses / scarf / outfit / background），未穿戴的 slot **省略属性**。
   *
   * - 每个类别最多一件；不同类别可共存。
   * - 穿戴 / 卸下不写 pointLedger / petProgress，不改经验、等级与连续记录。
   * - 未拥有的装扮不得写入本表（由 costume.service 校验收藏）。
   */
  petCostumeStates: "childId, updatedAt",
}

/**
 * 版本注册表：每次 Schema 变化追加一条 { version, stores }，
 * 已发布条目不得修改。升级逻辑统一在 migrations.js 的 UPGRADES 里按版本号注册。
 */
export const SCHEMA_VERSIONS = Object.freeze([
  Object.freeze({ version: 1, stores: schemaV1 }),
  Object.freeze({ version: 2, stores: schemaV2 }),
])
