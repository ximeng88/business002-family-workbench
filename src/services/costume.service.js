/**
 * 宠物装扮：系统内置目录 + 孩子收藏 / 穿戴。
 *
 * 边界（PRD §7.4）：
 * - 装扮只用系统内嵌 SVG 素材，不支持上传、编辑或购买；
 * - 只有家长确认兑换（同一事务）才写入收藏，未拥有不能正式穿戴；
 * - 每个类别（slot）最多穿戴一件，不同类别可共存；
 * - 穿戴 / 卸下**不写** pointLedger / petProgress，不改经验、等级或连续记录；
 * - 收藏与穿戴一律按 childId 隔离。
 *
 * 目录是代码内只读常量，不入库：`rewards` 里只存家庭自己的价格与启停，
 * 名称 / 类别 / 素材键由系统维护，家长不能改。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"

export const COSTUME_SLOT = Object.freeze({
  HAT: "hat",
  GLASSES: "glasses",
  SCARF: "scarf",
  OUTFIT: "outfit",
  BACKGROUND: "background",
})

/** 穿戴顺序与展示顺序一致：帽子 → 眼镜 → 围巾 → 服饰 → 背景 */
export const COSTUME_SLOTS = Object.freeze([
  COSTUME_SLOT.HAT,
  COSTUME_SLOT.GLASSES,
  COSTUME_SLOT.SCARF,
  COSTUME_SLOT.OUTFIT,
  COSTUME_SLOT.BACKGROUND,
])

export const COSTUME_SLOT_LABEL = Object.freeze({
  hat: "帽子",
  glasses: "眼镜",
  scarf: "围巾",
  outfit: "服饰",
  background: "背景",
})

/**
 * 系统装扮目录（只读）。`defaultCost` 只是首次启用的建议价，
 * 与 PRD §6.4 表格一致；家庭实际价存在 `rewards.cost`。
 */
export const COSTUME_CATALOG = Object.freeze([
  Object.freeze({
    costumeKey: "hat_straw",
    slot: COSTUME_SLOT.HAT,
    name: "小草帽",
    description: "夏天出门戴的小草帽",
    assetKey: "costume_hat_straw",
    defaultCost: 20,
  }),
  Object.freeze({
    costumeKey: "glasses_round",
    slot: COSTUME_SLOT.GLASSES,
    name: "圆框眼镜",
    description: "看起来很有学问",
    assetKey: "costume_glasses_round",
    defaultCost: 25,
  }),
  Object.freeze({
    costumeKey: "scarf_knit",
    slot: COSTUME_SLOT.SCARF,
    name: "小围巾",
    description: "软软的一条针织围巾",
    assetKey: "costume_scarf_knit",
    defaultCost: 30,
  }),
  Object.freeze({
    costumeKey: "outfit_vest",
    slot: COSTUME_SLOT.OUTFIT,
    name: "小背心",
    description: "蓝色的小马甲",
    assetKey: "costume_outfit_vest",
    defaultCost: 40,
  }),
  Object.freeze({
    costumeKey: "bg_starry",
    slot: COSTUME_SLOT.BACKGROUND,
    name: "星空背景",
    description: "把团团的窝换成星空",
    assetKey: "costume_bg_starry",
    defaultCost: 50,
  }),
])

export const COSTUME_KEYS = Object.freeze(COSTUME_CATALOG.map((item) => item.costumeKey))

/** @param {string} costumeKey */
export function getCostume(costumeKey) {
  return COSTUME_CATALOG.find((item) => item.costumeKey === costumeKey) ?? null
}

function assertChildId(childId) {
  if (typeof childId !== "string" || childId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "childId 必须是非空字符串", { context: { childId } })
  }
}

function assertSlot(slot) {
  if (!COSTUME_SLOTS.includes(slot)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `slot 必须是 ${COSTUME_SLOTS.join("/")} 之一`, {
      context: { slot },
    })
  }
}

/**
 * 该孩子的收藏与当前穿戴。
 *
 * @param {string} childId
 * @returns {Promise<{
 *   childId: string,
 *   owned: Array<Record<string, unknown>>,
 *   ownedKeys: string[],
 *   worn: Record<string, string>,
 *   bySlot: Record<string, Array<Record<string, unknown>>>
 * }>}
 */
export async function listCostumeCollection(childId, db = getDb()) {
  assertChildId(childId)
  try {
    const [owned, state] = await Promise.all([
      db.petCostumeOwnerships.where("childId").equals(childId).toArray(),
      db.petCostumeStates.get(childId),
    ])

    const worn = {}
    if (state) {
      for (const slot of COSTUME_SLOTS) {
        if (typeof state[slot] === "string" && state[slot]) worn[slot] = state[slot]
      }
    }

    // 按目录顺序稳定排序，界面不依赖库里的插入顺序
    const order = new Map(COSTUME_CATALOG.map((item, index) => [item.costumeKey, index]))
    const sorted = [...owned].sort(
      (a, b) => (order.get(a.costumeKey) ?? 99) - (order.get(b.costumeKey) ?? 99),
    )

    const bySlot = {}
    for (const slot of COSTUME_SLOTS) bySlot[slot] = []
    for (const record of sorted) {
      const costume = getCostume(record.costumeKey)
      if (costume) bySlot[costume.slot].push({ ...record, costume })
    }

    return {
      childId,
      owned: sorted,
      ownedKeys: sorted.map((record) => record.costumeKey),
      worn,
      bySlot,
    }
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId } })
  }
}

/**
 * 穿戴一件已拥有的装扮。同类别自动替换（只改该 slot，其它 slot 不动）。
 *
 * @param {{ childId: string, costumeKey: string, now?: Date, db?: import("dexie").default }} options
 * @returns {Promise<{ childId: string, slot: string, costumeKey: string, worn: Record<string, string> }>}
 */
export async function equipCostume({ childId, costumeKey, now = new Date(), db = getDb() } = {}) {
  assertChildId(childId)
  const costume = getCostume(costumeKey)
  if (!costume) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "未知的装扮", { context: { costumeKey } })
  }
  const updatedAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.petCostumeStates, db.petCostumeOwnerships, async () => {
      // 未拥有不得穿戴：校验必须在本孩子范围内，不能因为别的孩子有就放行
      const ownership = await db.petCostumeOwnerships
        .where("[childId+costumeKey]")
        .equals([childId, costume.costumeKey])
        .first()
      if (!ownership) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "还没有这个装扮，不能穿戴", {
          context: { childId, costumeKey },
        })
      }

      const current = (await db.petCostumeStates.get(childId)) ?? { childId }
      const next = { ...current, childId, [costume.slot]: costume.costumeKey, updatedAt }
      await db.petCostumeStates.put(next)

      const worn = {}
      for (const slot of COSTUME_SLOTS) {
        if (typeof next[slot] === "string" && next[slot]) worn[slot] = next[slot]
      }
      return { childId, slot: costume.slot, costumeKey: costume.costumeKey, worn }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId, costumeKey } })
  }
}

/**
 * 卸下某个类别的装扮。本来就没穿就什么都不写（幂等）。
 *
 * @param {{ childId: string, slot: string, now?: Date, db?: import("dexie").default }} options
 */
export async function unequipCostume({ childId, slot, now = new Date(), db = getDb() } = {}) {
  assertChildId(childId)
  assertSlot(slot)
  const updatedAt = toIsoTimestamp(now)

  try {
    return await db.transaction("rw", db.petCostumeStates, async () => {
      const current = await db.petCostumeStates.get(childId)
      if (!current || typeof current[slot] !== "string" || !current[slot]) {
        const worn = {}
        for (const key of COSTUME_SLOTS) {
          if (typeof current?.[key] === "string" && current[key]) worn[key] = current[key]
        }
        return { childId, slot, changed: false, worn }
      }

      const next = { ...current, updatedAt }
      delete next[slot]
      await db.petCostumeStates.put(next)

      const worn = {}
      for (const key of COSTUME_SLOTS) {
        if (typeof next[key] === "string" && next[key]) worn[key] = next[key]
      }
      return { childId, slot, changed: true, worn }
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId, slot } })
  }
}

/**
 * 内部用：在事务里给某个孩子写一条收藏。只允许兑换确认事务调用。
 * @param {import("dexie").default} db
 */
export async function addOwnershipInTransaction(db, { childId, costumeKey, sourceRedemptionId, acquiredAt }) {
  const ownership = {
    id: makeId("own"),
    childId,
    costumeKey,
    sourceRedemptionId,
    acquiredAt,
  }
  await db.petCostumeOwnerships.add(ownership)
  return ownership
}
