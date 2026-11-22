/**
 * 宠物「团团」：纯 SVG 图层 + 派生等级 + 装扮叠层。
 *
 * 遵守 R-15：宠物没有状态表，只有 petProgress 经验流水，
 * 等级与进度全部由累计经验现算，不写库、不缓存。
 *
 * 装扮只改外观（PRD §7.4）：图层直接画在同一个 264×254 坐标系里，
 * 因此帽子会跟着头一起晃、围巾贴着脖子，不需要额外定位计算。
 * 每个 slot 一件，未穿戴时对应图层完全不渲染。
 *
 * M6 起支持五种伙伴（小猫 / 小熊 / 小兔 / 小狗 / 小狐狸）。
 * 五只共用同一套骨相与装扮锚点（见 `petArt.js`），所以：
 * - 换伙伴只换 `petKey`，**不动**经验、等级、收藏与当前穿戴；
 * - 五件装扮对五只全部可用，不需要为每只单独适配。
 */

import { PET_ART, PET_META } from "./petArt.js"

/** 可选伙伴（顺序即选择页顺序） */
export const PET_KEYS = Object.freeze(Object.keys(PET_ART))
export const PET_DEFAULT = "cat"

/** 宠物元信息（名字），未知 key 回落到小猫 */
export function petMeta(petKey) {
  return PET_META[petKey] ?? PET_META[PET_DEFAULT]
}

/** 每级所需经验 */
export const EXP_PER_LEVEL = 40

/**
 * @param {number} exp 累计经验
 * @returns {{ level: number, inLevel: number, need: number, percent: number, nextLevel: number }}
 */
export function levelInfo(exp) {
  const total = Math.max(0, Math.round(Number(exp) || 0))
  const level = Math.floor(total / EXP_PER_LEVEL) + 1
  const inLevel = total % EXP_PER_LEVEL
  return {
    level,
    inLevel,
    need: EXP_PER_LEVEL,
    percent: Math.round((inLevel / EXP_PER_LEVEL) * 100),
    nextLevel: level + 1,
  }
}

/** 等级称呼：让数字更像"长大"而不是"打怪" */
export function levelTitle(level) {
  if (level >= 8) return "超级伙伴"
  if (level >= 6) return "可靠搭档"
  if (level >= 4) return "越来越熟"
  if (level >= 3) return "形影不离"
  if (level >= 2) return "好朋友"
  return "刚认识"
}

/* ---------------- 装扮图层 ---------------- */

function backgroundLayer() {
  return `
  <g class="costume costume--bg">
    <defs>
      <linearGradient id="costumeNight" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stop-color="#2b2f6b" />
        <stop offset="0.55" stop-color="#3b3577" />
        <stop offset="1" stop-color="#5a4380" />
      </linearGradient>
    </defs>
    <rect x="8" y="8" width="248" height="238" rx="34" fill="url(#costumeNight)" />
    <circle cx="206" cy="62" r="21" fill="#ffe9a8" opacity="0.92" />
    <circle cx="196" cy="56" r="17" fill="#3b3577" opacity="0.75" />
    <g fill="#ffffff">
      <circle cx="52" cy="52" r="2.8" /><circle cx="88" cy="36" r="2.2" />
      <circle cx="120" cy="62" r="1.8" /><circle cx="228" cy="118" r="2.4" />
      <circle cx="40" cy="150" r="2.2" /><circle cx="236" cy="196" r="2.6" />
      <circle cx="66" cy="212" r="1.9" /><circle cx="186" cy="226" r="2.1" />
      <circle cx="152" cy="30" r="2" />
    </g>
    <g fill="#fff3c4" opacity="0.95">
      <path d="M74 92c.6 3.6 1.8 4.8 5.4 5.4-3.6.6-4.8 1.8-5.4 5.4-.6-3.6-1.8-4.8-5.4-5.4 3.6-.6 4.8-1.8 5.4-5.4Z" />
      <path d="M214 158c.5 2.8 1.4 3.8 4.2 4.3-2.8.5-3.7 1.4-4.2 4.2-.5-2.8-1.4-3.7-4.2-4.2 2.8-.5 3.7-1.5 4.2-4.3Z" />
    </g>
  </g>`
}

function outfitLayer() {
  return `
  <g class="costume costume--outfit">
    <path d="M84 158c14-9 32-13 48-13s34 4 48 13l-7 42c-13 8-27 12-41 12s-28-4-41-12Z"
      fill="#6aa9ff" stroke="#3b6fbd" stroke-width="5" stroke-linejoin="round" />
    <path d="M114 150c6 12 10 18 18 22 8-4 12-10 18-22"
      fill="none" stroke="#3b6fbd" stroke-width="4.5" stroke-linecap="round" />
    <circle cx="132" cy="178" r="3.6" fill="#fff8e8" />
    <circle cx="132" cy="192" r="3.6" fill="#fff8e8" />
    <path d="M96 166c-3 8-4 16-3 24M168 166c3 8 4 16 3 24"
      fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.55" />
  </g>`
}

function scarfLayer() {
  return `
  <g class="costume costume--scarf">
    <path d="M89 141c9 15 25 24 43 24s34-9 43-24c3 13 2 24-2 32-11 10-25 15-41 15s-30-5-41-15c-4-8-5-19-2-32Z"
      fill="#ff8a8a" stroke="#c95050" stroke-width="4.5" stroke-linejoin="round" />
    <path d="M154 192c11 5 17 15 16 27-1 7-7 11-14 9-6-2-9-8-7-15l5-21Z"
      fill="#ffa3a3" stroke="#c95050" stroke-width="4" stroke-linejoin="round" />
    <path d="M100 156c10 8 20 12 32 12" fill="none" stroke="#ffc2c2" stroke-width="4" stroke-linecap="round" opacity="0.8" />
  </g>`
}

function glassesLayer() {
  return `
  <g class="costume costume--glasses">
    <g fill="rgba(186,219,255,0.36)" stroke="#5b4a37" stroke-width="5">
      <circle cx="108" cy="106" r="21" />
      <circle cx="156" cy="106" r="21" />
    </g>
    <path d="M129 105h6" stroke="#5b4a37" stroke-width="5" stroke-linecap="round" />
    <path d="M87 101 75 95M177 101l12-6" stroke="#5b4a37" stroke-width="5" stroke-linecap="round" />
    <path d="M100 96c4-4 10-5 14-2M148 96c4-4 10-5 14-2"
      fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.75" />
  </g>`
}

function hatLayer() {
  return `
  <g class="costume costume--hat">
    <ellipse cx="132" cy="56" rx="82" ry="18" fill="#f2cf7a" stroke="#b98a2f" stroke-width="5" />
    <path d="M96 52c3-27 16-42 36-42s33 15 36 42c-11 8-23 11-36 11s-25-3-36-11Z"
      fill="#f7dc94" stroke="#b98a2f" stroke-width="5" stroke-linejoin="round" />
    <path d="M98 47c22 8 46 8 68 0" fill="none" stroke="#e05d7a" stroke-width="7" stroke-linecap="round" />
    <circle cx="166" cy="40" r="6.5" fill="#ff8fa8" stroke="#c95048" stroke-width="2.5" />
    <path d="M110 33c9-6 19-9 29-8" fill="none" stroke="#fff3cc" stroke-width="3.5" stroke-linecap="round" opacity="0.85" />
  </g>`
}

const COSTUME_LAYERS = {
  hat_straw: { slot: "hat", render: hatLayer },
  glasses_round: { slot: "glasses", render: glassesLayer },
  scarf_knit: { slot: "scarf", render: scarfLayer },
  outfit_vest: { slot: "outfit", render: outfitLayer },
  bg_starry: { slot: "background", render: backgroundLayer },
}

/**
 * 把已穿戴的装扮渲染成图层。
 * @param {Record<string, string>} worn { hat?: "hat_straw", ... }
 * @param {"background"|"outfit"|"scarf"|"glasses"|"hat"} slot
 */
function layerFor(worn, slot) {
  const costumeKey = worn?.[slot]
  if (!costumeKey) return ""
  const entry = COSTUME_LAYERS[costumeKey]
  if (!entry || entry.slot !== slot) return "" // 装扮放错类别就不渲染，避免戴在奇怪的部位
  return entry.render()
}

/** 是否穿了星空背景（夜间版式，文字要转白） */
export function hasNightBackground(worn) {
  return worn?.background === "bg_starry"
}

/**
 * 宠物本体 + 装扮叠层。
 *
 * 图层顺序**不能改**（design/07 §4）：
 *   background → shadow → tail → body → outfit → ear → head → ear-front
 *   → scarf → glasses → hat → spark
 * 改顺序会让帽子被头挡住、或垂耳盖住镜片。
 *
 * @param {{ petKey?: string, worn?: Record<string, string>, className?: string }} [options]
 */
export function petSvg({ petKey = PET_DEFAULT, worn = {}, className = "" } = {}) {
  const key = PET_ART[petKey] ? petKey : PET_DEFAULT
  const art = PET_ART[key]
  const meta = petMeta(key)
  const part = (name) => art[name] ?? ""

  return `
<svg class="cat ${className}" viewBox="0 0 264 254" role="img" aria-label="${meta.label}团团">
  ${layerFor(worn, "background")}
  ${part("shadow")}
  ${part("tail")}
  ${part("body")}
  ${layerFor(worn, "outfit")}
  ${part("earLeft")}
  ${part("earRight")}
  ${part("head")}
  ${part("earFrontLeft")}
  ${part("earFrontRight")}
  ${part("earFront")}
  ${layerFor(worn, "scarf")}
  ${layerFor(worn, "glasses")}
  ${layerFor(worn, "hat")}
  ${part("spark")}
</svg>`
}

/**
 * 兼容入口：M2 起界面一直调用 `catSvg()`，宠物变多种后保留这个名字，
 * 内部走 `petSvg`，避免一次性改所有调用点。
 */
export function catSvg(options = {}) {
  return petSvg({ ...options, petKey: "cat" })
}

/* ---------------- 商城缩略图 ---------------- */

const THUMBS = {
  hat_straw: `
    <ellipse cx="36" cy="46" rx="27" ry="8.5" fill="#f2cf7a" stroke="#b98a2f" stroke-width="3" />
    <path d="M21 44c1-13 7-21 15-21s14 8 15 21c-5 3-10 4-15 4s-10-1-15-4Z"
      fill="#f7dc94" stroke="#b98a2f" stroke-width="3" stroke-linejoin="round" />
    <path d="M22 41c9 4 19 4 28 0" fill="none" stroke="#e05d7a" stroke-width="4" stroke-linecap="round" />`,
  glasses_round: `
    <g fill="rgba(186,219,255,0.5)" stroke="#5b4a37" stroke-width="3.4">
      <circle cx="24" cy="36" r="12" /><circle cx="48" cy="36" r="12" />
    </g>
    <path d="M35 36h2M12 32 5 28M60 32l7-4" stroke="#5b4a37" stroke-width="3.4" stroke-linecap="round" />`,
  scarf_knit: `
    <path d="M23 29h10v22l-5 5-5-5Z" fill="#ffa3a3" stroke="#c95050" stroke-width="2.8" stroke-linejoin="round" />
    <path d="M39 29h10v15l-5 5-5-5Z" fill="#ffa3a3" stroke="#c95050" stroke-width="2.8" stroke-linejoin="round" />
    <path d="M12 17h48a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6v-6a6 6 0 0 1 6-6Z"
      fill="#ff8a8a" stroke="#c95050" stroke-width="3" stroke-linejoin="round" />
    <path d="M18 21v12M27 21v12M36 21v12M45 21v12M54 21v12"
      stroke="#ffc9c9" stroke-width="2.4" stroke-linecap="round" />
    <path d="M25 56v4M29 57v4M43 49v4M47 50v4" stroke="#c95050" stroke-width="2.2" stroke-linecap="round" />`,
  outfit_vest: `
    <path d="M14 20c6-4 14-6 22-6s16 2 22 6l-4 25c-6 4-12 6-18 6s-12-2-18-6Z"
      fill="#6aa9ff" stroke="#3b6fbd" stroke-width="3" stroke-linejoin="round" />
    <path d="M28 16c3 6 5 9 8 11 3-2 5-5 8-11" fill="none" stroke="#3b6fbd" stroke-width="2.8" stroke-linecap="round" />
    <circle cx="36" cy="30" r="2" fill="#fff8e8" /><circle cx="36" cy="38" r="2" fill="#fff8e8" />`,
  bg_starry: `
    <defs>
      <linearGradient id="thumbNight" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stop-color="#2b2f6b" /><stop offset="1" stop-color="#5a4380" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="64" height="64" rx="16" fill="url(#thumbNight)" />
    <circle cx="50" cy="20" r="7" fill="#ffe9a8" />
    <g fill="#ffffff"><circle cx="18" cy="18" r="1.8" /><circle cx="30" cy="34" r="1.4" /><circle cx="52" cy="42" r="1.8" /><circle cx="22" cy="50" r="1.5" /></g>`,
}

/**
 * 商城 / 装扮卡用的小图。未收录的 key 返回通用星形，避免界面空白。
 * @param {string} costumeKey
 */
export function costumeThumb(costumeKey) {
  const body = THUMBS[costumeKey]
  if (!body) {
    return `<svg class="costume-thumb" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="20" fill="#ffe0c4" />
    </svg>`
  }
  return `<svg class="costume-thumb" viewBox="0 0 72 72" aria-hidden="true">${body}</svg>`
}
