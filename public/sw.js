/**
 * Service Worker — 静态资源缓存（不含任何业务数据）
 *
 * 策略：
 * - 应用外壳（HTML / Manifest）：安装时预缓存；页面导航优先网络，失败时回退缓存
 * - 构建产物（JS / CSS / 图片 / 字体）：缓存优先 + 回退网络，命中网络时写回缓存
 * - 仅处理同源 GET 请求；跨域请求一律交给网络，不缓存
 * - 新版本安装后不主动接管（不 skipWaiting），用户下次打开应用时生效
 *
 * 边界：本 SW 只缓存静态资源。IndexedDB 中的家庭数据不经过 SW，
 * 缓存存在不等于数据不会丢失，备份责任仍在家长端导出功能。
 */

const CACHE_VERSION = "v2"
const SHELL_CACHE = `shell-${CACHE_VERSION}`
const ASSET_CACHE = `assets-${CACHE_VERSION}`

const SHELL_ASSETS = ["./", "./index.html", "./manifest.webmanifest"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {
        // 预缓存失败不阻断安装：仍可通过网络正常使用
      })
  )
})

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE])
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))
      )
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, event))
    return
  }

  event.respondWith(cacheFirstAsset(request, event))
})

/** 页面导航：网络优先，离线时回退到已缓存的外壳 */
async function networkFirstNavigation(request, event) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      // 必须挂到 waitUntil：否则 SW 可能在写缓存前被浏览器回收
      event.waitUntil(cache.put(request, response.clone()))
    }
    return response
  } catch (err) {
    const cached =
      (await cache.match(request)) ||
      (await cache.match("./")) ||
      (await cache.match("./index.html"))
    if (cached) return cached
    throw err
  }
}

/** 静态资源：缓存优先，命中网络后写回缓存 */
async function cacheFirstAsset(request, event) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(ASSET_CACHE)
    event.waitUntil(cache.put(request, response.clone()))
  }
  return response
}
