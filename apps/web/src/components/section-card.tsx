import type { ReactNode } from 'react'

export function SectionCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="rounded-xl border border-border bg-card">
    <h2 className="border-b border-border px-4 py-4 text-base leading-6 font-semibold">{title}</h2>
    {children}
  </section>
}
