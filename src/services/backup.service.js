/**
 * 数据备份与恢复（M3，最高优先级）。
 *
 * 三条硬要求：
 * 1. **全量**：13 张业务表 + `_meta` 一张不落（含 `pointLedger`、`petCostumeOwnerships`、
 *    `petCostumeStates`、`taskTemplates`、`settings`）。
 * 2. **坏文件绝不入库**：解析 → 结构校验 → 主键唯一 → 跨表引用完整性，
 *    任何一步不过就抛错中断，库里一个字节都不动。
 * 3. **原子**：清空 + 写入 + 元数据修正全在**一个 Dexie 事务**内，任一步失败整笔回滚，
 *    不存在"清空了但没写进去"的半成品库。
 *
 * 另外两条工程决定（写进 `tech/contract.md` §6）：
 * - 导入前自动把当前数据快照存到 `localStorage`，可一键"撤销上次导入"；
 *   快照**不放进数据库**，否则下次导出会把上一次的备份套娃进去。
 * - PIN 以**本机为准**：导入不修改本机 PIN，也不接受备份里的 PIN
 *   （否则换一台设备导入别人的备份，就会突然被一个不知道的数字锁在外面）。
 */

import { SCHEMA_VERSION, TABLE_NAMES } from "../db/schema.js"
import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp, toLocalDateKey } from "../db/date.js"
import { upgradeToV2 } from "../db/migrations.js"
import { SETTING_KEYS, readSettings, writeSetting, deleteSetting } from "./settings.service.js"

/** 文件头标识，用来判断"这是不是本工作台导出的备份" */
export const BACKUP_FORMAT = "b002-family-workbench-backup"
/** 备份文件自身的结构版本（与数据库 Schema 版本是两件事） */
export const BACKUP_FORMAT_VERSION = 1
/** 当前应用能读懂的最高备份格式版本 */
export const SUPPORTED_FORMAT_VERSIONS = Object.freeze([1])

/** 导出顺序 = 恢复写入顺序：被引用的表在前 */
export const BACKUP_TABLES = Object.freeze([
  TABLE_NAMES.CHILDREN,
  TABLE_NAMES.TASK_TEMPLATES,
  TABLE_NAMES.TASKS,
  TABLE_NAMES.SUBMISSIONS,
  TABLE_NAMES.REVIEWS,
  TABLE_NAMES.POINT_LEDGER,
  TABLE_NAMES.PET_PROGRESS,
  TABLE_NAMES.STREAKS,
  TABLE_NAMES.REWARDS,
  TABLE_NAMES.REDEMPTIONS,
  TABLE_NAMES.COSTUME_OWNERSHIPS,
  TABLE_NAMES.COSTUME_STATES,
  TABLE_NAMES.SETTINGS,
  TABLE_NAMES.META,
])

/** 主键字段：这三张表不是 `id` */
const PRIMARY_KEYS = Object.freeze({
  [TABLE_NAMES.SETTINGS]: "key",
  [TABLE_NAMES.META]: "key",
  [TABLE_NAMES.COSTUME_STATES]: "childId",
})

/** PIN 与恢复码相关键：导入时一律丢弃，以本机为准 */
const PIN_SETTING_KEYS = Object.freeze([
  SETTING_KEYS.PARENT_PIN_HASH,
  SETTING_KEYS.PARENT_PIN_SALT,
  SETTING_KEYS.PARENT_PIN_UPDATED_AT,
  SETTING_KEYS.PARENT_PIN_FAILED,
  SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL,
  SETTING_KEYS.PARENT_PIN_RECOVERY_HASH,
  SETTING_KEYS.PARENT_PIN_RECOVERY_SALT,
  SETTING_KEYS.PARENT_PIN_RECOVERY_UPDATED_AT,
  SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED,
  SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL,
])

const SNAPSHOT_STORAGE_KEY = "b002.preRestoreSnapshot"
const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024

/** Node 测试环境下没有 localStorage：退化为进程内快照，功能语义不变 */
const memorySnapshot = { value: null }

function primaryKeyOf(table) {
  return PRIMARY_KEYS[table] ?? "id"
}

function resolveStorage() {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    const probe = "__b002_probe__"
    storage.setItem(probe, "1")
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

function fail(message, context) {
  return new DbError(DB_ERROR_CODES.VALIDATION_FAILED, message, { context })
}

/* ---------------- 导出 ---------------- */

/**
 * 组装备份对象（不落盘、不下载，纯数据）。
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 */
export async function buildBackup({ db = getDb(), now = new Date() } = {}) {
  const data = {}
  const counts = {}
  for (const table of BACKUP_TABLES) {
    const rows = await db.table(table).toArray()
    if (table === TABLE_NAMES.META) {
      // `restoreState` 只描述"这台设备当前库的状态"，导出时统一写成 complete，
      // 避免把半成品标记带进备份文件。
      data[table] = rows.map((row) =>
        row.key === "restoreState" ? { ...row, value: "complete" } : row,
      )
    } else {
      data[table] = rows
    }
    counts[table] = rows.length
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appName: "小学生学习家庭工作台",
    exportedAt: toIsoTimestamp(now),
    counts,
    data,
  }
}

/** 备份文件名：学习工作台-备份-2026-11-21-1812.json */
export function backupFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const dateKey = toLocalDateKey(date)
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `学习工作台-备份-${dateKey}-${hh}${mm}.json`
}

/** 序列化成可下载的文本（缩进 2 空格，便于家长用记事本看一眼） */
export function serializeBackup(payload) {
  return JSON.stringify(payload, null, 2)
}

/**
 * 导出：返回 `{ payload, text, fileName, counts, bytes }`，并记下最近备份时间。
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 */
export async function exportBackup({ db = getDb(), now = new Date() } = {}) {
  try {
    const payload = await buildBackup({ db, now })
    const text = serializeBackup(payload)
    const fileName = backupFileName(now)
    const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(text).length : text.length

    await db.transaction("rw", db.settings, async () => {
      await writeSetting(SETTING_KEYS.LAST_BACKUP_AT, payload.exportedAt, { db, now })
      await writeSetting(SETTING_KEYS.LAST_BACKUP_FILE_NAME, fileName, { db, now })
      await writeSetting(SETTING_KEYS.LAST_BACKUP_VERSION, SCHEMA_VERSION, { db, now })
    })

    return { payload, text, fileName, counts: payload.counts, bytes }
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "read", context: { stage: "export" } })
  }
}

/* ---------------- 校验 ---------------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function countRecords(data) {
  const counts = {}
  for (const table of BACKUP_TABLES) counts[table] = data[table].length
  return counts
}

function totalRecords(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

/**
 * 严格校验备份内容。**只读**，不改库。
 * 校验项：
 * 1. 顶层字段：format / formatVersion / schemaVersion / data
 * 2. 表集合：必须正好是这 14 张，多一张少一张都算坏文件
 * 3. 每张表是数组，每条记录是对象且主键非空字符串、同表内不重复
 * 4. 跨表引用：任务→孩子、提交→任务、流水→孩子、收藏→孩子与申请……
 *
 * @param {unknown} payload
 * @returns {{ payload: object, counts: Record<string, number>, total: number, schemaVersion: number, exportedAt: string|null, tables: string[] }}
 */
export function validateBackupPayload(payload) {
  if (!isPlainObject(payload)) throw fail("备份内容不是一个对象")

  if (payload.format !== BACKUP_FORMAT) {
    throw fail("这个文件不是本工作台导出的备份", { format: String(payload.format ?? "") })
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(payload.formatVersion)) {
    throw fail("备份格式版本不认识，请用新版工作台打开", { formatVersion: payload.formatVersion })
  }
  if (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion < 1) {
    throw fail("备份里没有有效的 schemaVersion")
  }
  if (payload.schemaVersion > SCHEMA_VERSION) {
    throw fail(
      `备份来自更新的版本（Schema v${payload.schemaVersion}），当前应用只到 v${SCHEMA_VERSION}，请先升级应用`,
      { from: payload.schemaVersion, to: SCHEMA_VERSION },
    )
  }
  if (!isPlainObject(payload.data)) throw fail("备份里没有 data 字段")

  const incoming = Object.keys(payload.data)
  const unknown = incoming.filter((table) => !BACKUP_TABLES.includes(table))
  if (unknown.length) {
    throw fail(`备份里有不认识的表：${unknown.slice(0, 3).join("、")}`, { unknown })
  }
  const missing = BACKUP_TABLES.filter((table) => !incoming.includes(table))
  if (missing.length) {
    throw fail(`备份缺少表：${missing.slice(0, 3).join("、")}`, { missing })
  }

  for (const table of BACKUP_TABLES) {
    const rows = payload.data[table]
    if (!Array.isArray(rows)) throw fail(`表 ${table} 的内容不是数组`)
    const keyField = primaryKeyOf(table)
    const seen = new Set()
    for (const row of rows) {
      if (!isPlainObject(row)) throw fail(`表 ${table} 里有不是对象的记录`)
      const key = row[keyField]
      if (typeof key !== "string" || key.trim() === "") {
        throw fail(`表 ${table} 里有记录缺少主键 ${keyField}`)
      }
      if (seen.has(key)) throw fail(`表 ${table} 里有重复主键 ${key}`)
      seen.add(key)
    }
  }

  const children = payload.data[TABLE_NAMES.CHILDREN]
  if (children.length === 0) throw fail("备份里没有任何孩子，不像是正常的家庭数据")

  // 头像图片（M6）：只认 data:image/{jpeg,png,webp};base64。
  // 这条不只是"格式检查"——它挡住了把 `"><script>` 之类塞进 avatarImage、
  // 再借界面渲染执行的路径（备份文件可能是别人给的）。
  for (const child of children) {
    if (child.avatarImage === undefined || child.avatarImage === null || child.avatarImage === "") continue
    if (
      typeof child.avatarImage !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(child.avatarImage)
    ) {
      throw fail("有孩子的头像数据不是图片，这份备份可能被改过", { childId: child.id ?? null })
    }
  }

  const childIds = new Set(children.map((child) => child.id))
  const taskIds = new Set(payload.data[TABLE_NAMES.TASKS].map((task) => task.id))
  const redemptionIds = new Set(payload.data[TABLE_NAMES.REDEMPTIONS].map((redemption) => redemption.id))

  const requireChild = (row, table) => {
    if (typeof row.childId !== "string" || !childIds.has(row.childId)) {
      throw fail(`表 ${table} 里有记录指向不存在的孩子`, { table, childId: row.childId ?? null })
    }
  }

  // 硬引用（写错就是坏数据，必须拦住）：孩子、任务、兑换申请。
  // 软引用（允许悬空，不影响业务）：task.templateId、redemption.rewardId——
  // 固定任务模板可以被家长删除，但已经生成的任务是历史，不能因此判定备份损坏。
  for (const task of payload.data[TABLE_NAMES.TASKS]) requireChild(task, TABLE_NAMES.TASKS)
  for (const submission of payload.data[TABLE_NAMES.SUBMISSIONS]) {
    if (!taskIds.has(submission.taskId)) throw fail("有提交记录指向不存在的任务")
    requireChild(submission, TABLE_NAMES.SUBMISSIONS)
  }
  for (const review of payload.data[TABLE_NAMES.REVIEWS]) {
    if (!taskIds.has(review.taskId)) throw fail("有审核记录指向不存在的任务")
    requireChild(review, TABLE_NAMES.REVIEWS)
  }
  for (const entry of payload.data[TABLE_NAMES.POINT_LEDGER]) {
    requireChild(entry, TABLE_NAMES.POINT_LEDGER)
    if (entry.taskId && !taskIds.has(entry.taskId)) throw fail("有积分流水指向不存在的任务")
  }
  for (const entry of payload.data[TABLE_NAMES.PET_PROGRESS]) {
    requireChild(entry, TABLE_NAMES.PET_PROGRESS)
    if (entry.taskId && !taskIds.has(entry.taskId)) throw fail("有经验流水指向不存在的任务")
  }
  for (const streak of payload.data[TABLE_NAMES.STREAKS]) requireChild(streak, TABLE_NAMES.STREAKS)
  for (const redemption of payload.data[TABLE_NAMES.REDEMPTIONS]) {
    requireChild(redemption, TABLE_NAMES.REDEMPTIONS)
  }
  for (const ownership of payload.data[TABLE_NAMES.COSTUME_OWNERSHIPS]) {
    requireChild(ownership, TABLE_NAMES.COSTUME_OWNERSHIPS)
    if (typeof ownership.costumeKey !== "string" || ownership.costumeKey === "") {
      throw fail("有装扮收藏记录缺少 costumeKey")
    }
    if (ownership.sourceRedemptionId && !redemptionIds.has(ownership.sourceRedemptionId)) {
      throw fail("有装扮收藏指向不存在的兑换申请")
    }
  }
  for (const state of payload.data[TABLE_NAMES.COSTUME_STATES]) {
    requireChild(state, TABLE_NAMES.COSTUME_STATES)
  }

  const generationKeys = new Set()
  for (const task of payload.data[TABLE_NAMES.TASKS]) {
    const key = task.generationKey
    if (key === undefined || key === null || key === "") continue
    if (typeof key !== "string") throw fail("有任务的 generationKey 不是字符串")
    if (generationKeys.has(key)) throw fail("有任务重复了同一个生成键，会导致防重索引冲突", { generationKey: key })
    generationKeys.add(key)
  }

  const counts = countRecords(payload.data)
  return {
    payload,
    counts,
    total: totalRecords(counts),
    schemaVersion: payload.schemaVersion,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    tables: BACKUP_TABLES.slice(),
  }
}

/**
 * 解析文本 → 校验 → 返回预览摘要（不写库）。
 * @param {string} text
 */
export function parseBackupText(text) {
  if (typeof text !== "string" || text.trim() === "") throw fail("文件是空的")
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw fail("这个文件不是合法的 JSON，可能选错了文件")
  }
  return validateBackupPayload(payload)
}

/* ---------------- 导入前快照（可撤销） ---------------- */

/**
 * 把当前数据快照存起来，供"撤销上次导入"使用。
 * 优先 localStorage（刷新后还在）；失败或没有存储时退化为内存快照。
 */
async function savePreRestoreSnapshot(db, now = new Date()) {
  const payload = await buildBackup({ db, now })
  const text = serializeBackup(payload)
  const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(text).length : text.length
  const record = { savedAt: toIsoTimestamp(now), text, bytes, counts: payload.counts }

  if (bytes <= SNAPSHOT_MAX_BYTES) {
    const storage = resolveStorage()
    if (storage) {
      try {
        storage.setItem(SNAPSHOT_STORAGE_KEY, text)
        return { saved: "localStorage", bytes, savedAt: record.savedAt }
      } catch {
        // 配额满 / 隐私模式：继续用内存兜底
      }
    }
  }

  memorySnapshot.value = record
  return { saved: "memory", bytes, savedAt: record.savedAt }
}

/**
 * 读取导入前快照（`localStorage` 优先，其次内存）。
 * @returns {{ payload: object, savedAt: string, counts: Record<string, number>, total: number }|null}
 */
export function readPreRestoreSnapshot() {
  const storage = resolveStorage()
  if (storage) {
    try {
      const text = storage.getItem(SNAPSHOT_STORAGE_KEY)
      if (text) {
        const summary = parseBackupText(text)
        return {
          payload: summary.payload,
          savedAt: summary.exportedAt,
          counts: summary.counts,
          total: summary.total,
        }
      }
    } catch {
      // 快照坏掉就当作没有，不能让它阻塞主流程
    }
  }
  if (memorySnapshot.value) {
    try {
      const summary = parseBackupText(memorySnapshot.value.text)
      return {
        payload: summary.payload,
        savedAt: summary.exportedAt,
        counts: summary.counts,
        total: summary.total,
      }
    } catch {
      return null
    }
  }
  return null
}

/** 清掉快照（撤销成功后调用，避免误点第二次） */
export function clearPreRestoreSnapshot() {
  const storage = resolveStorage()
  if (storage) {
    try {
      storage.removeItem(SNAPSHOT_STORAGE_KEY)
    } catch {
      // 忽略
    }
  }
  memorySnapshot.value = null
}

/* ---------------- 恢复 ---------------- */

/**
 * 用备份覆盖当前库。**单事务**：清空 → 写入 → 补迁移 → 修元数据 → 保住本机 PIN。
 *
 * @param {string|object} input 备份文本或已解析的 payload
 * @param {{
 *   db?: import("dexie").default,
 *   now?: Date,
 *   skipSnapshot?: boolean,
 * }} [options]
 * @returns {Promise<{
 *   restored: Record<string, number>,
 *   total: number,
 *   fromSchemaVersion: number,
 *   migrated: boolean,
 *   snapshot: { saved: string, bytes: number, savedAt: string }|null,
 * }>}
 */
export async function restoreBackup(input, { db = getDb(), now = new Date(), skipSnapshot = false } = {}) {
  const summary = typeof input === "string" ? parseBackupText(input) : validateBackupPayload(input)
  const payload = summary.payload

  // 1) 先存快照（在清空之前，这是"后悔药"）
  let snapshot = null
  if (!skipSnapshot) {
    try {
      snapshot = await savePreRestoreSnapshot(db, now)
    } catch (error) {
      throw new DbError(DB_ERROR_CODES.TRANSACTION_FAILED, "导入前的自动备份没做成，已中止导入", {
        cause: error,
      })
    }
  }

  // 2) 记下本机 PIN（导入不改变它）
  const currentPin = await readSettings(PIN_SETTING_KEYS, db)

  const updatedAt = toIsoTimestamp(now)
  const fromSchemaVersion = payload.schemaVersion

  try {
    await db.transaction("rw", db.tables, async (tx) => {
      for (const table of BACKUP_TABLES) {
        await db.table(table).clear()
      }
      for (const table of BACKUP_TABLES) {
        const rows = payload.data[table]
        if (rows.length) await db.table(table).bulkAdd(rows)
      }

      // 3) 旧版本备份补字段：复用 v1 → v2 的防御性回填，不覆盖已有值
      if (fromSchemaVersion < 2) {
        await upgradeToV2(tx)
      }

      // 4) 元数据对齐到当前版本
      const meta = db.table(TABLE_NAMES.META)
      await meta.put({ key: "schemaVersion", value: SCHEMA_VERSION, updatedAt })
      await meta.put({ key: "restoreState", value: "complete", updatedAt })
      await meta.put({ key: "lastRestoreAt", value: updatedAt, updatedAt })
      if (!(await meta.get("createdAt"))) {
        await meta.put({ key: "createdAt", value: updatedAt, updatedAt })
      }

      // 5) PIN 以本机为准：先清掉备份里的，再写回本机原来的
      const settings = db.table(TABLE_NAMES.SETTINGS)
      for (const key of PIN_SETTING_KEYS) await settings.delete(key)
      for (const key of PIN_SETTING_KEYS) {
        const value = currentPin[key]
        if (value !== null && value !== undefined) {
          await settings.put({ key, value, updatedAt })
        }
      }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { stage: "restore" } })
  }

  return {
    restored: summary.counts,
    total: summary.total,
    fromSchemaVersion,
    migrated: fromSchemaVersion < SCHEMA_VERSION,
    snapshot,
  }
}

/**
 * 撤销上次导入：用快照把自己换回去。
 * 快照本身不再生成新快照（否则越滚越大）。
 */
export async function undoLastRestore({ db = getDb(), now = new Date() } = {}) {
  const snapshot = readPreRestoreSnapshot()
  if (!snapshot) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "没有可以撤销的导入记录")
  }
  const result = await restoreBackup(snapshot.payload, { db, now, skipSnapshot: true })
  clearPreRestoreSnapshot()
  return result
}

/**
 * 彻底删除全部家庭数据（M4 / G-05）。
 *
 * 与"导入覆盖"的区别：这里**不写入任何东西**，只把库恢复到刚建好、还没种子的状态，
 * 交给 `boot()` 重新初始化出一个干净的家庭（朵朵 + 5 条示例任务）。
 *
 * 纪律：
 * - **单事务**清空 14 张表并重写 `_meta`，中途失败整笔回滚，不会留下半个空库；
 * - `restoreState` 必须写回 `complete`，否则下次打开会被 `ensureMetadata` 判成异常库；
 * - `settings` 一并清空（PIN、恢复码、上次备份时间都算家庭数据）；
 * - 顺手清掉 `localStorage` 里的"导入前快照"——那也是一整份家庭数据，
 *   留着就等于"删了但还能一键恢复"，与用户点下删除时的预期不符；
 * - **绝不碰**用户已经下载到硬盘的 JSON 备份文件（服务层没有文件系统权限，这也是边界）。
 *
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{ wiped: Record<string, number>, total: number, wipedAt: string }>}
 */
export async function wipeAllData({ db = getDb(), now = new Date() } = {}) {
  const updatedAt = toIsoTimestamp(now)
  const wiped = {}
  let total = 0

  try {
    await db.transaction("rw", db.tables, async () => {
      for (const table of BACKUP_TABLES) {
        const count = await db.table(table).count()
        wiped[table] = count
        total += count
        await db.table(table).clear()
      }

      // 元数据重置成"刚建库"的样子，但不删行 —— 少了这几行，下次启动会被判成异常库
      const meta = db.table(TABLE_NAMES.META)
      await meta.put({ key: "schemaVersion", value: SCHEMA_VERSION, updatedAt })
      await meta.put({ key: "createdAt", value: updatedAt, updatedAt })
      await meta.put({ key: "restoreState", value: "complete", updatedAt })
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { stage: "wipe-all" } })
  }

  clearPreRestoreSnapshot()

  return { wiped, total, wipedAt: updatedAt }
}

/** 备份概览（设置页顶部用）：最近备份时间 + 是否可撤销 */
export async function backupOverview({ db = getDb() } = {}) {
  const values = await readSettings(
    [SETTING_KEYS.LAST_BACKUP_AT, SETTING_KEYS.LAST_BACKUP_FILE_NAME, SETTING_KEYS.LAST_BACKUP_VERSION],
    db,
  )
  const counts = {}
  let total = 0
  for (const table of BACKUP_TABLES) {
    const count = await db.table(table).count()
    counts[table] = count
    total += count
  }
  const snapshot = readPreRestoreSnapshot()
  return {
    lastBackupAt: values[SETTING_KEYS.LAST_BACKUP_AT] ?? null,
    lastBackupFileName: values[SETTING_KEYS.LAST_BACKUP_FILE_NAME] ?? null,
    lastBackupVersion: values[SETTING_KEYS.LAST_BACKUP_VERSION] ?? null,
    counts,
    total,
    canUndo: Boolean(snapshot),
    undoSnapshotAt: snapshot?.savedAt ?? null,
    undoSnapshotTotal: snapshot?.total ?? 0,
  }
}
