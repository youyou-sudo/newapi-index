/**
 * 宿主（new-api）主题桥接。
 *
 * new-api 的自定义首页把本页面放进 iframe，且 sandbox 不含 allow-same-origin：
 * 文档处于 opaque origin，读父页 localStorage、写自己的 localStorage 都会抛
 * SecurityError，因此父页在 iframe 加载完成后下发的 postMessage 是唯一的主题信号。
 *
 * 契约（new-api web/src/features/home/index.tsx）：
 *   iframe.contentWindow.postMessage({ themeMode: 'light' | 'dark' }, '*')
 *   iframe.contentWindow.postMessage({ lang: 'zh-CN' }, '*')
 * 发送时机：iframe onLoad、iframe 已存在时的主题切换；没有握手、没有 type 字段、
 * 父页也不监听子页消息。消息可能在 hydration 之后才到达，所以监听器必须写进
 * <head> 的阻塞内联脚本，而不是 React effect。
 */

/** new-api 下发的消息字段名。 */
export const HOST_THEME_MESSAGE_KEY = 'themeMode'

/** 独立打开/本地调试时可用 ?theme=light|dark|system 强制主题。 */
export const THEME_QUERY_PARAM = 'theme'

/**
 * 首屏内联脚本：new-api 在 iframe onLoad 时才发第一条消息，而 SSR 的 HTML
 * 在那之前已经绘制。嵌入状态下先给 html 打 data-host-theme-pending 遮住正文，
 * 收到宿主主题（或 700ms 兜底超时）后立刻解除，避免「宿主要深色、系统是浅色」
 * 时闪一下浅色。独立打开时直接跟随 prefers-color-scheme，不遮罩。
 */
export const hostThemeInitScript = `(function () {
  var root = document.documentElement;
  var query = null;
  try {
    query = new URLSearchParams(window.location.search).get('${THEME_QUERY_PARAM}');
  } catch (error) {}
  var theme = query === 'light' || query === 'dark' || query === 'system' ? query : 'system';
  var media = null;
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (error) {}
  var embedded = false;
  try {
    embedded = window.parent !== window;
  } catch (error) {
    embedded = true;
  }
  function apply(next) {
    var dark = next === 'dark' || (next === 'system' && !!media && media.matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
  function release() {
    root.removeAttribute('data-host-theme-pending');
  }
  apply(theme);
  if (embedded && query !== 'light' && query !== 'dark' && query !== 'system') {
    root.setAttribute('data-host-theme-pending', '');
    setTimeout(release, 700);
  }
  // 宿主（new-api）在 iframe load 与主题切换时下发 { themeMode: 'light' | 'dark' }。
  // 这里必须是同步监听：延迟注册会丢掉 onLoad 那条消息（上游 issue #7123）。
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    var next = null;
    if (typeof data === 'string') {
      next = data;
    } else if (data && typeof data === 'object') {
      next = data.${HOST_THEME_MESSAGE_KEY} || data.theme || data.mode || null;
    }
    if (next !== 'light' && next !== 'dark' && next !== 'system') return;
    theme = next;
    apply(theme);
    release();
  });
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', function () {
      apply(theme);
    });
  }
})();`;
