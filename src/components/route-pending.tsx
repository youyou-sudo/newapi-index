export function RoutePending() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16">
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="skeleton-shimmer h-8 w-56 rounded-lg" />
        <div className="skeleton-shimmer h-4 w-80 rounded-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="skeleton-shimmer h-48 rounded-2xl"
            />
          ))}
        </div>
      </div>
    </main>
  )
}
