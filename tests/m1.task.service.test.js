/**
 * 逾期查询测试（M1）：逾期任务取全量、不裁剪，且不混进「今日」。
 * 环境：fake-indexeddb。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { toLocalDateKey } from "../src/db/date.js"
import { approveTask } from "../src/services/approval.service.js"
import {
  createTask,
  ensureSeedData,
  listOverdueTasks,
  listTodayTasks,
  listUpcomingTasks,
  M0_CHILD_ID,
  submitTask,
} from "../src/services/task.service.js"
import { shiftDateKey } from "../src/services/streak.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

const today = toLocalDateKey()
const yesterday = shiftDateKey(today, -1)
const threeDaysAgo = shiftDateKey(today, -3)

test("M1-OD1 逾期只包含「过期且未通过」，今日任务不重复计入", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const late = await createTask({ childId: M0_CHILD_ID, title: "补交日记", points: 6, dueDate: yesterday })
  const old = await createTask({ childId: M0_CHILD_ID, title: "补交口算", points: 4, dueDate: threeDaysAgo })
  const tomorrow = shiftDateKey(today, 1)
  await createTask({ childId: M0_CHILD_ID, title: "明天的任务", points: 3, dueDate: tomorrow })

  const overdue = await listOverdueTasks(M0_CHILD_ID)
  assert.deepEqual(overdue.map((task) => task.id), [old.id, late.id]) // 按 dueDate 正序
  assert.equal((await listTodayTasks(M0_CHILD_ID)).length, 5)

  // 未来的任务既不在今日，也不算逾期
  assert.equal(overdue.some((task) => task.title === "明天的任务"), false)
})

test("M1-OD2 逾期任务取全量：12 条全部返回，查询阶段不 limit", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  for (let index = 0; index < 12; index += 1) {
    await createTask({
      childId: M0_CHILD_ID,
      title: `补交 ${index + 1}`,
      points: 2,
      dueDate: shiftDateKey(today, -(index + 1)),
    })
  }

  assert.equal((await listOverdueTasks(M0_CHILD_ID)).length, 12)
})

test("M1-OD3 逾期任务通过后不再算逾期（补交不回填原日期）", async (t) => {  await useCleanDatabase(t)
  await ensureSeedData()

  const late = await createTask({ childId: M0_CHILD_ID, title: "补交朗读", points: 7, dueDate: threeDaysAgo })
  await submitTask({ taskId: late.id, childId: M0_CHILD_ID, contentType: "text", content: "补读了第 6 课" })

  assert.equal((await listOverdueTasks(M0_CHILD_ID)).length, 1)

  const approved = await approveTask({ taskId: late.id })
  assert.equal(approved.approvalDate, today) // 记实际审核日，不是 dueDate

  assert.equal((await listOverdueTasks(M0_CHILD_ID)).length, 0)
  assert.equal((await getDb().streaks.get(`${M0_CHILD_ID}:${today}`)).approvedCount, 1)
  assert.equal(await getDb().streaks.get(`${M0_CHILD_ID}:${threeDaysAgo}`), undefined)
})

test("M1-OD4 接下来几天：含明天与第 7 天，不含今天与更远", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const tomorrow = shiftDateKey(today, 1)
  const seventh = shiftDateKey(today, 7)
  const eighth = shiftDateKey(today, 8)
  const a = await createTask({ childId: M0_CHILD_ID, title: "明天的事", points: 3, dueDate: tomorrow })
  const b = await createTask({ childId: M0_CHILD_ID, title: "第七天的事", points: 3, dueDate: seventh })
  await createTask({ childId: M0_CHILD_ID, title: "第八天的事", points: 3, dueDate: eighth })

  const upcoming = await listUpcomingTasks(M0_CHILD_ID)
  assert.deepEqual(upcoming.map((task) => task.id), [a.id, b.id])
  assert.equal(upcoming.some((task) => task.dueDate === today), false)
})
