import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Confirmation = { title: string; message: string; label: string; cancelLabel?: string; danger?: boolean }
type Confirm = (options: Confirmation, action: () => void) => void
type Leave = (action: () => void) => void
const DraftContext = createContext<{ report: (id: string, dirty: boolean) => () => void; leave: Leave; confirm: Confirm } | undefined>(undefined)

export function useDialogDraft(dirty: boolean) {
  const context = useContext(DraftContext)
  const id = useId()
  useLayoutEffect(() => context?.report(id, dirty), [context?.report, dirty, id])
}

export function useDialogLeave(): Leave {
  return useContext(DraftContext)?.leave ?? (action => action())
}

export function useConfirmAction(): Confirm {
  const context = useContext(DraftContext)
  if (!context) throw new Error('Confirmation actions require a dialog.')
  return context.confirm
}

export function ConfirmButton({ options, action, children, className }: {
  options: Confirmation; action: () => void; children: ReactNode; className?: string
}) {
  const confirm = useConfirmAction()
  return <button type="button" className={className} onClick={() => confirm(options, action)}>{children}</button>
}

export function useChangedDraft(data: unknown, baseline?: unknown) {
  const current = JSON.stringify(data)
  const initial = useRef(current)
  useDialogDraft(current !== (baseline === undefined ? initial.current : JSON.stringify(baseline)))
}

export function Modal({ title, dismiss, children, className, focusOnOpen, fallbackFocus = false }: {
  title: string; dismiss: () => void; children: ReactNode; className?: string; focusOnOpen?: string; fallbackFocus?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const outside = useRef(false)
  const heading = useId()
  useLayoutEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    element.showModal()
    if (focusOnOpen) element.querySelector<HTMLElement>(focusOnOpen)?.focus()
    return () => {
      element.close()
      if (opener?.isConnected && !element.contains(opener) && opener !== document.body) opener.focus({ preventScroll: true })
      else if (fallbackFocus) document.querySelector<HTMLElement>('[data-dialog-fallback] button')?.focus({ preventScroll: true })
    }
  }, [fallbackFocus, focusOnOpen])

  const onBackdrop = (event: React.PointerEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom
  }
  return <dialog ref={dialog} className={className} aria-labelledby={heading}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); dismiss() }}
    onPointerDown={e => { outside.current = e.isPrimary && e.button === 0 && onBackdrop(e) }}
    onPointerCancel={() => { outside.current = false }}
    onPointerUp={e => {
      if (outside.current && e.isPrimary && onBackdrop(e)) { e.preventDefault(); dismiss() }
      outside.current = false
    }}>
    <header className="dialog-header"><h2 id={heading}>{title}</h2><button type="button" aria-label="Close dialog" onClick={dismiss}>×</button></header>
    <div className="dialog-body">{children}</div>
  </dialog>
}

export function Dialog({ title, close, dirty = false, saving = false, className, children }: {
  title: string; close: () => void; dirty?: boolean; saving?: boolean; className?: string; children: ReactNode
}) {
  const drafts = useRef(new Set<string>())
  const [report] = useState(() => (id: string, dirty: boolean) => {
    if (dirty) drafts.current.add(id)
    return () => { drafts.current.delete(id) }
  })
  const [confirmation, setConfirmation] = useState<(Confirmation & { action: () => void })>()
  const confirm: Confirm = (options, action) => {
    if (!saving) setConfirmation({ ...options, action })
  }
  const leave: Leave = action => {
    if (saving) return
    if (dirty || drafts.current.size) confirm({
      title: 'Discard changes?', message: 'You have unsaved changes.', label: 'Discard changes', cancelLabel: 'Keep editing', danger: true,
    }, action)
    else action()
  }
  const cancel = () => setConfirmation(undefined)
  return <DraftContext.Provider value={{ report, leave, confirm }}>
    <Modal title={title} className={className} fallbackFocus dismiss={() => leave(close)}>{children}</Modal>
    {confirmation && <Modal key={confirmation.title} title={confirmation.title} dismiss={cancel} focusOnOpen="[data-cancel-confirmation]">
      <p>{confirmation.message}</p>
      <div className="actions">
        <button type="button" data-cancel-confirmation onClick={cancel}>{confirmation.cancelLabel ?? 'Cancel'}</button>
        <button type="button" className={confirmation.danger ? 'danger' : 'primary'}
          onClick={() => { cancel(); confirmation.action() }}>{confirmation.label}</button>
      </div>
    </Modal>}
  </DraftContext.Provider>
}
