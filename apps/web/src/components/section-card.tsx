import type { ReactNode } from 'react'

export function SectionCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card shadow-card">
    <h2 className="border-b border-border px-6 py-4 font-semibold">{title}</h2>
    {children}
  </section>
}
