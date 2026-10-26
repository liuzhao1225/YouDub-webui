/**
 * Fixed-palette plugin artwork for the plugin management surfaces. Unlike the
 * ic_ds_* set these glyphs carry their own brand colors and gradients instead
 * of riding currentColor; all draw on a 36×36 viewBox and take a size.
 */
import { useId } from 'react'
import type { IconProps } from './icons/props.ts'

/**
 * A per-instance SVG def id prefix: the artwork repeats across cards and rows,
 * and duplicate document ids would make every `url(#…)` resolve to the first instance.
 */
const useArtworkId = (): string => `dsh_plugin_art_${useId().replaceAll(':', '')}`

/** Default plugin artwork for plugins without one of their own (connector blocks and a node). */
export const PluginArtworkDefault = ({ size = 36 }: Pick<IconProps, 'size'>) => {
  const uid = useArtworkId()
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24.6294 8.63696C26.2862 8.63705 27.6294 9.98016 27.6294 11.637V12.7825C27.6292 14.4391 26.2861 15.7824 24.6294 15.7825H23.4839C22.6519 15.7825 21.5454 16.3459 21.5454 17.1778V18.1573C21.5454 18.7757 22.216 19.1966 22.8345 19.1965H24.6294C26.2861 19.1965 27.6292 20.5398 27.6294 22.1965V23.9924C27.6292 25.6491 26.2861 26.9924 24.6294 26.9924H22.8345C21.1778 26.9924 19.8347 25.649 19.8345 23.9924V22.1965C19.8345 21.7148 19.4957 21.2327 19.014 21.2327H16.4792C15.7975 21.2327 15.3374 22.0061 15.3374 22.6877V23.8333C15.3373 25.49 13.9942 26.8333 12.3374 26.8333H11.1919C9.53509 26.8333 8.19198 25.49 8.19189 23.8333V22.6877C8.19189 21.0309 9.53504 19.6877 11.1919 19.6877H12.3374C13.1964 19.6877 14.3999 19.0959 14.3999 18.2369V16.0185C14.3999 14.9518 15.2646 14.0872 16.3312 14.0872H19.435C20.0596 14.0872 20.484 13.4071 20.4839 12.7825V11.637C20.4839 9.98011 21.827 8.63696 23.4839 8.63696H24.6294ZM13.4116 11.2468C13.4116 12.6882 12.2431 13.8567 10.8018 13.8567C9.36037 13.8567 8.19189 12.6882 8.19189 11.2468C8.19189 9.80544 9.36037 8.63696 10.8018 8.63696C12.2431 8.63696 13.4116 9.80544 13.4116 11.2468Z" fill={`url(#${uid}a)`} />
      <defs>
        <linearGradient id={`${uid}a`} x1="15.1481" y1="9.94188" x2="15.1481" y2="13.6375" gradientUnits="userSpaceOnUse">
          <stop stopColor="#54ECE7" />
          <stop offset="1" stopColor="#658EFF" />
        </linearGradient>
      </defs>
    </svg>
  )
}
