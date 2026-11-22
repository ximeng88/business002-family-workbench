/**
 * 孩子档案服务（M1 多孩架构 / M6 资料可改）。
 *
 * 纪律：
 * - `children` 表在 Schema v1 里已存在，M6 只**追加两个可空字段**：
 *   `avatarImage`（dataURL 字符串）与 `petKey`（物种枚举）。
 *   Dexie 不校验未声明字段，加可空字段**不需要升 Schema 版本、不需要迁移**，
 *   旧库里没有这两个字段的孩子照常显示（缺省按预设头像 / 小猫）。
 * - 孩子 id 一律新生成；不覆盖、不改写既有孩子的昵称或头像。
 * - 不设孩子数量硬上限（Q-07：按不设硬上限）。
 * - PIN 相关字段第一版不写：`hasChildPin: false`，不产生 `childPinHash`。
 * - 改昵称 / 头像 / 宠物**不写积分、不写经验、不触发 PIN**（改的是长相，不是钱）。
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

/**
 * 可选宠物种类（M6）。
 * 缺省值用 `cat`：老数据没有 `petKey` 时按小猫显示，**不批量回填**。
 */
export const CHILD_PET_KEYS = Object.freeze(["cat", "bear", "rabbit", "dog", "fox"])
export const CHILD_PET_DEFAULT = "cat"

/**
 * 头像图片（dataURL）长度上限。
 *
 * 256×256 JPEG q0.82 实测 15–40KB，base64 后 20–55KB。留到 400KB 是防呆：
 * 万一某台设备导出了未压缩的图，也不会把 `children` 单行撑到几 MB、拖慢每次启动。
 */
export const CHILD_AVATAR_IMAGE_MAX_CHARS = 400 * 1024

const AVATAR_IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

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
 * 校验头像图片。
 * - `null` / `""` 表示"恢复默认"，是合法输入；
 * - 其它必须是 dataURL（**不能**是 `blob:` URL：那是临时地址，刷新就失效，
 *   备份里存下来更是一串废字符串）。
 */
function normalizeAvatarImage(avatarImage) {
  if (avatarImage === null || avatarImage === "") return null
  if (typeof avatarImage !== "string") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "头像图片格式不对", { context: { type: typeof avatarImage } })
  }
  if (!AVATAR_IMAGE_PATTERN.test(avatarImage)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "头像图片必须是 data:image/... 的图片数据", {
      context: { prefix: avatarImage.slice(0, 24) },
    })
  }
  if (avatarImage.length > CHILD_AVATAR_IMAGE_MAX_CHARS) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "头像图片太大了，重新选一张小一点的", {
      context: { length: avatarImage.length, limit: CHILD_AVATAR_IMAGE_MAX_CHARS },
    })
  }
  return avatarImage
}

function assertPetKey(petKey) {
  if (!CHILD_PET_KEYS.includes(petKey)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "宠物不在可选范围内", { context: { petKey } })
  }
  return petKey
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

/**
 * 更新孩子资料（M6）：昵称 / 预设头像 / 上传头像 / 宠物种类。
 *
 * 设计约束（`design/03` IR-42、`design/07` §7.1）：
 * - **只改传进来的字段**，没传的保持原值；`undefined` = 不改，`null` = 清空；
 * - `avatarKey` 与 `avatarImage` 是**两个字段**：上传照片时保留 `avatarKey`，
 *   它才是"恢复默认"的落点；恢复默认只删 `avatarImage`，不动 `avatarKey`
 *   （除非同一次调用里显式给了新的 `avatarKey`）；
 * - 先校验再进事务：校验不过时库一个字节都不动；
 * - 单事务读改写，避免两次点击互相覆盖；
 * - 不写 `pointLedger` / `petProgress` / `streaks` —— 改资料不影响成长与连续天数。
 *
 * @param {{
 *   childId: string,
 *   nickname?: string,
 *   avatarKey?: string,
 *   avatarImage?: string|null,
 *   petKey?: string,
 *   db?: import("dexie").default,
 * }} input
 * @returns {Promise<Record<string, unknown>>} 更新后的完整孩子记录
 */
export async function updateChildProfile({
  childId,
  nickname,
  avatarKey,
  avatarImage,
  petKey,
  db = getDb(),
} = {}) {
  if (typeof childId !== "string" || childId.trim() === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "childId 必须是非空字符串", {
      context: { childId },
    })
  }

  const hasNickname = nickname !== undefined
  const hasAvatarKey = avatarKey !== undefined
  const hasAvatarImage = avatarImage !== undefined
  const hasPetKey = petKey !== undefined

  if (!hasNickname && !hasAvatarKey && !hasAvatarImage && !hasPetKey) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "没有要修改的内容")
  }

  const nextNickname = hasNickname ? normalizeNickname(nickname) : null
  if (hasAvatarKey && !CHILD_AVATAR_KEYS.includes(avatarKey)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "头像不在可选范围内", {
      context: { avatarKey },
    })
  }
  const nextAvatarImage = hasAvatarImage ? normalizeAvatarImage(avatarImage) : undefined
  const nextPetKey = hasPetKey ? assertPetKey(petKey) : null

  try {
    return await db.transaction("rw", db.children, async () => {
      const child = await db.children.get(childId)
      if (!child) {
        throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "这个孩子不存在", { context: { childId } })
      }

      const next = { ...child }
      if (hasNickname) next.nickname = nextNickname
      if (hasAvatarKey) next.avatarKey = avatarKey
      if (hasAvatarImage) {
        if (nextAvatarImage === null) delete next.avatarImage
        else next.avatarImage = nextAvatarImage
      }
      if (hasPetKey) next.petKey = nextPetKey

      await db.children.put(next)
      return next
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "transaction", context: { childId } })
  }
}
