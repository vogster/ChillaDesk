import type { z } from 'zod'

export type FieldErrors = Record<string, string>

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors }

/** Validates form values and keeps the first message for each field. */
export function parseForm<T>(schema: z.ZodType<T>, values: unknown): ParseResult<T> {
  const result = schema.safeParse(values)
  if (result.success) return { ok: true, data: result.data }

  const errors = result.error.issues.reduce<FieldErrors>((collected, issue) => {
    const field = issue.path.join('.')
    return field in collected ? collected : { ...collected, [field]: issue.message }
  }, {})
  return { ok: false, errors }
}

/**
 * Moves focus to the first field with an error, so keyboard and screen-reader users land on
 * the problem (the field announces its message through `aria-describedby`).
 */
export function focusFirstInvalid(form: HTMLFormElement, errors: FieldErrors): void {
  const invalid = Array.from(form.elements).find(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement && element.name in errors,
  )
  invalid?.focus()
}
