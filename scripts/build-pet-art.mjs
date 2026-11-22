/**
 * 把 design/assets/pets/*.svg 生成 src/app/petArt.js。
 *
 * 什么时候需要跑：改了宠物素材（配色、耳朵、尾巴）之后。
 *   node scripts/build-pet-art.mjs
 *
 * 它做三件事：
 * 1. 按 data-layer 拆出非空图层（background/outfit/scarf/glasses/hat 是空容器，
 *    由装扮运行时填充，不写进素材常量）；
 * 2. 给尾巴 / 耳朵 / 眼睛 / 头 / 星星补上动画 class（沿用现有 CSS 的 .cat__* 选择器，
 *    这样 CSS 一行都不用改）；
 * 3. 每只宠物单独给 transform-origin（尾巴和耳朵的位置本来就不同），
 *    用内联 style 覆盖，避免五只共用一套错误锚点。
 *
 * 生成物是普通 ES 模块常量，会被打進生产包；本脚本自身不进构建。
 */

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..")
const srcDir = join(root, "design/assets/pets")

const META = {
  cat: { label: "小猫", tail: "178px 200px", earLeft: "90px 84px", earRight: "174px 84px" },
  bear: { label: "小熊", tail: "190px 206px", earLeft: "80px 60px", earRight: "184px 60px" },
  rabbit: { label: "小兔", tail: "192px 200px", earLeft: "97px 45px", earRight: "167px 45px" },
  dog: { label: "小狗", tail: "176px 198px", earLeft: "70px 104px", earRight: "194px 104px" },
  fox: { label: "小狐狸", tail: "174px 200px", earLeft: "74px 82px", earRight: "190px 82px" },
}

/** 从 start（某个 `<g` 的位置）找到配对的 `</g>`，返回内部内容 */
function sliceGroup(text, start) {
  let depth = 0
  let index = start
  while (index < text.length) {
    const nextOpen = text.indexOf("<g", index)
    const nextClose = text.indexOf("</g>", index)
    if (nextClose === -1) break
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1
      index = nextOpen + 2
      continue
    }
    depth -= 1
    index = nextClose + 4
    if (depth === 0) {
      const contentStart = text.indexOf(">", start) + 1
      return text.slice(contentStart, nextClose)
    }
  }
  throw new Error("没有找到配对的 </g>")
}

function extractLayers(svg) {
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<!--[\s\S]*?-->/g, "")

  const layers = {}
  const shadow = /<ellipse data-layer="shadow"[^>]*\/>/.exec(body)
  if (shadow) layers.shadow = shadow[0]

  let cursor = 0
  for (;;) {
    const open = body.indexOf('<g data-layer="', cursor)
    if (open === -1) break
    const nameStart = open + '<g data-layer="'.length
    const nameEnd = body.indexOf('"', nameStart)
    const name = body.slice(nameStart, nameEnd)
    const inner = sliceGroup(body, open)
    const closeAt = body.indexOf("</g>", open)
    layers[name] = inner
    // 跳过整段，避免把嵌套的 face / eye 当成顶层
    let depth = 0
    let index = open
    for (;;) {
      const nextOpen = body.indexOf("<g", index)
      const nextClose = body.indexOf("</g>", index)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1
        index = nextOpen + 2
        continue
      }
      depth -= 1
      index = nextClose + 4
      if (depth === 0) break
    }
    cursor = closeAt >= 0 ? index : body.length
  }
  return layers
}

function withClass(inner, attr) {
  return `<g ${attr}>${inner}</g>`
}

function build(petKey) {
  const raw = readFileSync(join(srcDir, `${petKey}.svg`), "utf8")
  const layers = extractLayers(raw)
  const meta = META[petKey]

  const out = {}

  if (layers.shadow) out.shadow = layers.shadow

  if (layers.tail?.trim()) {
    out.tail = withClass(layers.tail.trim(), `class="cat__tail" style="transform-origin:${meta.tail}"`)
  }

  if (layers.body?.trim()) out.body = withClass(layers.body.trim(), "")

  if (layers["ear-left"]?.trim()) {
    out.earLeft = withClass(
      layers["ear-left"].trim(),
      `class="cat__ear cat__ear--left" style="transform-origin:${meta.earLeft}"`,
    )
  }
  if (layers["ear-right"]?.trim()) {
    out.earRight = withClass(
      layers["ear-right"].trim(),
      `class="cat__ear cat__ear--right" style="transform-origin:${meta.earRight}"`,
    )
  }

  if (layers.head?.trim()) {
    // 眼睛在 head 里，先给它们补 class，再整段包起来
    out.head = withClass(
      layers.head
        .trim()
        .replace('<g data-layer="eye-left">', '<g class="cat__eye cat__eye--left">')
        .replace('<g data-layer="eye-right">', '<g class="cat__eye cat__eye--right">'),
      'class="cat__head"',
    )
  }

  if (layers["ear-left-front"]?.trim()) out.earFrontLeft = withClass(layers["ear-left-front"].trim(), "")
  if (layers["ear-right-front"]?.trim()) out.earFrontRight = withClass(layers["ear-right-front"].trim(), "")
  if (layers["ear-front"]?.trim()) out.earFront = withClass(layers["ear-front"].trim(), "")

  if (layers.spark?.trim()) out.spark = withClass(layers.spark.trim(), 'class="cat__spark"')

  return { meta, out }
}

const keys = ["cat", "bear", "rabbit", "dog", "fox"]
const built = Object.fromEntries(keys.map((key) => [key, build(key)]))

const lines = []
lines.push(`/**
 * 五种宠物的分层 SVG 素材（M6）。**本文件由 design/assets/pets/*.svg 生成**，
 * 手改请同步改素材，否则下次重新生成会覆盖。
 *
 * 为什么拆成图层而不是整段 SVG：装扮必须插在**特定位置**——
 * 帽子要在头之后、围巾要在脖子处、星空背景要在最底层。渲染顺序见 \`pet.js\`。
 *
 * 五种宠物共用同一套骨相（画布 264×254、头 132,104 r65/57、身 132,180 r63/53、
 * 眼 108/156 y106），因此五件装扮对五只全部可用，不需要 25 次单独对齐。
 * 差异只在耳朵、尾巴、配色与口鼻（见 design/07 §3）。
 *
 * 动画 class 沿用现有 \`.cat__*\` 选择器（pages.css），CSS 不需要改；
 * 每只宠物单独的 transform-origin 用内联 style 覆盖。
 */

/** 宠物元信息：界面上的名字、一句话简介、绘制顺序里的摆动锚点 */
export const PET_META = Object.freeze({
${keys
  .map((key) => {
    const m = built[key].meta
    return `  ${key}: Object.freeze({ key: "${key}", label: "${m.label}" }),`
  })
  .join("\n")}
})

/** 绘制顺序：改动这个数组会让帽子被头挡住、或垂耳盖住镜片，不要随意调整 */
export const PET_LAYER_ORDER = Object.freeze([
  "background",
  "shadow",
  "tail",
  "body",
  "outfit",
  "earLeft",
  "earRight",
  "head",
  "earFrontLeft",
  "earFrontRight",
  "earFront",
  "scarf",
  "glasses",
  "hat",
  "spark",
])

/** 每只宠物的静态图层（空字符串 = 这只没有这一层） */
export const PET_ART = Object.freeze({
${keys
  .map((key) => {
    const out = built[key].out
    const body = Object.entries(out)
      .map(([name, value]) => `    ${name}: \`${value.replaceAll("`", "\\`").replaceAll("${", "\\${")}\`,`)
      .join("\n")
    return `  ${key}: Object.freeze({\n${body}\n  }),`
  })
  .join("\n")}
})
`)

writeFileSync(join(root, "src/app/petArt.js"), lines.join("\n"), "utf8")
console.log("written src/app/petArt.js")
for (const key of keys) {
  console.log(key, Object.keys(built[key].out).join(","))
}
