import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

interface ModalProps {
  /** Accessible name of the dialog. */
  label: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isTextEntry = (element: EventTarget | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement

/**
 * A centred dialog. Focus stays inside it and returns to where it was on close; the page
 * behind does not scroll. Escape or a click outside closes it.
 */
export function Modal({ label, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // While composing text (IME), Escape belongs to the input method.
    if (event.nativeEvent.isComposing) return

    if (event.key === 'Escape') {
      event.stopPropagation()
      // In a field the first Escape only leaves the field, so a slip of the finger does not
      // throw away a half-written description or comment along with the dialog.
      if (isTextEntry(event.target)) panelRef.current?.focus()
      else onClose()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = focusable?.[0]
    const last = focusable?.[focusable.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl outline-none dark:bg-slate-900"
      >
        {children}
      </div>
    </div>
  )
}
