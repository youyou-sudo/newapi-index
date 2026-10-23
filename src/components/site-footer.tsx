export function SiteFooter() {
  return (
    <footer className="border-border/60 mt-16 border-t">
      <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-8 text-xs sm:flex-row sm:px-6">
        <p className="flex items-center gap-1.5">
          <span>© 2026 忧忧魔导局</span>
        </p>
        {/*<p>所有数据仅在本机服务端读取与渲染</p>*/}
      </div>
    </footer>
  )
}
