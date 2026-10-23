import type { ReactNode } from 'react'
import { SiteFooter } from '~/components/site-footer'

export function AppLayout(props: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main id="main" className="flex-1 pt-16 sm:pt-20">
        {props.children}
      </main>
      <SiteFooter />
    </div>
  )
}
