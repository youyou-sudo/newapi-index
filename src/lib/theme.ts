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
 * 父页也不监听子页消息。消息总是在 iframe load 之后才到，比首屏晚，所以首屏必须
 * 先用系统主题直接绘制，收到消息后只做一次颜色重绘——绝不能用 visibility:hidden
 * 等它：那会把整个页面压到 load 之后才出现，进场动画也会在不可见状态下跑完。
 * 见 README「主题契约」。
 */

/** new-api 下发的消息字段名。 */
export const HOST_THEME_MESSAGE_KEY = 'themeMode'

/** 独立打开/本地调试时可用 ?theme=light|dark|system 强制主题。 */
export const THEME_QUERY_PARAM = 'theme'

/**
 * 首屏内联脚本（放在 <head>，先于任何渲染）：
 * - 立刻按 ?theme= 或系统偏好给 <html> 打上 .dark / color-scheme，第一帧就是正确
 *   的底色，不需要遮罩等待宿主；
 * - 同步注册 message 监听（不能等 React effect，否则会丢掉 iframe load 那条消息），
 *   收到宿主主题后就地重绘；
 * - ?theme= 显式指定时以它为准（在 new-api 里固定放 ?theme=dark 即可首帧深色，
 *   完全不会出现换色）。
 */
export const hostThemeInitScript = `(function () {
  var root = document.documentElement;
  var query = null;
  try {
    query = new URLSearchParams(window.location.search).get('${THEME_QUERY_PARAM}');
  } catch (error) {}
  var override = query === 'light' || query === 'dark' || query === 'system' ? query : null;
  var theme = override || 'system';
  var media = null;
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (error) {}
  function apply(next) {
    var dark = next === 'dark' || (next === 'system' && !!media && media.matches);
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.setAttribute('data-host-theme', next);
  }
  apply(theme);
  // 宿主（new-api）在 iframe load 与主题切换时下发 { themeMode: 'light' | 'dark' }。
  // 这里必须是同步监听：延迟注册会丢掉 onLoad 那条消息（上游 issue #7123）。
  // 显式 ?theme= 时忽略宿主，保持「强制主题」语义。
  window.addEventListener('message', function (event) {
    if (override) return;
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
  });
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', function () {
      if (override) return;
      apply(theme);
    });
  }
})();`;
