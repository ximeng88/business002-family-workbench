/**
 * Dexie 版本迁移注册
 *
 * 规则（任务书 + tech 方案）：
 * 1. 用 Dexie 原生版本机制，每次结构变化 **新增版本号** 并附 upgrade 逻辑；
 * 2. 已发布版本号不得修改或复用；
 * 3. 不得通过删库解决 Schema 冲突；
 * 4. 升级失败由 database.js 统一包装为 DB_UPGRADE_FAILED，不静默降级；
 * 5. 迁移只做"补"：不删表、不删字段、不清空业务数据，任一步抛错整库回滚到旧版本。
 *
 * 说明：升级函数集中在本文件的 UPGRADES 表里按版本号注册，
 * schema.js 只负责声明 stores（表结构与索引）。
 */

import { SCHEMA_VERSIONS } from "./schema.js"
import { DbError, DB_ERROR_CODES } from "./errors.js"

/** 把迁移函数包一层，保证"迁移代码失败"被明确标记为升级失败，而不是普通打开失败 */
function wrapUpgrade(upgrade, version) {
  return async (tx) => {
    try {
      return await upgrade(tx)
    } catch (error) {
      if (error instanceof DbError) throw error
      throw new DbError(DB_ERROR_CODES.UPGRADE_FAILED, `数据库升级到 v${version} 失败`, {
        cause: error,
        context: { targetVersion: version },
      })
    }
  }
}

const FALLBACK_ISO = () => new Date().toISOString()

/**
 * v1 → v2：奖励与兑换扩字段，新增装扮收藏 / 穿戴两表。
 *
 * 为什么这段迁移几乎不做事：
 * - v1 从未提供奖励管理或兑换入口，正常用户库里 `rewards` / `redemptions` 是空表；
 * - 新增的两张表由 Dexie 按 stores 自动建好，无需手写建表；
 * - 因此迁移的价值在于**防御**：即使用户库里存在来历不明的旧记录（未来版本回滚、
 *   手工导入的备份），也不能因为缺字段让界面崩掉，更不能清空。
 *
 * 纪律：
 * - 只补缺省值，**不覆盖**已有的 `cost` / `enabled` / `name`；
 * - 自定义奖励必须删掉 `templateKey` 属性（写空串会撞 `&templateKey` 唯一索引）；
 * - 旧奖励若没有 `source`，按"自定义生活奖励"处理，避免冒充内置模板绕过去重逻辑。
 */
export async function upgradeToV2(tx) {
  await tx
    .table("rewards")
    .toCollection()
    .modify((reward) => {
      if (!reward.source) reward.source = "custom"
      if (!reward.category) reward.category = "life"
      if (!reward.name) reward.name = "未命名奖励"
      if (!Number.isInteger(reward.cost) || reward.cost < 0) {
        reward.cost = Number.isInteger(reward.defaultCost) && reward.defaultCost >= 0 ? reward.defaultCost : 0
      }
      if (reward.enabled === undefined) reward.enabled = true
      if (!reward.createdAt) reward.createdAt = FALLBACK_ISO()
      if (!reward.updatedAt) reward.updatedAt = reward.createdAt
      if (reward.source === "custom") {
        // 唯一索引不吃 undefined，但吃空字符串：必须让属性彻底不存在
        delete reward.templateKey
        delete reward.costumeKey
      }
    })

  await tx
    .table("redemptions")
    .toCollection()
    .modify((redemption) => {
      if (!redemption.status) redemption.status = "pending"
      if (!redemption.requestedAt) redemption.requestedAt = redemption.createdAt ?? FALLBACK_ISO()
      if (!redemption.rewardNameSnapshot) redemption.rewardNameSnapshot = "奖励"
      if (!redemption.categorySnapshot) redemption.categorySnapshot = "life"
      if (!Number.isInteger(redemption.costSnapshot) || redemption.costSnapshot < 0) {
        redemption.costSnapshot = 0
      }
    })
}

/** 版本号 → 升级函数。没有条目表示该版本只加表/改索引，不需要搬数据。 */
const UPGRADES = Object.freeze({
  2: upgradeToV2,
})

/**
 * 把版本注册表应用到 Dexie 实例。
 * @param {import("dexie").default} db Dexie 实例
 * @param {ReadonlyArray<{ version: number, stores: Record<string, string>, upgrade?: (tx: any) => unknown }>} [versions]
 * @returns {import("dexie").default}
 */
export function applySchema(db, versions = SCHEMA_VERSIONS) {
  for (const entry of versions) {
    const versionSpec = db.version(entry.version).stores(entry.stores)
    const upgrade = typeof entry.upgrade === "function" ? entry.upgrade : UPGRADES[entry.version]
    if (typeof upgrade === "function") {
      versionSpec.upgrade(wrapUpgrade(upgrade, entry.version))
    }
  }
  return db
}
