/**
 * 多孩档案与数据隔离测试（M1）。
 *
 * 环境：fake-indexeddb。重点验证：
 * - 新增孩子不改 Schema、不覆盖旧孩子；
 * - 任务、积分、经验按 childId 完全隔离；
 * - 给不存在的孩子布置任务会被拒绝（不留孤立 task）。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME, SCHEMA_VERSION } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { approveTask } from "../src/services/approval.service.js"
import {
  CHILD_AVATAR_IMAGE_MAX_CHARS,
  CHILD_AVATAR_KEYS,
  CHILD_PET_KEYS,
  createChild,
  getChild,
  listChildren,
  updateChildProfile,
} from "../src/services/child.service.js"
import { getBalance } from "../src/services/points.service.js"
import { createTask, ensureSeedData, listTodayTasks, M0_CHILD_ID, submitTask } from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

test("M1-CH1 createChild：写入完整记录，不写 PIN，不升 Schema", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const child = await createChild({ nickname: "  小明  ", avatarKey: "rabbit" })
  assert.equal(child.nickname, "小明")
  assert.equal(child.avatarKey, "rabbit")
  assert.equal(child.hasChildPin, false)
  assert.equal(Object.hasOwn(child, "childPinHash"), false)
  assert.equal(Object.hasOwn(child, "childPinSalt"), false)
  assert.equal(child.id.startsWith("child_"), true)

  assert.deepEqual(await getChild(child.id), child)

  const all = await listChildren()
  assert.equal(all.length, 2)
  assert.equal(all[0].id, M0_CHILD_ID) // 创建时间正序，朵朵仍在前
  assert.equal(all[1].id, child.id)

  // 旧孩子没有被覆盖
  assert.equal((await getChild(M0_CHILD_ID)).nickname, "朵朵")
  assert.equal(await getDb().table("_meta").get("schemaVersion").then((row) => row.value), SCHEMA_VERSION)
})

test("M1-CH2 createChild 入参校验：空昵称 / 超长 / 非法头像", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  const invalid = [
    { nickname: "   " },
    { nickname: "一二三四五六七八九十一二三" },
    { nickname: "小花", avatarKey: "dragon-unknown" },
  ]
  for (const input of invalid) {
    await assert.rejects(
      createChild(input),
      (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      JSON.stringify(input),
    )
  }
  assert.equal((await listChildren()).length, 1)
  assert.equal(CHILD_AVATAR_KEYS.length >= 4, true)
})

test("M1-CH3 多孩隔离：任务、积分、经验互不影响", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const second = await createChild({ nickname: "小明", avatarKey: "fox" })

  const taskForSecond = await createTask({ childId: second.id, title: "练字 10 分钟", points: 8 })
  assert.equal(taskForSecond.childId, second.id)

  // 朵朵看不到小明的任务
  const firstTasks = await listTodayTasks(M0_CHILD_ID)
  assert.equal(firstTasks.some((task) => task.id === taskForSecond.id), false)
  assert.equal(firstTasks.length, 5)
  assert.equal((await listTodayTasks(second.id)).length, 1)

  // 小明提交并被打回，积分仍为 0；朵朵的积分不受影响
  await submitTask({ taskId: taskForSecond.id, childId: second.id, contentType: "text", content: "写了两页" })
  await assert.rejects(
    submitTask({ taskId: taskForSecond.id, childId: M0_CHILD_ID, contentType: "text", content: "冒名提交" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  const approved = await approveTask({ taskId: taskForSecond.id })
  assert.equal(approved.childId, second.id)
  assert.equal((await getBalance(second.id)).balance, 8)
  assert.equal((await getBalance(M0_CHILD_ID)).balance, 0)

  const secondExp = await getDb().petProgress.where("childId").equals(second.id).toArray()
  const firstExp = await getDb().petProgress.where("childId").equals(M0_CHILD_ID).toArray()
  assert.equal(secondExp.length, 1)
  assert.equal(firstExp.length, 0)
})

test("M1-CH4 给不存在的孩子布置任务：拒绝且不写库", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()

  await assert.rejects(
    createTask({ childId: "child_not_exist", title: "幽灵任务", points: 5 }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal(await getDb().tasks.count(), 5)
})

/* ---------------- M6：资料可改（昵称 / 头像 / 伙伴） ---------------- */

const TINY_JPEG = `data:image/jpeg;base64,${"A".repeat(64)}`

test("M6-CH1 改昵称：只动 nickname，其它字段与其它表一个字节都不变", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小明", avatarKey: "rabbit" })

  const before = {
    tasks: await getDb().tasks.count(),
    ledger: await getDb().pointLedger.count(),
    exp: await getDb().petProgress.count(),
    streaks: await getDb().streaks.count(),
  }

  const updated = await updateChildProfile({ childId: child.id, nickname: "  小明明  " })
  assert.equal(updated.nickname, "小明明")
  assert.equal(updated.avatarKey, "rabbit", "没传的字段不能被清掉")
  assert.equal(updated.hasChildPin, false)
  assert.equal(updated.createdAt, child.createdAt)
  assert.equal((await getChild(child.id)).nickname, "小明明")

  // 兄弟孩子不受影响
  assert.equal((await getChild(M0_CHILD_ID)).nickname, "朵朵")

  assert.equal(await getDb().tasks.count(), before.tasks)
  assert.equal(await getDb().pointLedger.count(), before.ledger)
  assert.equal(await getDb().petProgress.count(), before.exp)
  assert.equal(await getDb().streaks.count(), before.streaks)
})

test("M6-CH2 头像两个字段互不覆盖：上传保留 avatarKey，恢复默认保留 avatarKey", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小明", avatarKey: "fox" })

  const withImage = await updateChildProfile({ childId: child.id, avatarImage: TINY_JPEG })
  assert.equal(withImage.avatarImage, TINY_JPEG)
  assert.equal(withImage.avatarKey, "fox", "上传照片不能把预设 key 删掉，它是恢复默认的落点")

  // 恢复默认 = 传 null
  const reset = await updateChildProfile({ childId: child.id, avatarImage: null })
  assert.equal(Object.hasOwn(reset, "avatarImage"), false, "恢复默认要真正删掉字段，而不是写空串")
  assert.equal(reset.avatarKey, "fox")

  // 换预设 + 同时清图片
  const switched = await updateChildProfile({ childId: child.id, avatarKey: "panda", avatarImage: null })
  assert.equal(switched.avatarKey, "panda")
  assert.equal(Object.hasOwn(switched, "avatarImage"), false)
})

test("M6-CH3 非法入参全部在写库前被拒，原记录保持不变", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小明", avatarKey: "cat" })

  const invalid = [
    { nickname: "   " },
    { nickname: "一二三四五六七八九十一二三" },
    { avatarKey: "dragon-unknown" },
    { avatarImage: "https://example.com/a.jpg" },
    { avatarImage: "blob:http://localhost/abc" },
    { avatarImage: `data:image/jpeg;base64,${"A".repeat(CHILD_AVATAR_IMAGE_MAX_CHARS)}` },
    { petKey: "dragon-unknown" },
  ]
  for (const patch of invalid) {
    await assert.rejects(
      updateChildProfile({ childId: child.id, ...patch }),
      (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
      JSON.stringify(patch).slice(0, 60),
    )
  }

  const current = await getChild(child.id)
  assert.equal(current.nickname, "小明")
  assert.equal(current.avatarKey, "cat")
  assert.equal(Object.hasOwn(current, "avatarImage"), false)
  assert.equal(Object.hasOwn(current, "petKey"), false)
})

test("M6-CH4 空改动与不存在的孩子都被拒", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小明" })

  await assert.rejects(
    updateChildProfile({ childId: child.id }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    updateChildProfile({ childId: "child_not_exist", nickname: "幽灵" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    updateChildProfile({ childId: "", nickname: "空 id" }),
    (error) => error?.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M6-CH5 换伙伴只写 petKey，不动经验 / 等级来源 / 装扮", async (t) => {
  await useCleanDatabase(t)
  await ensureSeedData()
  const child = await createChild({ nickname: "小明" })

  for (const petKey of CHILD_PET_KEYS) {
    const updated = await updateChildProfile({ childId: child.id, petKey })
    assert.equal(updated.petKey, petKey)
    assert.equal(updated.nickname, "小明")
  }

  assert.equal(CHILD_PET_KEYS.length, 5, "本轮内置五种伙伴")
  assert.equal(await getDb().petProgress.count(), 0, "换伙伴不写经验流水")
  assert.equal(await getDb().pointLedger.count(), 0, "换伙伴不写积分流水")
  assert.equal(await getDb().children.count(), 2)
})
