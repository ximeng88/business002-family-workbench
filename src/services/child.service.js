/**
 * 孩子档案服务（M1 多孩架构）。
 *
 * 纪律：
 * - `children` 表在 Schema v1 里已存在，本轮**不加字段、不升 Schema 版本**，
 *   旧库里的 `c_m0`（朵朵）可以直接沿用，不会触发迁移或重建。
 * - 孩子 id 一律新生成；不覆盖、不改写既有孩子的昵称或头像。
 * - 不设孩子数量硬上限（Q-07：按不设硬上限）。
 * - PIN 相关字段第一版不写：`hasChildPin: false`，不产生 `childPinHash`。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { makeId } from "../db/ids.js"

/** 可选头像键（纯数据枚举，具体 Emoji 由界面层映射） */
export const CHILD_AVATAR_KEYS = Object.freeze([
  "cat",
  "rabbit",
  "bear",
  "fox",
  "panda",
  "owl",
  "dino",
  "whale",
])

export const CHILD_NICKNAME_MAX_LENGTH = 12

function normalizeNickname(nickname) {
  if (typeof nickname !== "string" || nickname.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "孩子昵称不能为空", {
      context: { nickname: typeof nickname === "string" ? nickname : typeof nickname },
    })
  }
  const trimmed = nickname.trim()
  if (trimmed.length > CHILD_NICKNAME_MAX_LENGTH) {
    throw new DbError(
      DB_ERROR_CODES.VALIDATION_FAILED,
      `孩子昵称不能超过 ${CHILD_NICKNAME_MAX_LENGTH} 个字`,
      { context: { length: trimmed.length } },
    )
  }
  return trimmed
}

/**
 * 列出全部孩子（按创建时间正序）。
 * @param {import("dexie").default} [db]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function listChildren(db = getDb()) {
  try {
    const children = await db.children.toArray()
    return children.sort((a, b) => {
      const byCreatedAt = String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""))
      return byCreatedAt || String(a.id).localeCompare(String(b.id))
    })
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { table: "children" } })
  }
}

/**
 * 新增一个孩子。写库后立即返回完整记录。
 *
 * @param {{
 *   nickname: string,
 *   avatarKey?: string,
 *   now?: Date,
 *   db?: import("dexie").default,
 * }} options
 */
export async function createChild({ nickname, avatarKey = "cat", now = new Date(), db = getDb() } = {}) {
  const safeNickname = normalizeNickname(nickname)
  if (!CHILD_AVATAR_KEYS.includes(avatarKey)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "头像不在可选范围内", {
      context: { avatarKey },
    })
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }

  const child = {
    id: makeId("child"),
    nickname: safeNickname,
    avatarKey,
    hasChildPin: false,
    createdAt: toIsoTimestamp(now),
  }

  try {
    await db.children.add(child)
    return child
  } catch (error) {
    throw wrapDbError(error, { phase: "transaction", context: { childId: child.id } })
  }
}

/**
 * 读取单个孩子；不存在返回 null（不抛错，供界面决定空态）。
 * @param {string} childId
 * @param {import("dexie").default} [db]
 */
export async function getChild(childId, db = getDb()) {
  if (typeof childId !== "string" || childId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "childId 必须是非空字符串", {
      context: { childId },
    })
  }
  try {
    return (await db.children.get(childId)) ?? null
  } catch (error) {
    throw wrapDbError(error, { phase: "read", context: { childId } })
  }
}
