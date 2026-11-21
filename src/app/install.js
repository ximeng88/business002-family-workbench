/**
 * PWA 安装引导（M3·任务 4）。
 *
 * 只做三件事：
 * 1. 抓住 `beforeinstallprompt`（浏览器认为"这个站点可安装"时才触发）；
 * 2. 提供 `promptInstall()` 让设置页的按钮真正拉起系统安装弹窗；
 * 3. 暴露"是否已经以独立窗口运行"，用来决定显示"添加到主屏幕"还是"已经装好了"。
 *
 * 明确不做：不做 Service Worker 注册（在 `main.js` 里），不缓存业务数据。
 */

const listeners = new Set()
let deferredPrompt = null
let installed = false

function notify() {
  for (const listener of listeners) {
    try {
      listener(installState())
    } catch {
      // 单个订阅者出错不影响其他订阅者
    }
  }
}

/** 是否以独立应用（已添加到主屏幕 / 桌面）方式运行 */
export function isStandalone() {
  if (typeof window === "undefined") return false
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true
    if (window.matchMedia?.("(display-mode: fullscreen)")?.matches) return true
  } catch {
    // matchMedia 不可用
  }
  return Boolean(window.navigator?.standalone)
}

/** iOS 上不支持 beforeinstallprompt，只能给文字指引 */
export function isIos() {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent ?? ""
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ 伪装成 Mac，用触点数判断
  return /Macintosh/.test(ua) && Number(navigator.maxTouchPoints) > 1
}

export function installState() {
  const host = typeof location === "undefined" ? "" : location.hostname
  return {
    canPrompt: Boolean(deferredPrompt),
    installed: installed || isStandalone(),
    ios: isIos(),
    // 开发地址下没有 Service Worker，浏览器不会给 beforeinstallprompt，
    // 页面要说清楚为什么没有一键安装按钮，不然用户会以为按钮坏了
    localhost: host === "localhost" || host === "127.0.0.1" || host === "::1",
  }
}

/** 订阅安装状态变化，返回取消订阅函数 */
export function onInstallChange(listener) {
  if (typeof listener !== "function") return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 开始监听（mountApp 时调用一次；重复调用不会重复绑定） */
export function watchInstallPrompt() {
  if (typeof window === "undefined") return
  if (window.__b002InstallWatched) return
  window.__b002InstallWatched = true

  window.addEventListener("beforeinstallprompt", (event) => {
    // 拦下来，等家长在设置页主动点"添加到主屏幕"时再弹
    event.preventDefault()
    deferredPrompt = event
    notify()
  })

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    installed = true
    notify()
  })
}

/**
 * 拉起安装弹窗。
 * @returns {Promise<"accepted"|"dismissed"|"unavailable">}
 */
export async function promptInstall() {
  if (!deferredPrompt) return "unavailable"
  const event = deferredPrompt
  deferredPrompt = null
  try {
    await event.prompt()
    const choice = await event.userChoice
    notify()
    return choice?.outcome === "accepted" ? "accepted" : "dismissed"
  } catch {
    notify()
    return "unavailable"
  }
}
