import { labelColorSchema, type Label, type LabelColor } from '@chillawiki/shared'

const COLOR_STYLES: Record<LabelColor, string> = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
}

export const LABEL_COLORS = labelColorSchema.options

export const colorName = (color: LabelColor) => color[0]?.toUpperCase() + color.slice(1)

export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_STYLES[label.color]}`}
    >
      {label.name}
    </span>
  )
}

/** The labels of a task as a list; renders nothing for a task without labels. */
export function LabelList({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null
  return (
    <ul aria-label="Labels" className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <li key={label.id} className="max-w-full">
          <LabelChip label={label} />
        </li>
      ))}
    </ul>
  )
}

export function ColorOptions() {
  return LABEL_COLORS.map((color) => (
    <option key={color} value={color}>
      {colorName(color)}
    </option>
  ))
}
