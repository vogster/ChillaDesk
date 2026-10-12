import type { ProjectMember } from '@chillawiki/shared'
import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type SyntheticEvent,
  type TextareaHTMLAttributes,
} from 'react'
import { useMembers } from '../projectQueries'
import { insertMention, mentionTokenAt, suggestMembers, type MentionToken } from './mentionModel'

interface MentionTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  projectId: string
}

/** Replaces part of the text the way typing would, so React and the form both see it. */
function typeInto(element: HTMLTextAreaElement, text: string, from: number, to: number): void {
  // Not `element.value = …`: React would then take the change for its own and tell nobody.
  element.setRangeText(text, from, to, 'end')
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * A textarea that suggests project members after `@`. Choosing one writes `@email`, which
 * is what the server looks for; readers see it as `@Name`.
 */
export function MentionTextarea({
  projectId,
  onChange,
  onKeyDown,
  onBlur,
  onSelect,
  ...props
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const choosing = useRef(false)
  const listId = useId()
  const [token, setToken] = useState<MentionToken | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // Members are only needed once someone types `@`.
  const members = useMembers(projectId, { enabled: token !== null })
  const suggestions = token && members.data ? suggestMembers(members.data, token.query) : []
  const active = suggestions[Math.min(activeIndex, suggestions.length - 1)]
  const optionId = (member: ProjectMember) => `${listId}-${member.userId}`

  /**
   * The token under the caret right now. The caret can move without the text changing, so
   * the one in state may describe a place the caret has left.
   */
  const liveToken = (): MentionToken | null => {
    const element = ref.current
    const live = element && mentionTokenAt(element.value, element.selectionStart)
    return live && live.start === token?.start ? live : null
  }

  const choose = (member: ProjectMember) => {
    const element = ref.current
    const live = liveToken()
    if (!element || !live) {
      setToken(null)
      return
    }
    const { value, selectionStart: caret } = element
    const next = insertMention(value, live, caret, member.email)
    const inserted = next.text.slice(live.start, next.text.length - (value.length - caret))
    // The change event of this very edit must not reopen the list.
    choosing.current = true
    typeInto(element, inserted, live.start, caret)
    choosing.current = false
    setToken(null)
    element.focus()
    element.setSelectionRange(next.caret, next.caret)
  }

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(event)
    if (choosing.current) return
    const { value, selectionStart } = event.currentTarget
    setToken(mentionTokenAt(value, selectionStart))
    setActiveIndex(0)
  }

  /** Follows the caret: the list belongs to the mention the caret is in, if any. */
  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    onSelect?.(event)
    if (choosing.current || token === null) return
    const { value, selectionStart } = event.currentTarget
    const live = mentionTokenAt(value, selectionStart)
    if (live?.start !== token.start || live.query !== token.query) setToken(live)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const modified = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
    if (active && !liveToken()) setToken(null)
    else if (active && !modified && !event.nativeEvent.isComposing) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step !== undefined) {
        event.preventDefault()
        setActiveIndex(
          (suggestions.indexOf(active) + step + suggestions.length) % suggestions.length,
        )
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        // Tab was used up here; a dialog around the field must not move the focus as well.
        event.stopPropagation()
        choose(active)
        return
      }
      if (event.key === 'Escape') {
        // Only the list closes: the dialog around the field stays open.
        event.preventDefault()
        event.stopPropagation()
        setToken(null)
        return
      }
    }
    onKeyDown?.(event)
  }

  const handleBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    setToken(null)
    onBlur?.(event)
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        {...props}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onSelect={handleSelect}
        aria-autocomplete="list"
        aria-controls={active ? listId : undefined}
        aria-activedescendant={active ? optionId(active) : undefined}
      />
      {active && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a member"
          className="absolute top-full left-0 z-20 mt-1 max-h-56 w-72 max-w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {suggestions.map((member) => (
            <li
              key={member.userId}
              id={optionId(member)}
              role="option"
              aria-selected={member === active}
              // Keeps the focus in the textarea, so the click is not lost to its blur.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(member)}
              className={`cursor-pointer px-3 py-1.5 ${
                member === active ? 'bg-indigo-50 dark:bg-indigo-950' : ''
              }`}
            >
              <span className="font-medium">{member.name}</span>{' '}
              <span className="text-slate-500">{member.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
