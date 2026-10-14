import type { ClientRect, KeyboardCoordinateGetter } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { isColumnDropId } from './moves'

const centreX = (rect: ClientRect) => rect.left + rect.width / 2

/**
 * Keys for moving a card: up and down move it within its column, as the drag library does;
 * left and right move it to the top of the neighbouring column in one press. The library's
 * own handling of left and right looks for the nearest target in that direction, which is
 * often still in the card's own column, so the first press seemed to do nothing.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
    return sortableKeyboardCoordinates(event, args)
  }
  event.preventDefault()
  const { collisionRect, droppableRects, droppableContainers } = args.context
  if (!collisionRect) return undefined

  const columns = droppableContainers
    .getEnabled()
    .filter((container) => isColumnDropId(String(container.id)))
    .flatMap((container) => droppableRects.get(container.id) ?? [])
    .sort((left, right) => left.left - right.left)
  const card = centreX(collisionRect)
  // The column the card is in is the one its centre is over, or failing that the nearest.
  const current = columns.reduce<number>(
    (best, rect, index) =>
      Math.abs(centreX(rect) - card) < Math.abs(centreX(columns[best] ?? rect) - card)
        ? index
        : best,
    0,
  )
  const target = columns[current + (event.code === 'ArrowRight' ? 1 : -1)]
  if (!target) return undefined
  return { x: target.left, y: target.top }
}
