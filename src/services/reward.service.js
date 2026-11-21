/**
 * 奖励中心：内置模板补齐、家长改价 / 启停、自定义生活奖励。
 *
 * 规则（PRD §6.4）：
 * - 内置奖励有**不可变的模板键**与建议默认价；家庭另存自己的当前价 `cost`；
 * - 刷新、重进、重启、重复 Seed 只能补缺失配置，**不得覆盖**已有 `cost` / `enabled` / 家长编辑内容；
 * - 家长可改积分、可停用；停用只阻止新申请，不删除申请、流水与装扮收藏；
 * - 自定义奖励只做生活奖励，必须显式填积分，不继承任何默认价；
 * - 本版不提供删除入口（Q-13：无库存、无限兑、无删除）。
 *
 * 唯一索引纪律：`rewards` 有 `&templateKey`。
 * 内置奖励写模板键；自定义奖励**不写该属性**（不是 ""、null 或 undefined），
 * 因为空字符串是合法键值，第二个自定义奖励就会撞键。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"
import { COSTUME_CATALOG } from "./costume.service.js"

export const REWARD_SOURCE = Object.freeze({
  BUILTIN: "builtin",
  CUSTOM: "custom",
})

export const REWARD_CATEGORY = Object.freeze({
  LIFE: "life",
  COSTUME: "costume",
})

export const REWARD_CATEGORY_LABEL = Object.freeze({
  life: "生活奖励",
  costume: "宠物装扮",
})

export const REWARD_NAME_MAX_LENGTH = 12
export const REWARD_DESCRIPTION_MAX_LENGTH = 20
export const REWARD_COST_MIN = 1
export const REWARD_COST_MAX = 999

/** 自定义奖励可选的系统内置图标（不引入外部图标依赖） */
export const REWARD_ICON_KEYS = Object.freeze([
  "sparkle",
  "star",
  "trophy",
  "book",
  "music",
  "palette",
  "flame",
  "calendar",
  "sun",
  "moon",
  "clock",
  "paw",
])

const LIFE_TEMPLATES = [
  {
    templateKey: "life_play15",
    name: "额外玩 15 分钟",
    description: "自己安排这 15 分钟",
    iconKey: "clock",
    defaultCost: 20,
  },
  {
    templateKey: "life_cartoon",
    name: "看一集动画片",
    description: "挑一集最想看的",
    iconKey: "moon",
    defaultCost: 30,
  },
  {
    templateKey: "life_park",
    name: "周末去公园",
    description: "带上滑板车出门",
    iconKey: "sun",
    defaultCost: 50,
  },
  {
    templateKey: "life_gift",
    name: "选择一份小礼物",
    description: "和家长一起挑",
    iconKey: "sparkle",
    defaultCost: 60,
  },
  {
    templateKey: "life_book",
    name: "购买一本喜欢的书",
    description: "去书店自己选",
    iconKey: "book",
    defaultCost: 80,
  },
  {
    templateKey: "life_family",
    name: "选择一次家庭活动",
    description: "周末做什么你决定",
    iconKey: "trophy",
    defaultCost: 100,
  },
]

const COSTUME_TEMPLATES = COSTUME_CATALOG.map((costume) => ({
  templateKey: `costume_${costume.costumeKey}`,
  name: costume.name,
  description: costume.description,
  iconKey: "star",
  defaultCost: costume.defaultCost,
  costumeKey: costume.costumeKey,
}))

/**
 * 11 个内置模板（6 个生活奖励 + 5 个宠物装扮）。
 * `defaultCost` 只是首次启用的建议价，不是固定价格。
 */
export const BUILTIN_REWARD_TEMPLATES = Object.freeze(
  [
    ...LIFE_TEMPLATES.map((template) =>
      Object.freeze({
        ...template,
        category: REWARD_CATEGORY.LIFE,
        id: `rw_${template.templateKey}`,
      }),
    ),
    ...COSTUME_TEMPLATES.map((template) =>
      Object.freeze({
        ...template,
        category: REWARD_CATEGORY.COSTUME,
        id: `rw_${template.templateKey}`,
      }),
    ),
  ].map((template) => Object.freeze(template)),
)

export const BUILTIN_REWARD_COUNT = BUILTIN_REWARD_TEMPLATES.length

function assertRewardId(rewardId) {
  if (typeof rewardId !== "string" || rewardId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "rewardId 必须是非空字符串", { context: { rewardId } })
  }
}

function normalizeName(name) {
  const trimmed = typeof name === "string" ? name.trim() : ""
  if (!trimmed) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "奖励名称不能为空", { context: { name } })
  }
  if (trimmed.length > REWARD_NAME_MAX_LENGTH) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `奖励名称不能超过 ${REWARD_NAME_MAX_LENGTH} 字`, {
      context: { length: trimmed.length },
    })
  }
  return trimmed
}

function normalizeDescription(description) {
  const trimmed = typeof description === "string" ? description.trim() : ""
  if (trimmed.length > REWARD_DESCRIPTION_MAX_LENGTH) {
    throw new DbError(
      DB_ERROR_CODES.VALIDATION_FAILED,
      `奖励说明不能超过 ${REWARD_DESCRIPTION_MAX_LENGTH} 字`,
      { context: { length: trimmed.length } },
    )
  }
  return trimmed
}

function normalizeCost(cost) {
  if (!Number.isInteger(cost) || cost < REWARD_COST_MIN || cost > REWARD_COST_MAX) {
    throw new DbError(
      DB_ERROR_CODES.VALIDATION_FAILED,
      `积分必须是 ${REWARD_COST_MIN}–${REWARD_COST_MAX} 的整数`,
      { context: { cost } },
    )
  }
  return cost
}

function normalizeIconKey(iconKey) {
  if (iconKey === undefined || iconKey === null || iconKey === "") return "sparkle"
  if (!REWARD_ICON_KEYS.includes(iconKey)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "未知的奖励图标", { context: { iconKey } })
  }
  return iconKey
}

/**
 * 幂等补齐 11 个内置奖励的家庭配置。
 *
 * - 按 `templateKey` 查，缺失才写；已有记录**一个字段都不改**；
 * - 不覆盖家长改过的价格、启停或编辑内容；
 * - 返回新增数量，便于启动日志与测试断言。
 *
 * @returns {Promise<{ added: number, total: number }>}
 */
export async function ensureBuiltinRewardConfigs(db = getDb()) {
  const now = toIsoTimestamp()
  try {
    return await db.transaction("rw", db.rewards, async () => {
      let added = 0
      for (const template of BUILTIN_REWARD_TEMPLATES) {
        const existing =
          (await db.rewards.where("templateKey").equals(template.templateKey).first()) ??
          (await db.rewards.get(template.id))
        if (existing) continue

        await db.rewards.add({
          id: template.id,
          source: REWARD_SOURCE.BUILTIN,
          templateKey: template.templateKey,
          category: template.category,
          name: template.name,
          description: template.description,
          iconKey: template.iconKey,
          // 建议默认价只作对照，家庭当前价从同一初始值起步
          defaultCost: template.defaultCost,
          cost: template.defaultCost,
          enabled: true,
          ...(template.costumeKey ? { costumeKey: template.costumeKey } : {}),
          createdAt: now,
          updatedAt: now,
        })
        added += 1
      }

      const total = await db.rewards.count()
      return { added, total }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { stage: "seed-rewards" } })
  }
}

/**
 * 读取奖励清单。
 * @param {{ category?: "life"|"costume", enabledOnly?: boolean, includeCostume?: boolean }} [options]
 */
export async function listRewards({ category, enabledOnly = false, db = getDb() } = {}) {
  try {
    let rows = await db.rewards.toArray()
    if (category) rows = rows.filter((row) => row.category === category)
    if (enabledOnly) rows = rows.filter((row) => row.enabled !== false)

    const categoryOrder = { life: 0, costume: 1 }
    const sourceOrder = { builtin: 0, custom: 1 }
    const templateOrder = new Map(BUILTIN_REWARD_TEMPLATES.map((item, index) => [item.templateKey, index]))

    return rows.sort((a, b) => {
      const byCategory = (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9)
      if (byCategory) return byCategory
      const bySource = (sourceOrder[a.source] ?? 9) - (sourceOrder[b.source] ?? 9)
      if (bySource) return bySource
      const byTemplate = (templateOrder.get(a.templateKey) ?? 99) - (templateOrder.get(b.templateKey) ?? 99)
      if (byTemplate) return byTemplate
      return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { category } })
  }
}

/** @param {string} rewardId */
export async function getReward(rewardId, db = getDb()) {
  assertRewardId(rewardId)
  const reward = await db.rewards.get(rewardId)
  return reward ?? null
}

/**
 * 新增自定义生活奖励。必须显式给积分，不继承任何内置默认价。
 *
 * @param {{ name: string, cost: number, description?: string, iconKey?: string }} input
 */
export async function createCustomReward({ name, cost, description = "", iconKey = "sparkle", db = getDb() } = {}) {
  const record = {
    id: makeId("rw"),
    source: REWARD_SOURCE.CUSTOM,
    category: REWARD_CATEGORY.LIFE,
    name: normalizeName(name),
    description: normalizeDescription(description),
    iconKey: normalizeIconKey(iconKey),
    cost: normalizeCost(cost),
    enabled: true,
    createdAt: toIsoTimestamp(),
    updatedAt: toIsoTimestamp(),
    // 注意：没有 templateKey / costumeKey 属性，见文件头唯一索引说明
  }

  try {
    await db.rewards.add(record)
    return record
  } catch (error) {
    throw wrapDbError(error, { phase: "write", context: { rewardId: record.id } })
  }
}

/**
 * 修改奖励。
 *
 * - 内置奖励只能改 `cost`；名称、说明、图标与素材键由系统维护，传了会被拒绝；
 * - 自定义奖励可改名称、说明、图标与积分；
 * - 只影响之后的展示与新申请，**不回改**既有申请（申请用快照）。
 *
 * @param {{ rewardId: string, cost?: number, name?: string, description?: string, iconKey?: string }} input
 */
export async function updateReward({ rewardId, cost, name, description, iconKey, db = getDb() } = {}) {
  assertRewardId(rewardId)

  try {
    return await db.transaction("rw", db.rewards, async () => {
      const reward = await db.rewards.get(rewardId)
      if (!reward) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "奖励不存在", { context: { rewardId } })
      }

      const next = { ...reward }
      if (cost !== undefined) next.cost = normalizeCost(cost)

      if (reward.source === REWARD_SOURCE.BUILTIN) {
        const touched = [name, description, iconKey].some((value) => value !== undefined)
        if (touched) {
          throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "内置奖励只能修改积分和启停状态", {
            context: { rewardId },
          })
        }
      } else {
        if (name !== undefined) next.name = normalizeName(name)
        if (description !== undefined) next.description = normalizeDescription(description)
        if (iconKey !== undefined) next.iconKey = normalizeIconKey(iconKey)
      }

      next.updatedAt = toIsoTimestamp()
      await db.rewards.put(next)
      return next
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { rewardId } })
  }
}

/**
 * 启用 / 停用奖励。停用只阻止新申请，不影响待审核申请、历史记录、积分流水与已拥有装扮。
 *
 * @param {{ rewardId: string, enabled: boolean }} input
 */
export async function setRewardEnabled({ rewardId, enabled, db = getDb() } = {}) {
  assertRewardId(rewardId)
  if (typeof enabled !== "boolean") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "enabled 必须是布尔值", { context: { enabled } })
  }

  try {
    return await db.transaction("rw", db.rewards, async () => {
      const reward = await db.rewards.get(rewardId)
      if (!reward) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "奖励不存在", { context: { rewardId } })
      }
      const next = { ...reward, enabled, updatedAt: toIsoTimestamp() }
      await db.rewards.put(next)
      return next
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { rewardId, enabled } })
  }
}
