/**
 * 家庭设置（键值表）读写封装（M3）。
 *
 * 为什么不需要新表 / 新字段：
 * `settings` 在 Schema **v1** 就已声明为 `settings: "key"` 的键值表，
 * 注释里也预留了 `parentPinHash` / `parentPinSalt` / `lastBackupAt` 等键。
 * 因此存 PIN 与备份时间只是"往预留的键值表里写行"，**零结构变更**，
 * 不需要 v3，老库直接可用。
 *
 * 纪律：
 * - 只存哈希与盐，**永不存明文 PIN**；
 * - 读不到就是"没有配置"，不补默认值、不造空行；
 * - 所有写操作都带 `updatedAt`，便于诊断。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"

/** 已使用的设置键（新增键必须在这里登记，避免散落的字符串常量） */
export const SETTING_KEYS = Object.freeze({
  PARENT_PIN_HASH: "parentPinHash",
  PARENT_PIN_SALT: "parentPinSalt",
  PARENT_PIN_UPDATED_AT: "parentPinUpdatedAt",
  PARENT_PIN_FAILED: "parentPinFailedCount",
  PARENT_PIN_LOCKED_UNTIL: "parentPinLockedUntil",
  /** M4：恢复码（忘记 PIN 时凭它重置），同样只存加盐摘要 */
  PARENT_PIN_RECOVERY_HASH: "parentPinRecoveryHash",
  PARENT_PIN_RECOVERY_SALT: "parentPinRecoverySalt",
  PARENT_PIN_RECOVERY_UPDATED_AT: "parentPinRecoveryUpdatedAt",
  PARENT_PIN_RECOVERY_FAILED: "parentPinRecoveryFailedCount",
  PARENT_PIN_RECOVERY_LOCKED_UNTIL: "parentPinRecoveryLockedUntil",
  LAST_BACKUP_AT: "lastBackupAt",
  LAST_BACKUP_FILE_NAME: "lastBackupFileName",
  LAST_BACKUP_VERSION: "lastBackupVersion",
})

/**
 * 读取单个设置值；不存在返回 null（不写默认值）。
 * @param {string} key
 * @param {import("dexie").default} [db]
 */
export async function readSetting(key, db = getDb()) {
  if (typeof key !== "string" || key === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "设置键必须是非空字符串", { context: { key } })
  }
  try {
    const record = await db.settings.get(key)
    return record === undefined ? null : (record.value ?? null)
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { table: "settings", key } })
  }
}

/**
 * 批量读取，一次 `bulkGet`，避免多次往返。
 * @param {string[]} keys
 * @param {import("dexie").default} [db]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readSettings(keys, db = getDb()) {
  const list = Array.isArray(keys) ? keys.filter((key) => typeof key === "string" && key !== "") : []
  if (!list.length) return {}
  try {
    const records = await db.settings.bulkGet(list)
    const result = {}
    list.forEach((key, index) => {
      const record = records[index]
      result[key] = record === undefined ? null : (record.value ?? null)
    })
    return result
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { table: "settings", count: list.length } })
  }
}

/**
 * 写入一个设置值（覆盖）。
 * 在事务中调用时沿用当前事务，不需要额外包裹。
 * @param {string} key
 * @param {unknown} value
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 */
export async function writeSetting(key, value, { db = getDb(), now = new Date() } = {}) {
  if (typeof key !== "string" || key === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "设置键必须是非空字符串", { context: { key } })
  }
  try {
    await db.settings.put({ key, value, updatedAt: toIsoTimestamp(now) })
    return value
  } catch (error) {
    throw wrapDbError(error, { phase: "write", context: { table: "settings", key } })
  }
}

/**
 * 删除一个设置键。键本来就不存在时静默成功（幂等）。
 * @param {string} key
 * @param {import("dexie").default} [db]
 */
export async function deleteSetting(key, db = getDb()) {
  try {
    await db.settings.delete(key)
  } catch (error) {
    throw wrapDbError(error, { phase: "write", context: { table: "settings", key } })
  }
}
