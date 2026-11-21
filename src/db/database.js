/**
 * 数据库入口（独立于 UI）
 *
 * 职责：
 * 1. 创建 / 打开 Dexie 实例并应用版本注册表；
 * 2. 首次打开时写入数据库元数据（schemaVersion / createdAt）；
 * 3. 把底层异常统一包装成 DbError。
 *
 * 明确不做（任务书范围）：
 * - 不提供任何"删库 / 清空 / 重建"入口；
 * - 打开失败绝不静默降级为空库或新建空家庭；
 * - 不做页面级初始化（页面层尚未开始）。
 */

import Dexie from "dexie"
import { DB_NAME, SCHEMA_VERSION, TABLE_NAMES } from "./schema.js"
import { applySchema } from "./migrations.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "./errors.js"
import { toIsoTimestamp } from "./date.js"

const META_TABLE = TABLE_NAMES.META

/** 浏览器是否具备 IndexedDB（不支持时由调用方进入终止态，不得假装成功） */
export function isDatabaseSupported() {
  return typeof indexedDB !== "undefined"
}

/**
 * 创建一个独立命名的家庭数据库实例（不含打开动作）。
 * 测试与未来的临时恢复库都通过该工厂创建，业务默认实例见 getDb()。
 * @param {string} [name]
 * @returns {import("dexie").default}
 */
export function createFamilyDatabase(name = DB_NAME) {
  if (!isDatabaseSupported()) {
    throw new DbError(DB_ERROR_CODES.UNSUPPORTED, "当前环境没有 IndexedDB，无法使用本地数据库")
  }
  return applySchema(new Dexie(name))
}

let defaultDatabase = null

/** 业务默认数据库实例（懒创建，避免模块导入即抛错拖垮应用外壳） */
export function getDb() {
  if (!defaultDatabase) {
    defaultDatabase = createFamilyDatabase()
  }
  return defaultDatabase
}

/** 关闭默认数据库连接（切换 / 注销 / 测试清理时使用） */
export function closeDb() {
  if (defaultDatabase) {
    defaultDatabase.close()
    defaultDatabase = null
  }
}

async function ensureMetadata(database) {
  const table = database.table(META_TABLE)
  const businessTables = database.tables.filter((candidate) => candidate.name !== META_TABLE)
  try {
    await database.transaction("rw", database.tables, async () => {
      // 必须先检查完成标记，不能给恢复了一半或来源不明的业务库补盖章。
      const restoreState = await table.get("restoreState")
      if (restoreState && restoreState.value !== "complete") {
        throw new DbError(DB_ERROR_CODES.INVALID_STATE, "库状态异常：数据库尚未完成初始化或恢复", {
          context: { dbName: database.name, restoreState: restoreState.value },
        })
      }

      if (!restoreState) {
        for (const businessTable of businessTables) {
          if ((await businessTable.count()) > 0) {
            throw new DbError(DB_ERROR_CODES.INVALID_STATE, "库状态异常：已有业务数据，但缺少完成标记", {
              context: { dbName: database.name, table: businessTable.name },
            })
          }
        }
      }

      const existingVersion = await table.get("schemaVersion")
      if (!existingVersion) {
        await table.put({ key: "schemaVersion", value: SCHEMA_VERSION, updatedAt: toIsoTimestamp() })
      } else if (existingVersion.value !== SCHEMA_VERSION) {
        // Dexie 升级成功后才走到这里（restoreState 已在上方校验为 complete），
        // 此时把 _meta.schemaVersion 对齐到当前版本；不补齐会让备份文件与诊断信息停留在旧版本。
        await table.put({ ...existingVersion, key: "schemaVersion", value: SCHEMA_VERSION, updatedAt: toIsoTimestamp() })
      }
      const existingCreatedAt = await table.get("createdAt")
      if (!existingCreatedAt) {
        await table.put({ key: "createdAt", value: toIsoTimestamp(), updatedAt: toIsoTimestamp() })
      }
      if (!restoreState) {
        await table.put({ key: "restoreState", value: "complete", updatedAt: toIsoTimestamp() })
      }
    })
  } catch (error) {
    throw wrapDbError(error, {
      phase: "open",
      context: { dbName: database.name, stage: "ensure-metadata" },
    })
  }
}

/**
 * 打开数据库并确保元数据存在。
 * 失败时抛 DbError（含 code 与调试上下文），**不会**删除或重建任何已有数据库。
 * @param {import("dexie").default} [database]
 */
export async function openDatabase(database = getDb()) {
  try {
    await database.open()
  } catch (error) {
    try {
      database.close()
    } catch {
      // 关闭失败不覆盖原始错误
    }
    throw wrapDbError(error, { phase: "open", context: { dbName: database.name } })
  }

  await ensureMetadata(database)
  return database
}

/** 读取库内记录的 Schema 版本（用于备份文件与诊断信息） */
export async function readSchemaVersion(database = getDb()) {
  const record = await database.table(META_TABLE).get("schemaVersion")
  return record?.value ?? null
}
