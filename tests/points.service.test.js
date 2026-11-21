/**
 * 积分流水服务测试
 * 环境：**fake-indexeddb 6.2.8**（Node 24），不是真实浏览器验证。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"

import {
  adjustPoints,
  getBalance,
  recalculateBalance,
  listLedger,
  LEDGER_SOURCE,
} from "../src/services/points.service.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { toIsoTimestamp } from "../src/db/date.js"
import { createTestDb, destroyTestDb, makeChild } from "./test-utils.js"

async function setup(prefix) {
  const context = await createTestDb(prefix)
  await context.db.children.add(makeChild())
  return context
}

async function addLedger(db, delta, createdAt, extra = {}) {
  const id = `lgr_seed_${Math.random().toString(36).slice(2, 8)}`
  await db.pointLedger.add({
    id,
    childId: "c_test",
    delta,
    reason: extra.reason ?? "测试流水",
    source: extra.source ?? LEDGER_SOURCE.TASK,
    createdAt: createdAt ?? toIsoTimestamp(),
    ...extra,
  })
  return id
}

test("8.3 多笔流水汇总正确", async (t) => {
  const { db, name } = await setup("b002_points_sum")
  t.after(() => destroyTestDb(db, name))

  await addLedger(db, 10, "2026-11-18T02:00:00.000Z")
  await addLedger(db, 5, "2026-11-19T02:00:00.000Z")
  await addLedger(db, -3, "2026-11-20T02:00:00.000Z")

  const summary = await getBalance("c_test", db)
  assert.equal(summary.balance, 12)
  assert.equal(summary.entryCount, 3)
})

test("8.3 手动增加 / 扣减：写流水且余额正确", async (t) => {
  const { db, name } = await setup("b002_points_adjust")
  t.after(() => destroyTestDb(db, name))

  const added = await adjustPoints({ childId: "c_test", delta: 20, reason: "帮忙做家务", now: new Date(2026, 10, 20, 9, 0), db })
  assert.equal(added.previousBalance, 0)
  assert.equal(added.balance, 20)
  assert.equal(added.entry.source, LEDGER_SOURCE.MANUAL)
  assert.equal(added.entry.reason, "帮忙做家务")

  const subtracted = await adjustPoints({ childId: "c_test", delta: -5, reason: "已兑换奖励", now: new Date(2026, 10, 20, 10, 0), db })
  assert.equal(subtracted.balance, 15)

  const summary = await getBalance("c_test", db)
  assert.equal(summary.balance, 15)
  assert.equal(summary.entryCount, 2)
})

test("8.3 余额不足：拒绝写入，余额不变", async (t) => {
  const { db, name } = await setup("b002_points_insufficient")
  t.after(() => destroyTestDb(db, name))

  await addLedger(db, 5)
  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: -10, reason: "兑换", db }),
    (error) => {
      assert.equal(error.code, DB_ERROR_CODES.VALIDATION_FAILED)
      assert.equal(error.context.rule, "balance-must-not-be-negative")
      return true
    },
  )

  assert.equal((await getBalance("c_test", db)).balance, 5)
  assert.equal(await db.pointLedger.count(), 1)
})

test("8.3 余额不能为负：扣到 0 合法，再扣 1 拒绝", async (t) => {
  const { db, name } = await setup("b002_points_zero")
  t.after(() => destroyTestDb(db, name))

  await addLedger(db, 5)
  const zeroed = await adjustPoints({ childId: "c_test", delta: -5, reason: "全部兑换", db })
  assert.equal(zeroed.balance, 0)

  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: -1, reason: "超出余额", db }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal((await getBalance("c_test", db)).balance, 0)
})

test("8.3 无余额缓存：任何时候都能从流水重算，且与直接求和一致", async (t) => {
  const { db, name } = await setup("b002_points_recalc")
  t.after(() => destroyTestDb(db, name))

  await addLedger(db, 7)
  await addLedger(db, 8)
  await adjustPoints({ childId: "c_test", delta: -4, reason: "重算测试", db })

  const directSum = (await db.pointLedger.where("childId").equals("c_test").toArray()).reduce(
    (total, entry) => total + entry.delta,
    0,
  )
  const recalculated = await recalculateBalance("c_test", db)
  assert.equal(recalculated.balance, directSum)
  assert.equal(recalculated.balance, 11)

  // 孩子资料中没有可写余额字段（余额不是唯一权威）
  const child = await db.children.get("c_test")
  assert.equal(Object.prototype.hasOwnProperty.call(child, "balance"), false)
})

test("8.3 手动调整入参校验：原因必填 / 非零整数 / 字数上限", async (t) => {
  const { db, name } = await setup("b002_points_validation")
  t.after(() => destroyTestDb(db, name))

  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: 5, reason: "   ", db }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: 0, reason: "零", db }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: 1.5, reason: "小数", db }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    adjustPoints({ childId: "c_test", delta: 5, reason: "这是一条明显超过三十个字上限的原因用于验证原因长度的校验是否真的生效请勿删除本行", db }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal(await db.pointLedger.count(), 0)
})

test("8.3 流水分页：时间倒序，不裁剪历史", async (t) => {
  const { db, name } = await setup("b002_points_paging")
  t.after(() => destroyTestDb(db, name))

  await addLedger(db, 1, "2026-11-18T02:00:00.000Z", { reason: "最早" })
  await addLedger(db, 2, "2026-11-19T02:00:00.000Z", { reason: "中间" })
  await addLedger(db, 3, "2026-11-20T02:00:00.000Z", { reason: "最新" })

  const firstPage = await listLedger("c_test", { limit: 2, offset: 0, db })
  assert.deepEqual(firstPage.map((entry) => entry.reason), ["最新", "中间"])

  const secondPage = await listLedger("c_test", { limit: 2, offset: 2, db })
  assert.deepEqual(secondPage.map((entry) => entry.reason), ["最早"])

  assert.equal(await db.pointLedger.count(), 3)
})
