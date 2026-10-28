/**
 * new-api 控制台的入口地址。
 *
 * iframe 里的链接用 target="_top" 让父页面（new-api）路由跳转，因此 href 必须
 * 指向 new-api 而不是本面板。默认用相对路径 /dashboard：面板与 new-api 同源
 * 部署时（例如反代到 https://newapi.example.com/balance）它会落到
 * https://newapi.example.com/dashboard。
 *
 * 面板部署在独立域名时，构建期用 FURIN_PUBLIC_NEWAPI_DASHBOARD_URL 指定 new-api 的
 * 绝对地址（例如 https://api.example.com/dashboard）；FURIN_PUBLIC_ 前缀的变量会被
 * furin 内联进浏览器包（bunfig.toml 的 [serve.static].env），只能放公开信息。
 */
export const newApiDashboardHref =
  process.env.FURIN_PUBLIC_NEWAPI_DASHBOARD_URL?.trim() || '/dashboard'
