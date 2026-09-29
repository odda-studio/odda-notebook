import { cn } from '@/lib/utils'

// Odda Studio mark: the pixel "O" (white) on the brand blue #2000FF.
// Drawn on a 12x12 grid so it stays crisp at any size.
const PIXELS: Array<[number, number, number, number]> = [
  // x, y, width, height (glyph offset by 2.5/2 to centre it)
  [4.5, 2, 3, 1], // top
  [3.5, 3, 1, 1],
  [7.5, 3, 1, 1],
  [2.5, 4, 1, 4], // left
  [8.5, 4, 1, 4], // right
  [3.5, 8, 1, 1],
  [7.5, 8, 1, 1],
  [4.5, 9, 3, 1], // bottom
]

export function OddaMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn('size-6 shrink-0 rounded-[4px]', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      shapeRendering="crispEdges"
    >
      {title && <title>{title}</title>}
      <rect width="12" height="12" fill="#2000FF" />
      {PIXELS.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill="#FFFFFF" />
      ))}
    </svg>
  )
}
