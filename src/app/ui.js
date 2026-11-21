/**
 * UI 工具：转义、Toast、底部面板、星星飞溅、数字滚动。
 * 只操作 DOM，不触碰数据层。
 */

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

/** 2026-11-21 → { short: "11月21日", weekday: "周六" } */
export function describeDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return {
    short: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: WEEKDAYS[date.getDay()],
  }
}

/** YYYY-MM-DD → 11月21日（用于流水日期标签，绝不对 ISO 时间戳截位） */
export function describeDateKey(dateKey) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ""))
  if (!matched) return ""
  return `${Number(matched[2])}月${Number(matched[3])}日`
}

/** 相对今天偏移 N 天的本地自然日键（YYYY-MM-DD），不走 UTC */
export function dateKeyOffset(days = 0) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** 相对今天偏移 N 天的中文日期，如 11月22日 */
export function dateLabelOffset(days = 0) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** ISO 时间戳 → 14:05 */
export function describeTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

export function greeting(hour = new Date().getHours()) {
  if (hour < 6) return "夜深了"
  if (hour < 11) return "早上好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

let toastTimer = 0

const TOAST_ICON = {
  ok: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.6 4.6L19 7"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.4"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5 21 20H3Z"/><path d="M12 10v4.4"/><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none"/></svg>`,
}

/**
 * 顶部轻提示。同一时刻只保留一条，避免堆叠。
 * @param {string} message
 * @param {"ok"|"info"|"warn"} tone
 */
export function toast(message, tone = "ok") {
  const layer = document.getElementById("toast-layer")
  if (!layer) return
  window.clearTimeout(toastTimer)
  layer.innerHTML = `<div class="toast toast--${tone}">${TOAST_ICON[tone] ?? TOAST_ICON.ok}<span>${escapeHtml(message)}</span></div>`
  const node = layer.firstElementChild
  requestAnimationFrame(() => node.classList.add("is-in"))
  toastTimer = window.setTimeout(() => {
    node.classList.remove("is-in")
    window.setTimeout(() => node.remove(), 320)
  }, 2400)
}

/* ---------------- 底部面板 ---------------- */

let sheetCloser = null

/**
 * @param {string} html 面板内部 HTML
 * @param {{ onMount?: (panel: HTMLElement) => void, labelledBy?: string }} [options]
 */
export function openSheet(html, { onMount, labelledBy } = {}) {
  const layer = document.getElementById("sheet-layer")
  if (!layer) return
  layer.innerHTML = `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet" role="dialog" aria-modal="true" ${labelledBy ? `aria-labelledby="${labelledBy}"` : ""}>
      <div class="sheet__grab" aria-hidden="true"></div>
      ${html}
    </section>`
  const panel = layer.querySelector(".sheet")

  const onKey = (event) => {
    if (event.key === "Escape") closeSheet()
  }
  const onBackdrop = (event) => {
    if (event.target.closest("[data-sheet-close]")) closeSheet()
  }

  layer.addEventListener("click", onBackdrop)
  document.addEventListener("keydown", onKey)
  document.body.classList.add("has-sheet")

  sheetCloser = () => {
    layer.removeEventListener("click", onBackdrop)
    document.removeEventListener("keydown", onKey)
    document.body.classList.remove("has-sheet")
    panel.classList.remove("is-in")
    layer.classList.remove("is-open")
    window.setTimeout(() => {
      if (layer.classList.contains("is-open")) return
      layer.innerHTML = ""
    }, 340)
    sheetCloser = null
  }

  layer.classList.add("is-open")
  requestAnimationFrame(() => panel.classList.add("is-in"))
  onMount?.(panel)
}

export function closeSheet() {
  sheetCloser?.()
}

export function isSheetOpen() {
  return Boolean(document.getElementById("sheet-layer")?.classList.contains("is-open"))
}

/* ---------------- 星星飞溅 ---------------- */

const STAR_PATH =
  "M12 2.6l2.9 6 6.6.9-4.8 4.7 1.2 6.6L12 17.7 6.1 20.8l1.2-6.6L2.5 9.5l6.6-.9Z"

/**
 * 从屏幕坐标爆出一簇星星。
 * @param {number} x
 * @param {number} y
 * @param {number} [count]
 */
export function starBurst(x, y, count = 10) {
  const layer = document.getElementById("burst-layer")
  if (!layer) return
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  for (let index = 0; index < count; index += 1) {
    const node = document.createElement("span")
    node.className = "burst-star"
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5
    const distance = 46 + Math.random() * 58
    node.style.setProperty("--dx", `${Math.cos(angle) * distance}px`)
    node.style.setProperty("--dy", `${Math.sin(angle) * distance - 26}px`)
    node.style.setProperty("--rot", `${Math.round(Math.random() * 220 - 110)}deg`)
    node.style.left = `${x}px`
    node.style.top = `${y}px`
    node.style.animationDelay = `${index * 14}ms`
    node.innerHTML = `<svg viewBox="0 0 24 24" width="${14 + Math.round(Math.random() * 12)}" fill="currentColor" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`
    layer.appendChild(node)
    window.setTimeout(() => node.remove(), 1100)
  }
}

/* ---------------- 数字滚动 ---------------- */

/**
 * 让数字从 from 滚到 to，带缓出。尊重减弱动效设置。
 * @param {HTMLElement|null} element
 * @param {number} to
 * @param {number} from
 */
export function countUp(element, to, from = 0) {
  if (!element) return
  const target = Number(to) || 0
  const start = Number(from) || 0
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === start) {
    element.textContent = String(target)
    return
  }
  const duration = 620
  const startedAt = performance.now()
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - (1 - progress) ** 3
    element.textContent = String(Math.round(start + (target - start) * eased))
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** 元素中心点（用于飞星星的起点/终点） */
export function centerOf(element) {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/* ---------------- 文件下载 ---------------- */

/**
 * 触发浏览器下载一段文本（备份导出用）。
 * 用 Blob + 临时 `<a download>`，不需要后端，也不依赖 File System Access API。
 * @param {string} fileName
 * @param {string} text
 * @param {string} [mime]
 * @returns {boolean} 是否成功触发
 */
export function downloadText(fileName, text, mime = "application/json") {
  if (typeof document === "undefined") return false
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = fileName
    anchor.rel = "noopener"
    anchor.style.display = "none"
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    return true
  } catch {
    return false
  }
}

/**
 * 复制文本到剪贴板。
 * 恢复码这类"只能看一次"的东西，光靠手抄容易出错，给个复制按钮更稳。
 * 剪贴板 API 需要安全上下文（https / localhost），取不到时退化为 execCommand。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  if (typeof document === "undefined" || typeof text !== "string" || text === "") return false
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.top = "-1000px"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** 把字节数说成人话 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/** ISO 时间戳 → 11月21日 18:12 */
export function describeDateTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`
}

/** "多久以前"：刚刚 / 3 小时前 / 2 天前 / 具体日期 */
export function describeRelative(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return "刚刚"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return describeDateTime(iso)
}
