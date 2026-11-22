/**
 * 五种伙伴的渲染测试（M6）。
 *
 * 这一层没有数据库、没有 DOM，纯字符串拼装，所以断言直接看 SVG：
 * - 五只都渲染、且都带各自的识别色；
 * - 装扮插在正确位置（帽子必须在头之后，否则被头挡住）；
 * - 未知 `petKey` 回落到小猫，不抛错、不空白；
 * - 服务层枚举与渲染层枚举必须一致（两处常量，靠这条测试绑住）。
 */

import test from "node:test"
import assert from "node:assert/strict"

import { CHILD_PET_KEYS, CHILD_PET_DEFAULT } from "../src/services/child.service.js"
import { PET_DEFAULT, PET_KEYS, catSvg, petMeta, petSvg } from "../src/app/pet.js"

test("M6-PET1 五只都渲染，且渲染层与服务层枚举一致", () => {
  assert.equal(PET_KEYS.length, 5)
  assert.deepEqual([...PET_KEYS], ["cat", "bear", "rabbit", "dog", "fox"])
  assert.deepEqual([...PET_KEYS], [...CHILD_PET_KEYS])
  assert.equal(PET_DEFAULT, CHILD_PET_DEFAULT)

  for (const key of PET_KEYS) {
    const svg = petSvg({ petKey: key })
    assert.match(svg, /viewBox="0 0 264 254"/, `${key} 画布必须是 264×254`)
    assert.match(svg, /class="cat "/, `${key} 保留 .cat 根类，现有 CSS 才能继续命中`)
    assert.equal(svg.includes("undefined"), false, `${key} 渲染里不能出现 undefined`)
    assert.equal(svg.includes("NaN"), false, `${key} 渲染里不能出现 NaN`)
    assert.equal(svg.includes("${"), false, `${key} 渲染里不能有没被替换的模板占位符`)
  }
})

test("M6-PET2 每只都有头 / 身 / 眼 / 影子四个装扮锚点", () => {
  for (const key of PET_KEYS) {
    const svg = petSvg({ petKey: key })
    // 共用骨相：头 132,104 r65/57、身 132,180 r63/53、眼 108/156 y106
    assert.match(svg, /cx="132" cy="104" rx="65" ry="57"/, `${key} 头锚点`)
    assert.match(svg, /cx="132" cy="180" rx="63" ry="53"/, `${key} 身锚点`)
    assert.match(svg, /cx="108" cy="10[46]"/, `${key} 左眼`)
    assert.match(svg, /cx="156" cy="10[46]"/, `${key} 右眼`)
    assert.match(svg, /cx="132" cy="236" rx="68" ry="11"/, `${key} 影子`)
  }
})

test("M6-PET3 装扮插在正确图层：帽子在头之后，背景在最底层", () => {
  for (const key of PET_KEYS) {
    const svg = petSvg({
      petKey: key,
      worn: { hat: "hat_straw", glasses: "glasses_round", scarf: "scarf_knit", outfit: "outfit_vest", background: "bg_starry" },
    })

    const backgroundAt = svg.indexOf("costume--bg")
    const headAt = svg.indexOf("cat__head")
    const hatAt = svg.indexOf("costume--hat")
    const glassesAt = svg.indexOf("costume--glasses")
    const scarfAt = svg.indexOf("costume--scarf")
    const outfitAt = svg.indexOf("costume--outfit")

    assert.ok(backgroundAt > -1, `${key} 背景应渲染`)
    assert.ok(headAt > -1, `${key} 头应渲染`)
    assert.ok(hatAt > headAt, `${key} 帽子必须在头之后，否则会被头挡住`)
    assert.ok(glassesAt > headAt, `${key} 眼镜必须在头之后`)
    assert.ok(scarfAt > headAt, `${key} 围巾在头之后（脖子处）`)
    assert.ok(outfitAt > 0 && outfitAt < headAt, `${key} 衣服在头之前（躯干上）`)
    assert.ok(backgroundAt < svg.indexOf("data-layer=\"shadow\""), `${key} 背景必须最底层`)
  }
})

test("M6-PET4 装扮放错类别不渲染，避免戴在奇怪的位置", () => {
  const svg = petSvg({ petKey: "fox", worn: { hat: "glasses_round" } })
  assert.equal(svg.includes("costume--hat"), false)
  assert.equal(svg.includes("costume--glasses"), false)
})

test("M6-PET5 未知 petKey 回落小猫；catSvg 仍等价", () => {
  const fallback = petSvg({ petKey: "dragon" })
  assert.equal(fallback, petSvg({ petKey: "cat" }))
  assert.equal(catSvg({ worn: {} }), petSvg({ petKey: "cat", worn: {} }))

  assert.equal(petMeta("dragon").label, "小猫")
  assert.equal(petMeta("fox").label, "小狐狸")
})

test("M6-PET6 五只的尾巴与耳朵摆动锚点各不相同（不共用错误锚点）", () => {
  const origins = new Set()
  for (const key of PET_KEYS) {
    const svg = petSvg({ petKey: key })
    const matched = /transform-origin:([\d.]+px [\d.]+px)/.exec(svg)
    assert.ok(matched, `${key} 应有明确的摆动锚点`)
    origins.add(`${key}:${matched[1]}`)
  }
  assert.equal(origins.size, 5)

  // 狗是垂耳造型：耳朵画在头之后，所以不用 ear 摆动层
  const dog = petSvg({ petKey: "dog" })
  assert.equal(dog.includes("cat__ear--left"), false)
  assert.ok(dog.indexOf("cat__head") > -1)
})
