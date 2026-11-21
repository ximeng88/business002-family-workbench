/**
 * 家长 PIN（M3）+ 恢复码（M4）：从孩子端切到家长端的门控，以及"忘了 PIN 怎么回来"。
 *
 * 定位（任务书 §二·任务 1）：
 * - 这是**防误触**，不是安全边界。纯前端无法防篡改，孩子清掉站点数据就能绕过；
 * - 因此不做密钥派生、只做"加盐 + 多轮混合"的不可逆摘要，
 *   目的是不把 4 位数字与恢复码明文留在 IndexedDB 里，而不是抵御离线爆破。
 *
 * 数据落点（**不需要 Schema v3**）：
 * - `settings` 在 v1 就是 `settings: "key"` 的键值表，并预留了
 *   `parentPinHash` / `parentPinSalt`。本轮只是往预留位置写行。
 *
 * 规则：
 * - PIN 为 4 位数字；恢复码为 8 位大写字母数字（形如 `A1B2-C3D4`）；
 * - 未设置时默认放行（老用户不被拦），家长端只提示"建议设置"；
 * - 连续 5 次输错锁定 60 秒（防止孩子坐在那儿一个个试）；
 * - 修改 / 关闭 PIN 必须验证当前 PIN，否则孩子自己就能关掉这条门；
 * - **M4 恢复码**：首次设置 PIN 时生成并只返回一次明文；凭恢复码可重置 PIN，
 *   重置成功后旧码立刻作废、同时生成新码（同样只返回一次）；
 * - 恢复码失败计数与 PIN 失败计数**分开记**，避免"猜恢复码"把家长自己的 PIN 输错次数顶满；
 * - 会话状态**不入库**：由 `store.js` 放在内存里，刷新即失效。
 *
 * 物理边界：恢复码明文只存在家长手里。若这台设备丢了恢复码、又忘了 PIN，
 * 纯本地架构下没有任何后门可以救回来（界面上必须写清楚这句免责声明）。
 */

import { getDb } from "../db/database.js"
import { DbError, DB_ERROR_CODES, wrapDbError } from "../db/errors.js"
import { toIsoTimestamp } from "../db/date.js"
import { SETTING_KEYS, readSettings, writeSetting, deleteSetting } from "./settings.service.js"

export const PIN_LENGTH = 4
export const PIN_MAX_ATTEMPTS = 5
export const PIN_LOCK_MS = 60_000

export const PIN_PATTERN = new RegExp(`^\\d{${PIN_LENGTH}}$`)

/** 恢复码长度（按去掉分隔符后的字符数算） */
export const RECOVERY_CODE_LENGTH = 8
/**
 * 恢复码字符集：去掉了容易看错的 `0` `O` `1` `I` `L`。
 * 家长是抄在纸上、拍照存的，读错一个字符就等于把自己锁在门外。
 */
export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const RECOVERY_MAX_ATTEMPTS = 5
export const RECOVERY_LOCK_MS = 60_000

const RECOVERY_RAW_PATTERN = new RegExp(`^[A-Z0-9]{${RECOVERY_CODE_LENGTH}}$`)

/** 明显的弱 PIN：只在界面上提示，不阻止（防的是孩子的手，不是密码学家） */
export const WEAK_PIN_HINTS = Object.freeze(["0000", "1111", "1234", "4321", "0123", "2222"])

/**
 * 加盐多轮混合摘要（非密码学哈希，仅避免明文落库）。
 * 纯 JS 实现，不依赖 `crypto.subtle`，保证 Node 测试与浏览器结果一致。
 * @param {string} pin
 * @param {string} salt
 * @returns {string} 32 位十六进制
 */
export function hashPin(pin, salt) {
  let seedA = 0x811c9dc5
  let seedB = 0x9e3779b9
  const payload = `${salt}::${pin}::${salt}`
  for (let round = 0; round < 512; round += 1) {
    for (let index = 0; index < payload.length; index += 1) {
      const code = payload.charCodeAt(index) ^ (round & 0xff)
      seedA = Math.imul(seedA ^ code, 16777619) >>> 0
      seedB = (seedB + Math.imul(code, index + 7)) >>> 0
      seedB = (seedB ^ (seedB >>> 13)) >>> 0
      seedB = Math.imul(seedB, 2654435761) >>> 0
      seedB = (seedB ^ (seedB << 5)) >>> 0
    }
  }
  return `${seedA.toString(16).padStart(8, "0")}${seedB.toString(16).padStart(8, "0")}`
}

/** 恢复码与 PIN 用同一个摘要函数，但加域前缀，避免两种凭据的摘要互相顶替 */
function hashRecovery(code, salt) {
  return hashPin(`recovery:${code}`, salt)
}

function randomString(length, alphabet) {
  const out = []
  const api = globalThis.crypto
  if (api && typeof api.getRandomValues === "function") {
    const buffer = new Uint32Array(length)
    api.getRandomValues(buffer)
    for (let index = 0; index < length; index += 1) {
      out.push(alphabet[buffer[index] % alphabet.length])
    }
  } else {
    for (let index = 0; index < length; index += 1) {
      out.push(alphabet[Math.floor(Math.random() * alphabet.length)])
    }
  }
  return out.join("")
}

function makeSalt() {
  return randomString(16, "0123456789abcdef")
}

/** 生成一个未格式化的恢复码（8 位、无易混字符） */
export function generateRecoveryCode() {
  return randomString(RECOVERY_CODE_LENGTH, RECOVERY_CODE_ALPHABET)
}

/**
 * 格式化给家长看 / 抄：`A1B2C3D4` → `A1B2-C3D4`。
 * 只影响展示与输入，摘要始终按去分隔符后的 8 位计算。
 * @param {string} code
 */
export function formatRecoveryCode(code) {
  const normalized = normalizeRecoveryCode(code)
  if (!normalized) return typeof code === "string" ? code : ""
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`
}

/**
 * 归一化用户输入：去空格、去横线、转大写。
 * 不合法（长度不对或含非法字符）返回 `""`，由调用方决定提示文案。
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeRecoveryCode(input) {
  if (typeof input !== "string") return ""
  const cleaned = input.replace(/[\s-–—_]/g, "").toUpperCase()
  return RECOVERY_RAW_PATTERN.test(cleaned) ? cleaned : ""
}

function assertPin(pin, label = "PIN") {
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, `${label}必须是 ${PIN_LENGTH} 位数字`, {
      context: { length: typeof pin === "string" ? pin.length : typeof pin },
    })
  }
}

function assertNow(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "now 必须是有效的 Date")
  }
}

/**
 * PIN 配置状态。**不返回哈希与盐**，避免被页面或日志带出去。
 *
 * @param {import("dexie").default} [db]
 * @returns {Promise<{
 *   configured: boolean,
 *   updatedAt: string|null,
 *   failedCount: number,
 *   lockedUntil: string|null,
 *   recoveryConfigured: boolean,
 *   recoveryUpdatedAt: string|null,
 * }>}
 */
export async function getPinStatus(db = getDb()) {
  const values = await readSettings(
    [
      SETTING_KEYS.PARENT_PIN_HASH,
      SETTING_KEYS.PARENT_PIN_SALT,
      SETTING_KEYS.PARENT_PIN_UPDATED_AT,
      SETTING_KEYS.PARENT_PIN_FAILED,
      SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL,
      SETTING_KEYS.PARENT_PIN_RECOVERY_HASH,
      SETTING_KEYS.PARENT_PIN_RECOVERY_SALT,
      SETTING_KEYS.PARENT_PIN_RECOVERY_UPDATED_AT,
    ],
    db,
  )
  const hasHash = typeof values[SETTING_KEYS.PARENT_PIN_HASH] === "string" && values[SETTING_KEYS.PARENT_PIN_HASH] !== ""
  const hasSalt = typeof values[SETTING_KEYS.PARENT_PIN_SALT] === "string" && values[SETTING_KEYS.PARENT_PIN_SALT] !== ""
  const hasRecoveryHash =
    typeof values[SETTING_KEYS.PARENT_PIN_RECOVERY_HASH] === "string" &&
    values[SETTING_KEYS.PARENT_PIN_RECOVERY_HASH] !== ""
  const hasRecoverySalt =
    typeof values[SETTING_KEYS.PARENT_PIN_RECOVERY_SALT] === "string" &&
    values[SETTING_KEYS.PARENT_PIN_RECOVERY_SALT] !== ""
  return {
    configured: hasHash && hasSalt,
    updatedAt: values[SETTING_KEYS.PARENT_PIN_UPDATED_AT] ?? null,
    failedCount: Number(values[SETTING_KEYS.PARENT_PIN_FAILED]) || 0,
    lockedUntil: values[SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL] ?? null,
    recoveryConfigured: hasRecoveryHash && hasRecoverySalt,
    recoveryUpdatedAt: values[SETTING_KEYS.PARENT_PIN_RECOVERY_UPDATED_AT] ?? null,
  }
}

/** 锁定剩余毫秒（未锁定返回 0） */
export function lockRemainingMs(status, now = new Date()) {
  if (!status?.lockedUntil) return 0
  const until = Date.parse(status.lockedUntil)
  if (Number.isNaN(until)) return 0
  return Math.max(0, until - now.getTime())
}

async function clearKeys(db, keys) {
  await db.transaction("rw", db.settings, async () => {
    for (const key of keys) await deleteSetting(key, db)
  })
}

/**
 * 记一次失败：未到上限就累加，到上限就写锁定时间并清零计数。
 * @returns {Promise<{ locked: boolean, remainingAttempts?: number }>}
 */
async function recordFailure({ db, now, failedKey, lockedKey, current }) {
  const failedCount = Number(current) + 1
  if (failedCount >= RECOVERY_MAX_ATTEMPTS) {
    const lockedUntil = toIsoTimestamp(new Date(now.getTime() + RECOVERY_LOCK_MS))
    try {
      await db.transaction("rw", db.settings, async () => {
        await writeSetting(failedKey, 0, { db, now })
        await writeSetting(lockedKey, lockedUntil, { db, now })
      })
    } catch {
      // 计数写失败不应把"码不对"变成"系统错误"
    }
    return { locked: true }
  }
  try {
    await writeSetting(failedKey, failedCount, { db, now })
  } catch {
    // 同上
  }
  return { locked: false, remainingAttempts: RECOVERY_MAX_ATTEMPTS - failedCount }
}

/* ---------------- PIN ---------------- */

async function resetPinAttempts(db, now) {
  try {
    await db.transaction("rw", db.settings, async () => {
      await deleteSetting(SETTING_KEYS.PARENT_PIN_FAILED, db)
      await deleteSetting(SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL, db)
    })
  } catch {
    // 计数清理失败不影响"这次验证通过"的结论
  }
}

/**
 * 校验 PIN。**未设置时直接放行**（老用户默认不验证）。
 *
 * @param {{ pin?: string }} input
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{
 *   allowed: boolean,
 *   configured: boolean,
 *   reason: "unset"|"ok"|"mismatch"|"format"|"locked",
 *   remainingAttempts?: number,
 *   retryAfterMs?: number,
 * }>}
 */
export async function checkParentPin({ pin } = {}, { db = getDb(), now = new Date() } = {}) {
  assertNow(now)
  const status = await getPinStatus(db)
  if (!status.configured) return { allowed: true, configured: false, reason: "unset" }

  const remaining = lockRemainingMs(status, now)
  if (remaining > 0) {
    return { allowed: false, configured: true, reason: "locked", retryAfterMs: remaining }
  }

  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { allowed: false, configured: true, reason: "format", remainingAttempts: PIN_MAX_ATTEMPTS - status.failedCount }
  }

  const values = await readSettings([SETTING_KEYS.PARENT_PIN_HASH, SETTING_KEYS.PARENT_PIN_SALT], db)
  const expected = values[SETTING_KEYS.PARENT_PIN_HASH]
  const salt = values[SETTING_KEYS.PARENT_PIN_SALT]
  const matched = typeof expected === "string" && typeof salt === "string" && hashPin(pin, salt) === expected

  if (matched) {
    await resetPinAttempts(db, now)
    return { allowed: true, configured: true, reason: "ok" }
  }

  const failedCount = status.failedCount + 1
  if (failedCount >= PIN_MAX_ATTEMPTS) {
    const lockedUntil = toIsoTimestamp(new Date(now.getTime() + PIN_LOCK_MS))
    try {
      await db.transaction("rw", db.settings, async () => {
        await writeSetting(SETTING_KEYS.PARENT_PIN_FAILED, 0, { db, now })
        await writeSetting(SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL, lockedUntil, { db, now })
      })
    } catch {
      // 写计数失败不应该让"PIN 错误"变成"系统错误"
    }
    return { allowed: false, configured: true, reason: "locked", retryAfterMs: PIN_LOCK_MS }
  }

  try {
    await writeSetting(SETTING_KEYS.PARENT_PIN_FAILED, failedCount, { db, now })
  } catch {
    // 同上
  }
  return {
    allowed: false,
    configured: true,
    reason: "mismatch",
    remainingAttempts: PIN_MAX_ATTEMPTS - failedCount,
  }
}

/**
 * 写入一组新的 PIN + 恢复码（同一事务，避免"PIN 换了但恢复码还是旧的"）。
 * @param {{
 *   db: import("dexie").default,
 *   now: Date,
 *   pin: string,
 *   recoveryCode: string,
 *   updatedAt: string,
 * }} input
 */
async function writePinAndRecovery({ db, now, pin, recoveryCode, updatedAt }) {
  const pinSalt = makeSalt()
  const pinHash = hashPin(pin, pinSalt)
  const recoverySalt = makeSalt()
  const recoveryHash = hashRecovery(recoveryCode, recoverySalt)

  await db.transaction("rw", db.settings, async () => {
    await writeSetting(SETTING_KEYS.PARENT_PIN_SALT, pinSalt, { db, now })
    await writeSetting(SETTING_KEYS.PARENT_PIN_HASH, pinHash, { db, now })
    await writeSetting(SETTING_KEYS.PARENT_PIN_UPDATED_AT, updatedAt, { db, now })
    await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_SALT, recoverySalt, { db, now })
    await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_HASH, recoveryHash, { db, now })
    await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_UPDATED_AT, updatedAt, { db, now })
    for (const key of [
      SETTING_KEYS.PARENT_PIN_FAILED,
      SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL,
      SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED,
      SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL,
    ]) {
      await deleteSetting(key, db)
    }
  })
}

/**
 * 设置或修改 PIN。已配置时必须提供当前 PIN。
 *
 * M4 起：如果这台设备还没有恢复码（首次设置，或 M3 老用户改 PIN），
 * 会顺手生成一个并通过返回值交出去 —— **明文只在这一刻出现一次**。
 *
 * @param {{ pin: string, currentPin?: string }} input
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{ configured: true, updatedAt: string, recoveryCode: string|null, recoveryIssued: boolean }>}
 */
export async function setParentPin({ pin, currentPin } = {}, { db = getDb(), now = new Date() } = {}) {
  assertNow(now)
  assertPin(pin, "新 PIN")

  const status = await getPinStatus(db)
  if (status.configured) {
    if (typeof currentPin !== "string" || currentPin === "") {
      throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "修改 PIN 要先输入现在用的 PIN")
    }
    const check = await checkParentPin({ pin: currentPin }, { db, now })
    if (!check.allowed) {
      throw new DbError(
        DB_ERROR_CODES.VALIDATION_FAILED,
        check.reason === "locked" ? "试错次数太多，稍等一分钟再试" : "现在用的 PIN 不对",
        { context: { reason: check.reason } },
      )
    }
  }

  const updatedAt = toIsoTimestamp(now)
  const recoveryCode = status.recoveryConfigured ? null : generateRecoveryCode()

  try {
    if (recoveryCode) {
      await writePinAndRecovery({ db, now, pin, recoveryCode, updatedAt })
    } else {
      const salt = makeSalt()
      const hash = hashPin(pin, salt)
      await db.transaction("rw", db.settings, async () => {
        await writeSetting(SETTING_KEYS.PARENT_PIN_SALT, salt, { db, now })
        await writeSetting(SETTING_KEYS.PARENT_PIN_HASH, hash, { db, now })
        await writeSetting(SETTING_KEYS.PARENT_PIN_UPDATED_AT, updatedAt, { db, now })
        await deleteSetting(SETTING_KEYS.PARENT_PIN_FAILED, db)
        await deleteSetting(SETTING_KEYS.PARENT_PIN_LOCKED_UNTIL, db)
      })
    }
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "write", context: { table: "settings", stage: "set-pin" } })
  }

  return {
    configured: true,
    updatedAt,
    recoveryCode: recoveryCode ? formatRecoveryCode(recoveryCode) : null,
    recoveryIssued: Boolean(recoveryCode),
  }
}

/**
 * 关闭 PIN 保护。必须验证当前 PIN。恢复码一并删除（门都关了，留钥匙没意义）。
 * @param {{ currentPin: string }} input
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{ configured: false }>}
 */
export async function clearParentPin({ currentPin } = {}, { db = getDb(), now = new Date() } = {}) {
  assertNow(now)
  const status = await getPinStatus(db)
  if (!status.configured) return { configured: false }

  if (typeof currentPin !== "string" || currentPin === "") {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "关闭 PIN 保护要先输入现在用的 PIN")
  }
  const check = await checkParentPin({ pin: currentPin }, { db, now })
  if (!check.allowed) {
    throw new DbError(
      DB_ERROR_CODES.VALIDATION_FAILED,
      check.reason === "locked" ? "试错次数太多，稍等一分钟再试" : "现在用的 PIN 不对",
      { context: { reason: check.reason } },
    )
  }

  try {
    await clearKeys(db, [
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
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "write", context: { table: "settings", stage: "clear-pin" } })
  }

  return { configured: false }
}

/* ---------------- 恢复码（M4） ---------------- */

/**
 * 校验恢复码。**不改 PIN**，只回答"这串码对不对"，供界面分两步引导。
 *
 * @param {{ recoveryCode?: string }} input
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   reason: "ok"|"unset"|"no-recovery"|"format"|"mismatch"|"locked",
 *   remainingAttempts?: number,
 *   retryAfterMs?: number,
 * }>}
 */
export async function verifyRecoveryCode({ recoveryCode } = {}, { db = getDb(), now = new Date() } = {}) {
  assertNow(now)
  const status = await getPinStatus(db)
  if (!status.configured) return { ok: false, reason: "unset" }
  if (!status.recoveryConfigured) return { ok: false, reason: "no-recovery" }

  const values = await readSettings(
    [
      SETTING_KEYS.PARENT_PIN_RECOVERY_HASH,
      SETTING_KEYS.PARENT_PIN_RECOVERY_SALT,
      SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED,
      SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL,
    ],
    db,
  )

  const lockedUntil = values[SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL]
  if (lockedUntil) {
    const parsed = Date.parse(lockedUntil)
    const remaining = Number.isNaN(parsed) ? 0 : parsed - now.getTime()
    if (remaining > 0) return { ok: false, reason: "locked", retryAfterMs: remaining }
  }

  const normalized = normalizeRecoveryCode(recoveryCode)
  if (!normalized) return { ok: false, reason: "format" }

  const hash = values[SETTING_KEYS.PARENT_PIN_RECOVERY_HASH]
  const salt = values[SETTING_KEYS.PARENT_PIN_RECOVERY_SALT]
  const matched = typeof hash === "string" && typeof salt === "string" && hashRecovery(normalized, salt) === hash

  if (matched) {
    try {
      await clearKeys(db, [
        SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED,
        SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL,
      ])
    } catch {
      // 清计数失败不影响"码是对的"
    }
    return { ok: true, reason: "ok" }
  }

  const failure = await recordFailure({
    db,
    now,
    failedKey: SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED,
    lockedKey: SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL,
    current: Number(values[SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED]) || 0,
  })
  if (failure.locked) return { ok: false, reason: "locked", retryAfterMs: RECOVERY_LOCK_MS }
  return { ok: false, reason: "mismatch", remainingAttempts: failure.remainingAttempts }
}

/**
 * 凭恢复码重置 PIN：校验通过后写入新 PIN，**旧恢复码立即作废**并生成新码。
 *
 * @param {{ recoveryCode: string, pin: string }} input
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{ configured: true, updatedAt: string, recoveryCode: string }>}
 */
export async function resetParentPinWithRecovery(
  { recoveryCode, pin } = {},
  { db = getDb(), now = new Date() } = {},
) {
  assertNow(now)
  assertPin(pin, "新的 PIN")

  const check = await verifyRecoveryCode({ recoveryCode }, { db, now })
  if (!check.ok) {
    const messages = {
      unset: "这台设备还没设 PIN，直接去设置一个就行",
      "no-recovery": "这台设备的 PIN 还没有恢复码，进家长端设置页可以补生成",
      format: "恢复码是 8 位字母数字，形如 A1B2-C3D4",
      locked: "恢复码试错次数太多，稍等一分钟再试",
      mismatch: "恢复码不对，再对一下纸上写的那串",
    }
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, messages[check.reason] ?? "恢复码不对", {
      context: {
        reason: check.reason,
        remainingAttempts: check.remainingAttempts,
        retryAfterMs: check.retryAfterMs,
      },
    })
  }

  const updatedAt = toIsoTimestamp(now)
  const nextRecoveryCode = generateRecoveryCode()
  try {
    await writePinAndRecovery({ db, now, pin, recoveryCode: nextRecoveryCode, updatedAt })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "write", context: { table: "settings", stage: "reset-pin" } })
  }

  return { configured: true, updatedAt, recoveryCode: formatRecoveryCode(nextRecoveryCode) }
}

/**
 * 生成（并覆盖）一个恢复码，返回明文。
 *
 * 用途：M3 时期设置的 PIN 没有恢复码，家长进设置页后可以补一份；
 * 也可以主动"换一把钥匙"（旧码随即失效）。
 * **调用方必须已处于家长模式**，本函数不再要求输入 PIN。
 *
 * @param {{ db?: import("dexie").default, now?: Date }} [options]
 * @returns {Promise<{ recoveryCode: string, updatedAt: string }>}
 */
export async function issueRecoveryCode({ db = getDb(), now = new Date() } = {}) {
  assertNow(now)
  const status = await getPinStatus(db)
  if (!status.configured) {
    throw new DbError(DB_ERROR_CODES.VALIDATION_FAILED, "先设置 PIN，才会有恢复码")
  }

  const code = generateRecoveryCode()
  const salt = makeSalt()
  const hash = hashRecovery(code, salt)
  const updatedAt = toIsoTimestamp(now)

  try {
    await db.transaction("rw", db.settings, async () => {
      await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_SALT, salt, { db, now })
      await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_HASH, hash, { db, now })
      await writeSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_UPDATED_AT, updatedAt, { db, now })
      await deleteSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_FAILED, db)
      await deleteSetting(SETTING_KEYS.PARENT_PIN_RECOVERY_LOCKED_UNTIL, db)
    })
  } catch (error) {
    if (error instanceof DbError) throw error
    throw wrapDbError(error, { phase: "write", context: { table: "settings", stage: "issue-recovery" } })
  }

  return { recoveryCode: formatRecoveryCode(code), updatedAt }
}
