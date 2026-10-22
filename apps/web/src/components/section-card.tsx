import type { ReactNode } from 'react'
import { Surface } from './ui/surface'
import styles from './ui/surfaces.module.css'
export function SectionCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <Surface><h2 className={styles.sectionTitle}>{title}</h2>{children}</Surface>
}
