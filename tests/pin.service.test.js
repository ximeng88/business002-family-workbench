/**
 * 家长 PIN 测试（M3）。
 *
 * 覆盖任务书 §二·任务 1 的三条要求与两条自律：
 * - 老用户没设置 PIN 时默认放行（只提示建议设置）；
 * - 设置后错误 PIN 被拒、正确 PIN 通过；
 * - 修改 / 关闭 PIN 必须验证当前 PIN，否则孩子能自己关掉这道门；
 * - 连续 5 次输错锁定 60 秒，锁定期内即使输对也不放行；
 * - PIN 不落明文、不影响 Schema 版本、不碰其他表。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase, readSchemaVersion } from "../src/db/database.js"
import { DB_NAME, SCHEMA_VERSION } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import {
  PIN_LENGTH,
  PIN_LOCK_MS,
  PIN_MAX_ATTEMPTS,
  RECOVERY_LOCK_MS,
  RECOVERY_MAX_ATTEMPTS,
  checkParentPin,
  clearParentPin,
  formatRecoveryCode,
  generateRecoveryCode,
  getPinStatus,
  hashPin,
  issueRecoveryCode,
  lockRemainingMs,
  normalizeRecoveryCode,
  resetParentPinWithRecovery,
  setParentPin,
  verifyRecoveryCode,
} from "../src/services/pin.service.js"
import { readSetting } from "../src/services/settings.service.js"
import { ensureSeedData } from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  await ensureSeedData()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

test("M3-PN1 没设置 PIN 时默认放行，状态里只有「有没有配」", async (t) => {
  await useCleanDatabase(t)

  const status = await getPinStatus()
  assert.equal(status.configured, false, "老用户默认没有 PIN")
  assert.equal(status.updatedAt, null)

  const result = await checkParentPin({ pin: "1234" })
  assert.equal(result.allowed, true)
  assert.equal(result.configured, false)
  assert.equal(result.reason, "unset", "没配置时不应该要求输入")
})

test("M3-PN2 设置后：错的被拒、对的通过，且库里没有明文 PIN", async (t) => {
  await useCleanDatabase(t)

  const saved = await setParentPin({ pin: "8250" })
  assert.equal(saved.configured, true)
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/)

  const status = await getPinStatus()
  assert.equal(status.configured, true)
  assert.equal(Object.hasOwn(status, "hash"), false, "状态对象不得带出哈希")
  assert.equal(Object.hasOwn(status, "salt"), false)

  const wrong = await checkParentPin({ pin: "0000" })
  assert.equal(wrong.allowed, false)
  assert.equal(wrong.reason, "mismatch")
  assert.equal(wrong.remainingAttempts, PIN_MAX_ATTEMPTS - 1, "错一次剩 4 次")

  const right = await checkParentPin({ pin: "8250" })
  assert.equal(right.allowed, true)
  assert.equal(right.reason, "ok")

  // 明文不得出现在 settings 的任何值里
  const rows = await getDb().settings.toArray()
  assert.equal(
    rows.some((row) => String(row.value).includes("8250")),
    false,
    "settings 里不能出现明文 PIN",
  )

  // 哈希是加盐的：同一个 PIN 换个盐结果不同
  assert.notEqual(hashPin("8250", "salt-a"), hashPin("8250", "salt-b"))
  assert.equal(hashPin("8250", "salt-a"), hashPin("8250", "salt-a"), "同一个盐必须稳定")

  // 不改 Schema 版本
  assert.equal(await readSchemaVersion(), SCHEMA_VERSION)
  assert.notEqual(await readSetting("parentPinSalt"), null, "盐必须落库")
  assert.equal(PIN_LENGTH, 4)
})

test("M3-PN3 非 4 位数字一律拒绝", async (t) => {
  await useCleanDatabase(t)

  for (const bad of ["123", "12345", "12a4", "", "  12", "１２３４"]) {
    await assert.rejects(() => setParentPin({ pin: bad }), (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED)
  }

  await setParentPin({ pin: "2468" })
  const short = await checkParentPin({ pin: "246" })
  assert.equal(short.allowed, false)
  assert.equal(short.reason, "format")
})

test("M3-PN4 改 PIN 与关 PIN 都要验证当前 PIN", async (t) => {
  await useCleanDatabase(t)

  await setParentPin({ pin: "1357" })

  await assert.rejects(
    () => setParentPin({ pin: "2468" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED && /现在用的 PIN/.test(error.message),
    "不带当前 PIN 不许改",
  )
  await assert.rejects(
    () => setParentPin({ pin: "2468", currentPin: "9999" }),
    (error) => /PIN 不对/.test(error.message),
    "当前 PIN 错了不许改",
  )

  await setParentPin({ pin: "2468", currentPin: "1357" })
  assert.equal((await checkParentPin({ pin: "1357" })).allowed, false, "旧 PIN 必须失效")
  assert.equal((await checkParentPin({ pin: "2468" })).allowed, true)

  await assert.rejects(() => clearParentPin({}), (error) => /现在用的 PIN/.test(error.message))
  const cleared = await clearParentPin({ currentPin: "2468" })
  assert.equal(cleared.configured, false)
  assert.equal((await getPinStatus()).configured, false)
  assert.equal((await checkParentPin({ pin: "0000" })).allowed, true, "关掉之后回到默认放行")
  assert.equal(await getDb().settings.get("parentPinHash"), undefined, "哈希也要一起删掉")
})

test("M3-PN5 连错 5 次锁定 60 秒，锁定期内输对也不放行", async (t) => {
  await useCleanDatabase(t)
  await setParentPin({ pin: "8642" })

  const base = new Date("2026-11-21T10:00:00.000Z")
  let last
  for (let index = 0; index < PIN_MAX_ATTEMPTS; index += 1) {
    last = await checkParentPin({ pin: "1111" }, { now: base })
  }
  assert.equal(last.allowed, false)
  assert.equal(last.reason, "locked", "第 5 次错之后进入锁定")
  assert.equal(last.retryAfterMs, PIN_LOCK_MS)

  const locked = await checkParentPin({ pin: "8642" }, { now: base })
  assert.equal(locked.allowed, false, "锁定期内正确的 PIN 也不放行")
  assert.equal(locked.reason, "locked")

  const status = await getPinStatus()
  assert.equal(lockRemainingMs(status, base), PIN_LOCK_MS)

  // 锁定过期后恢复正常
  const after = new Date(base.getTime() + PIN_LOCK_MS + 1000)
  const recovered = await checkParentPin({ pin: "8642" }, { now: after })
  assert.equal(recovered.allowed, true)

  // 成功后计数清零
  const clean = await getPinStatus()
  assert.equal(clean.failedCount, 0)
  assert.equal(clean.lockedUntil, null)
})

test("M3-PN6 设 PIN 只写 settings，不动孩子 / 任务 / 其他表", async (t) => {
  await useCleanDatabase(t)

  const before = {}
  for (const table of ["children", "tasks", "submissions", "reviews", "pointLedger", "petProgress", "streaks"]) {
    before[table] = await getDb().table(table).count()
  }

  await setParentPin({ pin: "7531" })

  for (const table of Object.keys(before)) {
    assert.equal(await getDb().table(table).count(), before[table], `${table} 不该被 PIN 影响`)
  }

  const keys = (await getDb().settings.toArray()).map((row) => row.key).sort()
  assert.deepEqual(keys, [
    "parentPinHash",
    "parentPinRecoveryHash",
    "parentPinRecoverySalt",
    "parentPinRecoveryUpdatedAt",
    "parentPinSalt",
    "parentPinUpdatedAt",
  ])
})

/* =============== M4：恢复码 =============== */

test("M4-PN7 首次设置 PIN 会生成恢复码，明文只返回一次、不落库", async (t) => {
  await useCleanDatabase(t)

  const result = await setParentPin({ pin: "4826" })
  assert.equal(result.configured, true)
  assert.equal(result.recoveryIssued, true, "首次设置必须带出恢复码")
  assert.match(result.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/, "展示格式带一条横线")

  const status = await getPinStatus()
  assert.equal(status.recoveryConfigured, true)
  assert.ok(status.recoveryUpdatedAt, "要记下生成时间，设置页要显示")

  const rows = await getDb().settings.toArray()
  const plain = result.recoveryCode.replace("-", "")
  assert.ok(
    rows.every((row) => row.value !== plain && row.value !== result.recoveryCode),
    "恢复码明文不能写进 settings",
  )

  // 改 PIN 不等于换钥匙：已经存好的恢复码继续有效，也不重复生成
  const changed = await setParentPin({ pin: "1357", currentPin: "4826" })
  assert.equal(changed.recoveryIssued, false, "已有恢复码时改 PIN 不重新生成")
  assert.equal(changed.recoveryCode, null)
  assert.equal(
    (await verifyRecoveryCode({ recoveryCode: result.recoveryCode })).ok,
    true,
    "改 PIN 后原来那张纸上的恢复码仍然有效",
  )
})

test("M4-PN8 凭恢复码重置 PIN：旧 PIN 失效、新 PIN 生效、恢复码换新", async (t) => {
  await useCleanDatabase(t)

  const first = await setParentPin({ pin: "4826" })
  const reset = await resetParentPinWithRecovery({ recoveryCode: first.recoveryCode, pin: "9137" })

  assert.equal(reset.configured, true)
  assert.match(reset.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.notEqual(reset.recoveryCode, first.recoveryCode, "重置后必须给新的恢复码")

  assert.equal((await checkParentPin({ pin: "4826" })).allowed, false, "旧 PIN 必须失效")
  assert.equal((await checkParentPin({ pin: "9137" })).allowed, true, "新 PIN 必须能用")
})

test("M4-PN9 重置后旧恢复码立即作废，新恢复码可用", async (t) => {
  await useCleanDatabase(t)

  const first = await setParentPin({ pin: "4826" })
  const reset = await resetParentPinWithRecovery({ recoveryCode: first.recoveryCode, pin: "9137" })

  const oldCheck = await verifyRecoveryCode({ recoveryCode: first.recoveryCode })
  assert.equal(oldCheck.ok, false, "旧码不能再用来重置")

  const newCheck = await verifyRecoveryCode({ recoveryCode: reset.recoveryCode })
  assert.equal(newCheck.ok, true)
})

test("M4-PN10 恢复码输入容错：横线 / 空格 / 小写都能认，格式不对直接拒", async (t) => {
  await useCleanDatabase(t)

  assert.equal(normalizeRecoveryCode("a1b2-c3d4"), "A1B2C3D4")
  assert.equal(normalizeRecoveryCode(" A1B2 C3D4 "), "A1B2C3D4")
  assert.equal(normalizeRecoveryCode("A1B2C3"), "", "长度不够")
  assert.equal(normalizeRecoveryCode("A1B2C3D4E"), "", "长度超出")
  assert.equal(normalizeRecoveryCode(12345678), "", "非字符串")
  assert.equal(formatRecoveryCode("a1b2c3d4"), "A1B2-C3D4")

  const code = generateRecoveryCode()
  assert.equal(code.length, 8)
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, "不含 0 / O / 1 / I / L 这类易混字符")

  const first = await setParentPin({ pin: "4826" })
  const lower = first.recoveryCode.toLowerCase().replace("-", " ")
  const check = await verifyRecoveryCode({ recoveryCode: lower })
  assert.equal(check.ok, true, "小写带空格也应该认")

  const bad = await verifyRecoveryCode({ recoveryCode: "A1B2" })
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, "format")
})

test("M4-PN11 恢复码连错 5 次锁 60 秒，锁定期内正确的码也拒", async (t) => {
  await useCleanDatabase(t)
  const base = new Date("2026-11-21T10:00:00.000Z")
  const { recoveryCode } = await setParentPin({ pin: "4826" }, { now: base })

  let last
  for (let index = 0; index < RECOVERY_MAX_ATTEMPTS; index += 1) {
    last = await verifyRecoveryCode({ recoveryCode: "ZZZZZZZZ" }, { now: base })
  }
  assert.equal(last.ok, false)
  assert.equal(last.reason, "locked")
  assert.equal(last.retryAfterMs, RECOVERY_LOCK_MS)

  const locked = await verifyRecoveryCode({ recoveryCode }, { now: base })
  assert.equal(locked.ok, false, "锁定期内正确恢复码也不放行")
  assert.equal(locked.reason, "locked")

  const after = new Date(base.getTime() + RECOVERY_LOCK_MS + 1000)
  const ok = await verifyRecoveryCode({ recoveryCode }, { now: after })
  assert.equal(ok.ok, true, "锁定过期后恢复正常")
})

test("M4-PN12 没设 PIN / 关掉 PIN 之后，恢复码相关调用都明确报错或清空", async (t) => {
  await useCleanDatabase(t)

  await assert.rejects(
    () => resetParentPinWithRecovery({ recoveryCode: "AAAABBBB", pin: "2580" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
    "没设 PIN 时不该有恢复码流程",
  )
  await assert.rejects(
    () => issueRecoveryCode(),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  const first = await setParentPin({ pin: "4826" })
  const rotated = await issueRecoveryCode()
  assert.notEqual(rotated.recoveryCode, first.recoveryCode, "换一个恢复码要真的换")
  assert.equal((await verifyRecoveryCode({ recoveryCode: first.recoveryCode })).ok, false, "旧码立刻失效")

  await clearParentPin({ currentPin: "4826" })
  const status = await getPinStatus()
  assert.equal(status.configured, false)
  assert.equal(status.recoveryConfigured, false, "关掉 PIN 时恢复码也要一起清掉")
  const keys = (await getDb().settings.toArray()).map((row) => row.key)
  assert.equal(keys.filter((key) => key.startsWith("parentPin")).length, 0, "不能留下孤儿键")
})
