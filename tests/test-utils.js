/**
 * 测试辅助：独立命名数据库 + 基础数据种子
 * 所有单元测试均运行在 fake-indexeddb 上（见各测试文件头部与交付报告）。
 */

import Dexie from "dexie"
import { createFamilyDatabase, openDatabase } from "../src/db/database.js"
import { toIsoTimestamp } from "../src/db/date.js"

let sequence = 0

export function uniqueDbName(prefix = "b002_test") {
  sequence += 1
  return `${prefix}_${Date.now()}_${sequence}_${Math.random().toString(36).slice(2, 8)}`
}

export async function createTestDb(prefix = "b002_test") {
  const name = uniqueDbName(prefix)
  const db = createFamilyDatabase(name)
  await openDatabase(db)
  return { db, name }
}

export async function destroyTestDb(db, name) {
  try {
    db.close()
  } catch {
    // 已关闭
  }
  await Dexie.delete(name)
}

export function makeChild(overrides = {}) {
  return {
    id: "c_test",
    nickname: "小测",
    avatarKey: "cat",
    hasChildPin: false,
    createdAt: toIsoTimestamp(),
    ...overrides,
  }
}

export function makeTask(overrides = {}) {
  return {
    id: "t_test",
    childId: "c_test",
    title: "读 10 分钟",
    points: 10,
    type: "daily",
    status: "submitted",
    dueDate: "2026-11-18",
    templateId: "tpl_test",
    generationKey: "daily:c_test:tpl_test:2026-11-18",
    submittedAt: toIsoTimestamp(),
    approvedAt: null,
    approvalDate: null,
    revisionReason: null,
    createdAt: toIsoTimestamp(),
    ...overrides,
  }
}

export async function seedChildAndTask(db, { child, task } = {}) {
  const childRecord = makeChild(child)
  const taskRecord = makeTask({ childId: childRecord.id, ...(task ?? {}) })
  await db.children.add(childRecord)
  await db.tasks.add(taskRecord)
  return { child: childRecord, task: taskRecord }
}
