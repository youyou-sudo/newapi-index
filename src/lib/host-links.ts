/**
 * new-api 控制台的入口地址。
 *
 * iframe 里的链接用 target="_top" 让父页面（new-api）路由跳转，因此 href 必须
 * 指向 new-api 而不是本面板。默认用相对路径 /dashboard：面板与 new-api 同源
 * 部署时（例如反代到 https://newapi.example.com/balance）它会落到
 * https://newapi.example.com/dashboard。
 *
 * 面板部署在独立域名时，用环境变量 VITE_NEWAPI_DASHBOARD_URL 指定 new-api 的
 * 绝对地址（例如 https://api.example.com/dashboard）。
 *
 * 这个值在**运行时**（每次 SSR 渲染页面的 loader 里）读取，不在构建期内联：
 * 同一个二进制 / 镜像可以部署多份，各自用不同的环境变量指向不同的 new-api，
 * 不需要为了改地址重新构建。浏览器端拿到的是服务端通过页面 props 序列化下来
 * 的 href，它本身不读 process.env，所以也不需要 FURIN_PUBLIC_ 之类的内联前缀。
 */
export function resolveNewApiDashboardHref(): string {
  const configured = process.env.VITE_NEWAPI_DASHBOARD_URL?.trim()
  return configured || '/dashboard'
}
