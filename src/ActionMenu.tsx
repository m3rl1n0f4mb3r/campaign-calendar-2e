import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type Props = {
  label: string
  iconOnly?: boolean
  children: (choose: (action: () => void) => void) => ReactNode
}

export function ActionMenu({ label, iconOnly = false, children }: Props) {
  const id = useId()
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  function choose(action: () => void) {
    setOpen(false)
    trigger.current?.focus()
    action()
  }

  return <div ref={wrapper} className="action-menu"
    onBlur={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}
    onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation()
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }}>
    <button ref={trigger} type="button" className="action-menu-trigger" aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {!iconOnly && label}<span className="action-menu-chevron" aria-hidden="true"/>
    </button>
    <div className="action-menu-panel" id={id} hidden={!open}>{children(choose)}</div>
  </div>
}
