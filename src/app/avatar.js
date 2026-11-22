/**
 * 孩子头像：展示 + 选图 + 裁剪（M6）。
 *
 * 两种来源并存（`design/07` §7.1）：
 * - **预设**：`avatarKey`（8 个 key 之一）→ 显示 Emoji；
 * - **自己的照片**：`avatarImage`（dataURL）→ 圆形显示。
 *
 * 两条不变量：
 * 1. 上传照片时**不删** `avatarKey`，它是"恢复默认"的落点；
 * 2. 恢复默认只删 `avatarImage`，`avatarKey` 保留（或被同时选中的新预设替换）。
 *
 * 为什么存 dataURL 而不是 Blob（`design/05` Q-M6-01 的结论）：
 * 备份是整表导出的 JSON，`Blob` 序列化会变成 `{}`，头像就丢了；
 * dataURL 是字符串，备份 / 恢复 / 清空三条链路**零改动**。
 * 代价是 `children` 单行变大（20–55KB），家庭孩子数 < 5 时可忽略。
 *
 * 处理规格：原图 ≤ 5MB、先按字节拒绝再解码（低端机不因超大图卡死）、
 * 居中裁切 + 拖动 + 缩放、输出 256×256 JPEG q0.82（白底，透明区域变白而不是变黑）。
 */

import { avatarOf } from "./icons.js"

/** 原图上限：超过直接拒，不在前端解码大图 */
export const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024
/** 输出边长（最大展示 112px，2× 屏够用） */
export const AVATAR_OUTPUT_SIZE = 256
/** JPEG 质量：0.82 时 256×256 人像约 15–30KB */
export const AVATAR_JPEG_QUALITY = 0.82
/** 缩放范围 */
export const AVATAR_MIN_SCALE = 1
export const AVATAR_MAX_SCALE = 3

const ACCEPTED_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"])

/**
 * 允许直接塞进 `<img src>` 的图片数据。
 *
 * 为什么这里还要再校验一次：`avatarImage` 也可能是从**别人给的备份文件**导入的，
 * 备份导入只校验结构、不校验每个字段的内容。如果直接拼进 HTML，
 * 一串 `"><img onerror=...>` 就能在本地页面执行脚本。
 * 只放行 `data:image/{jpeg,png,webp};base64,` + 纯 base64 字符，其余一律不渲染。
 */
const SAFE_AVATAR_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

function safeAvatarImage(value) {
  return typeof value === "string" && SAFE_AVATAR_IMAGE.test(value) ? value : ""
}

function avatarError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * 头像的统一渲染。所有页面（头部、卡片、审核、兑换、切换面板）都走这里，
 * 改一处即可全局生效，不会出现"某个页面还显示旧 emoji"。
 *
 * @param {{ avatarKey?: string, avatarImage?: string|null } | null | undefined} child
 * @param {{ size?: "xs"|"sm"|"md"|"lg"|"xl", className?: string, alt?: string }} [options]
 */
export function avatarMarkup(child, { size = "md", className = "", alt = "" } = {}) {
  const classes = ["avatar-view", `avatar-view--${size}`, className].filter(Boolean).join(" ")
  const image = safeAvatarImage(child?.avatarImage)

  if (image) {
    return `<span class="${classes}"><img class="avatar-view__img" src="${image}" alt="${alt}" decoding="async" /></span>`
  }

  const preset = avatarOf(child?.avatarKey)
  return `<span class="${classes}" aria-hidden="true"><span class="avatar-view__emoji">${preset.emoji}</span></span>`
}

/**
 * 读一张本地图片。**校验顺序有讲究**：
 * 先看字节数 → 再看 MIME → 最后才解码。反过来会让一张 20MB 的图先进内存。
 *
 * @param {File} file
 * @returns {Promise<{ image: HTMLImageElement, width: number, height: number, dispose: () => void }>}
 */
export function loadAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(avatarError("empty", "没选到图片"))
      return
    }
    if (Number(file.size) > AVATAR_MAX_FILE_BYTES) {
      reject(avatarError("too-large", "这张图超过 5MB，换一张小一点的"))
      return
    }
    if (!ACCEPTED_TYPES.includes(String(file.type).toLowerCase())) {
      reject(avatarError("type", "这张图打不开，换一张 JPG 或 PNG 试试"))
      return
    }

    const url = URL.createObjectURL(file)
    const image = new Image()
    let settled = false

    const cleanup = () => {
      URL.revokeObjectURL(url)
    }

    image.onload = () => {
      if (settled) return
      settled = true
      if (!image.naturalWidth || !image.naturalHeight) {
        cleanup()
        reject(avatarError("decode", "这张图读不出来，换一张试试"))
        return
      }
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: cleanup,
      })
    }

    image.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(avatarError("decode", "这张图读不出来，换一张试试"))
    }

    image.src = url
  })
}

/**
 * 按 cover 方式绘制到方块画布：图片铺满、居中、可缩放与平移。
 * 透明区域先铺白底——JPEG 没有 alpha，不铺底会变黑。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement} image
 * @param {{ size: number, scale?: number, offsetX?: number, offsetY?: number }} options
 * @returns {{ drawWidth: number, drawHeight: number, maxOffsetX: number, maxOffsetY: number }}
 */
export function drawAvatarCover(ctx, image, { size, scale = 1, offsetX = 0, offsetY = 0 }) {
  const base = Math.max(size / image.naturalWidth, size / image.naturalHeight)
  const ratio = base * scale
  const drawWidth = image.naturalWidth * ratio
  const drawHeight = image.naturalHeight * ratio
  const x = (size - drawWidth) / 2 + offsetX
  const y = (size - drawHeight) / 2 + offsetY

  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(image, x, y, drawWidth, drawHeight)

  return {
    drawWidth,
    drawHeight,
    maxOffsetX: Math.max(0, (drawWidth - size) / 2),
    maxOffsetY: Math.max(0, (drawHeight - size) / 2),
  }
}

/** 把平移量夹在"不露白边"的范围内 */
export function clampOffset(value, max) {
  const limit = Math.max(0, max)
  return Math.min(limit, Math.max(-limit, Number(value) || 0))
}

/**
 * 导出成 dataURL。预览与导出用同一个 `drawAvatarCover`，
 * 保证"看到什么就存什么"，不会出现预览缩略、存下来变形。
 *
 * @param {HTMLImageElement} image
 * @param {{ scale?: number, offsetX?: number, offsetY?: number }} [options]
 */
export function exportAvatarDataUrl(image, { scale = 1, offsetX = 0, offsetY = 0 } = {}) {
  const canvas = document.createElement("canvas")
  canvas.width = AVATAR_OUTPUT_SIZE
  canvas.height = AVATAR_OUTPUT_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw avatarError("canvas", "这台设备的浏览器画不了图，换一个浏览器再试")
  drawAvatarCover(ctx, image, { size: AVATAR_OUTPUT_SIZE, scale, offsetX, offsetY })
  return canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY)
}
