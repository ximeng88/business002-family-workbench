/**
 * 奖励中心服务测试（M2）。
 *
 * 环境：fake-indexeddb。重点验证：
 * - 11 个内置奖励（6 生活 + 5 装扮）首次补齐，重复补齐不覆盖家长改价与启停；
 * - 自定义奖励不写 templateKey（否则第二个会撞 `&templateKey` 唯一索引）；
 * - 内置奖励只能改积分与启停，不能改名。
 */

import "fake-indexeddb/auto"
import test from "node:test"
import assert from "node:assert/strict"
import Dexie from "dexie"

import { closeDb, openDatabase } from "../src/db/database.js"
import { DB_NAME } from "../src/db/schema.js"
import { DB_ERROR_CODES } from "../src/db/errors.js"
import {
  BUILTIN_REWARD_TEMPLATES,
  createCustomReward,
  ensureBuiltinRewardConfigs,
  listRewards,
  setRewardEnabled,
  updateReward,
} from "../src/services/reward.service.js"

async function useCleanDatabase(t) {
  closeDb()
  await Dexie.delete(DB_NAME)
  await openDatabase()
  t.after(async () => {
    closeDb()
    await Dexie.delete(DB_NAME)
  })
}

test("M2-RW1 首次补齐：11 个内置奖励，价格取建议默认价", async (t) => {
  await useCleanDatabase(t)
  const result = await ensureBuiltinRewardConfigs()
  assert.equal(result.added, 11)
  assert.equal(BUILTIN_REWARD_TEMPLATES.length, 11)

  const rewards = await listRewards()
  assert.equal(rewards.length, 11)

  const life = rewards.filter((row) => row.category === "life")
  const costume = rewards.filter((row) => row.category === "costume")
  assert.equal(life.length, 6)
  assert.equal(costume.length, 5)

  for (const row of rewards) {
    assert.equal(row.source, "builtin")
    assert.equal(row.enabled, true)
    assert.equal(row.cost, row.defaultCost)
    assert.equal(typeof row.templateKey, "string")
    if (row.category === "costume") assert.equal(typeof row.costumeKey, "string")
    else assert.equal(Object.hasOwn(row, "costumeKey"), false)
  }

  // 小草帽默认 20（PRD §6.4）
  const hat = rewards.find((row) => row.templateKey === "costume_hat_straw")
  assert.equal(hat.name, "小草帽")
  assert.equal(hat.cost, 20)
  assert.equal(hat.costumeKey, "hat_straw")
})

test("M2-RW2 重复补齐不覆盖家长改价、停用与编辑内容", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  await updateReward({ rewardId: "rw_costume_hat_straw", cost: 7 })
  await setRewardEnabled({ rewardId: "rw_life_park", enabled: false })

  const second = await ensureBuiltinRewardConfigs()
  assert.equal(second.added, 0)

  const rewards = await listRewards()
  const hat = rewards.find((row) => row.id === "rw_costume_hat_straw")
  const park = rewards.find((row) => row.id === "rw_life_park")
  assert.equal(hat.cost, 7, "家长改过的价不能被 Seed 覆盖")
  assert.equal(hat.defaultCost, 20, "建议默认价保留作对照")
  assert.equal(park.enabled, false, "停用状态不能被 Seed 覆盖")
  assert.equal(rewards.length, 11, "不能因为重复补齐产生重复记录")
})

test("M2-RW3 自定义奖励不写 templateKey，可建多条", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  const first = await createCustomReward({ name: "  挑一部电影  ", cost: 45, description: "全家一起看" })
  const second = await createCustomReward({ name: "周末晚睡半小时", cost: 25 })

  assert.equal(first.name, "挑一部电影")
  assert.equal(first.source, "custom")
  assert.equal(first.category, "life")
  assert.equal(Object.hasOwn(first, "templateKey"), false, "空字符串会撞唯一索引，必须让属性不存在")
  assert.equal(Object.hasOwn(second, "templateKey"), false)

  const life = await listRewards({ category: "life" })
  assert.equal(life.length, 8)
  // 内置在前、自定义在后，家长一眼能分出系统项
  const sources = life.map((row) => row.source)
  assert.deepEqual(sources.slice(0, 6), Array(6).fill("builtin"))
  assert.deepEqual(sources.slice(6), ["custom", "custom"])
})

test("M2-RW4 入参校验：缺积分 / 超长名称 / 非法图标 / 内置改名校验", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()

  await assert.rejects(
    () => createCustomReward({ name: "没写积分", cost: undefined }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => createCustomReward({ name: "一二三四五六七八九十一二三", cost: 10 }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => createCustomReward({ name: "图标不对", cost: 10, iconKey: "not-exist" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )
  await assert.rejects(
    () => updateReward({ rewardId: "rw_life_book", name: "偷偷改名" }),
    (error) => error.code === DB_ERROR_CODES.VALIDATION_FAILED,
  )

  // 自定义奖励可以改名改价
  const custom = await createCustomReward({ name: "看电影", cost: 45 })
  const updated = await updateReward({ rewardId: custom.id, name: "看一部电影", cost: 50 })
  assert.equal(updated.name, "看一部电影")
  assert.equal(updated.cost, 50)
})

test("M2-RW5 停用只影响新申请：enabledOnly 过滤，记录与历史保留", async (t) => {
  await useCleanDatabase(t)
  await ensureBuiltinRewardConfigs()
  await setRewardEnabled({ rewardId: "rw_life_cartoon", enabled: false })

  const enabled = await listRewards({ enabledOnly: true })
  assert.equal(enabled.some((row) => row.id === "rw_life_cartoon"), false)
  assert.equal(enabled.length, 10)

  const all = await listRewards()
  assert.equal(all.length, 11, "停用不是删除")
})
