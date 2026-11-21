/**
 * 连续学习天数测试（Q-02 建议口径）。
 * 环境：fake-indexeddb，固定 now，避免跨时区/跨零点漂移。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"

import { getCurrentStreak, shiftDateKey } from "../src/services/streak.service.js"
import { toIsoTimestamp } from "../src/db/date.js"
import { createTestDb, destroyTestDb } from "./test-utils.js"

const CHILD = "c_streak"
const NOW = new Date(2026, 10, 21, 9, 30, 0) // 本地 2026-11-21 09:30

async function seedStreaks(db, dates) {
  const stamp = toIsoTimestamp(NOW)
  for (const date of dates) {
    await db.streaks.add({
      id: `${CHILD}:${date}`,
      childId: CHILD,
      date,
      approvedCount: 1,
      createdAt: stamp,
      updatedAt: stamp,
    })
  }
}

test("M1-ST1 没有记录 → 0 天", async (t) => {
  const { db, name } = await createTestDb("b002_streak_empty")
  t.after(() => destroyTestDb(db, name))

  const result = await getCurrentStreak(CHILD, { now: NOW, db })
  assert.deepEqual(result, { childId: CHILD, days: 0, lastDate: null, countedToday: false })
})

test("M1-ST2 今天通过 → 从今天往前数", async (t) => {
  const { db, name } = await createTestDb("b002_streak_today")
  t.after(() => destroyTestDb(db, name))
  await seedStreaks(db, ["2026-11-21", "2026-11-20", "2026-11-19"])

  const result = await getCurrentStreak(CHILD, { now: NOW, db })
  assert.equal(result.days, 3)
  assert.equal(result.lastDate, "2026-11-21")
  assert.equal(result.countedToday, true)
})

test("M1-ST3 今天没通过、昨天通过 → 连续仍然活着", async (t) => {
  const { db, name } = await createTestDb("b002_streak_alive")
  t.after(() => destroyTestDb(db, name))
  await seedStreaks(db, ["2026-11-20", "2026-11-19"])

  const result = await getCurrentStreak(CHILD, { now: NOW, db })
  assert.equal(result.days, 2)
  assert.equal(result.lastDate, "2026-11-20")
  assert.equal(result.countedToday, false)
})

test("M1-ST4 最后通过 ≤ 前天 → 归零", async (t) => {
  const { db, name } = await createTestDb("b002_streak_dead")
  t.after(() => destroyTestDb(db, name))
  await seedStreaks(db, ["2026-11-19", "2026-11-18"])

  const result = await getCurrentStreak(CHILD, { now: NOW, db })
  assert.deepEqual(result, { childId: CHILD, days: 0, lastDate: null, countedToday: false })
})

test("M1-ST5 中间断一天就重新计算，通过数为 0 的记录不算", async (t) => {
  const { db, name } = await createTestDb("b002_streak_gap")
  t.after(() => destroyTestDb(db, name))
  await seedStreaks(db, ["2026-11-21", "2026-11-19"])
  await db.streaks.add({
    id: `${CHILD}:2026-11-20`,
    childId: CHILD,
    date: "2026-11-20",
    approvedCount: 0,
    createdAt: toIsoTimestamp(NOW),
    updatedAt: toIsoTimestamp(NOW),
  })

  const result = await getCurrentStreak(CHILD, { now: NOW, db })
  assert.equal(result.days, 1)
  assert.equal(result.lastDate, "2026-11-21")
})

test("M1-ST6 跨月连续：10-31 与 11-01 算连续两天", async (t) => {
  const { db, name } = await createTestDb("b002_streak_month")
  t.after(() => destroyTestDb(db, name))
  const now = new Date(2026, 10, 1, 8, 0, 0) // 2026-11-01
  await seedStreaks(db, ["2026-11-01", "2026-10-31", "2026-10-30"])

  const result = await getCurrentStreak(CHILD, { now, db })
  assert.equal(result.days, 3)

  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28")
  assert.equal(shiftDateKey("2026-01-01", -1), "2025-12-31")
  assert.equal(shiftDateKey("2026-12-31", 1), "2027-01-01")
})
