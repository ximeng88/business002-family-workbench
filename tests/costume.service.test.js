/**
 * 装扮收藏与穿戴测试（M2）。
 *
 * 环境：fake-indexeddb。重点验证：
 * - 未拥有不能穿戴；
 * - 同类别替换、不同类别共存、卸下幂等；
 * - 穿戴 / 卸下不写积分流水与宠物经验（不改等级成长）；
 * - 收藏与穿戴按 childId 隔离。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, getDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import { adjustPoints } from "../src/services/points.service.js"
import { ensureBuiltinRewardConfigs } from "../src/services/reward.service.js"
import { acceptRedemption, requestRedemption } from "../src/services/redemption.service.js"
import {
  COSTUME_CATALOG,
  equipCostume,
  getCostume,
  listCostumeCollection,
  unequipCostume,
} from "../src/services/costume.service.js"
import { ensureSeedData, M0_CHILD_ID } from "../src/services/task.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  await ensureSeedData()
  await ensureBuiltinRewardConfigs()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

/** 走完整闭环拿到一件装扮：充值 → 申请 → 家长确认 */
async function buyCostume(rewardId, { childId = M0_CHILD_ID, fund = 200 } = {}) {
  await adjustPoints({ childId, delta: fund, reason: "测试充值" })
  const request = await requestRedemption({ childId, rewardId })
  await acceptRedemption({ redemptionId: request.id })
  return request
}

test("M2-CT1 目录：5 件装扮覆盖 5 个类别，默认价与 PRD 一致", async () => {
  assert.equal(COSTUME_CATALOG.length, 5)
  const slots = COSTUME_CATALOG.map((item) => item.slot)
  assert.deepEqual(slots, ["hat", "glasses", "scarf", "outfit", "background"])
  assert.equal(getCostume("hat_straw").defaultCost, 20)
  assert.equal(getCostume("bg_starry").defaultCost, 50)
  assert.equal(getCostume("not-exist"), null)
})

test("M2-CT2 未拥有不能穿戴，且不写穿戴状态", async (t) => {
  await useCleanDatabase(t)

  await assert.rejects(
    () => equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  assert.equal(await getDb().petCostumeStates.count(), 0)

  await assert.rejects(
    () => equipCostume({ childId: M0_CHILD_ID, costumeKey: "not-exist" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
})

test("M2-CT3 兑换后穿戴写入数据库，重读仍在", async (t) => {
  await useCleanDatabase(t)
  await buyCostume("rw_costume_hat_straw")

  const result = await equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" })
  assert.equal(result.slot, "hat")
  assert.equal(result.worn.hat, "hat_straw")

  // 模拟刷新：重新从库里读
  const collection = await listCostumeCollection(M0_CHILD_ID)
  assert.deepEqual(collection.ownedKeys, ["hat_straw"])
  assert.equal(collection.worn.hat, "hat_straw")
  assert.equal(collection.bySlot.hat.length, 1)
  assert.equal(collection.bySlot.hat[0].costume.name, "小草帽")
})

test("M2-CT4 每类别一件：共存、卸下幂等、再穿上不残留", async (t) => {
  await useCleanDatabase(t)
  await buyCostume("rw_costume_hat_straw")
  await buyCostume("rw_costume_scarf_knit")

  await equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" })
  await equipCostume({ childId: M0_CHILD_ID, costumeKey: "scarf_knit" })

  let collection = await listCostumeCollection(M0_CHILD_ID)
  assert.deepEqual(collection.worn, { hat: "hat_straw", scarf: "scarf_knit" }, "不同类别可以共存")
  assert.equal(await getDb().petCostumeStates.count(), 1, "每个孩子只有一条穿戴记录，不是每件一条")

  const removed = await unequipCostume({ childId: M0_CHILD_ID, slot: "hat" })
  assert.equal(removed.changed, true)
  assert.deepEqual(removed.worn, { scarf: "scarf_knit" })

  const again = await unequipCostume({ childId: M0_CHILD_ID, slot: "hat" })
  assert.equal(again.changed, false, "本来没穿就不写库")

  // 再穿回来：state 里不能出现重复或残留键
  await equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" })
  const state = await getDb().petCostumeStates.get(M0_CHILD_ID)
  const costumeKeys = Object.keys(state).filter((key) => !["childId", "updatedAt"].includes(key))
  assert.deepEqual(costumeKeys.sort(), ["hat", "scarf"], "每个类别只留一个键")

  collection = await listCostumeCollection(M0_CHILD_ID)
  assert.deepEqual(collection.worn, { hat: "hat_straw", scarf: "scarf_knit" })
  assert.equal(collection.ownedKeys.length, 2, "卸下不影响收藏")
})

test("M2-CT5 穿戴与卸下不写积分流水，也不写宠物经验", async (t) => {
  await useCleanDatabase(t)
  await buyCostume("rw_costume_hat_straw")

  const ledgerBefore = await getDb().pointLedger.count()
  const expBefore = await getDb().petProgress.count()
  const balanceBefore = (await getDb().pointLedger.toArray()).reduce((sum, row) => sum + row.delta, 0)

  await equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" })
  await unequipCostume({ childId: M0_CHILD_ID, slot: "hat" })

  assert.equal(await getDb().pointLedger.count(), ledgerBefore, "穿戴不是积分事件")
  assert.equal(await getDb().petProgress.count(), expBefore, "穿戴不是经验事件")
  const balanceAfter = (await getDb().pointLedger.toArray()).reduce((sum, row) => sum + row.delta, 0)
  assert.equal(balanceAfter, balanceBefore)
})

test("M2-CT6 孩子隔离：A 的收藏不能给 B 穿戴", async (t) => {
  await useCleanDatabase(t)
  const { createChild } = await import("../src/services/child.service.js")
  const second = await createChild({ nickname: "小明", avatarKey: "rabbit" })

  await buyCostume("rw_costume_hat_straw", { childId: M0_CHILD_ID })

  await assert.rejects(
    () => equipCostume({ childId: second.id, costumeKey: "hat_straw" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  await equipCostume({ childId: M0_CHILD_ID, costumeKey: "hat_straw" })
  const secondCollection = await listCostumeCollection(second.id)
  assert.deepEqual(secondCollection.ownedKeys, [], "另一个孩子不能看到别人的收藏")
  assert.deepEqual(secondCollection.worn, {}, "另一个孩子不能被串用穿戴状态")
})
