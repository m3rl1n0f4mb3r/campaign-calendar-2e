import { useEffect, useRef } from 'react'

const topics = {
  'get-started': 'Get started',
  'close-a-turn': 'Close a domain turn',
  'resolve-a-disaster': 'Resolve a disaster and apply its effect',
  'reopen-a-turn': 'Reopen and replay a turn',
}

export type GuideTopic = keyof typeof topics

export function UserGuide({ topic, onClose }: { topic: GuideTopic; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)

  function focusTopic(id: GuideTopic) {
    const heading = dialog.current?.querySelector<HTMLElement>(`#${id}`)
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView({ block: 'start' })
  }

  useEffect(() => {
    const modal = dialog.current
    if (!modal) return
    if (!modal.open) modal.showModal()
    if (topic !== 'get-started') focusTopic(topic)
    return () => { if (modal.open) modal.close() }
  }, [topic])

  return <dialog className="guide-dialog" ref={dialog} aria-labelledby="guide-title" onClose={onClose}>
    <header className="dialog-header">
      <h2 id="guide-title">User Guide</h2>
      <button type="button" autoFocus onClick={() => dialog.current?.close()}>Close guide</button>
    </header>
    <section aria-labelledby="get-started" hidden={topic !== 'get-started'}>
      <h3 id="get-started" tabIndex={-1}>{topics['get-started']}</h3>
      <p>Choose <strong>New campaign</strong> to start with a calendar template. Select a date on the grid, then select its <strong>+</strong> or use <strong>New event</strong> to schedule something on that date.</p>
      <p>Browsing the calendar leaves campaign time where it is. Use <strong>Set date</strong> or <strong>Advance one day</strong> in the sidebar to change the campaign clock. Select <strong>Campaign date</strong> in the calendar toolbar to return to it.</p>
      <p>Use <strong>Data</strong> to download a backup of the active campaign. Restoring a backup replaces the campaign selected in the app, including its events, holdings, and turn history.</p>
    </section>
    <section aria-labelledby="close-a-turn" hidden={topic !== 'get-started' && topic !== 'close-a-turn'}>
      <h3 id="close-a-turn" tabIndex={-1}>{topics['close-a-turn']}</h3>
      <p>Close a regular month to record a holding’s approved population changes, income, and expenses.</p>
      <ol>
        <li>Open <strong>Domain Play → Add holding</strong>. Enter the ruler, territory, families, and resources. Choose the <strong>First month to close</strong> and save the holding.</li>
        <li>Move the campaign clock to the holding’s closing date. Open <strong>Domain Play</strong> and choose <strong>Preview turn</strong>. If several months are due, start with the earliest one. Festivals have no turn of their own.</li>
        <li>Review each territory’s population and resources. The first territory turn leaves suggested growth off by default. Enter adjustments or approve growth as needed.</li>
        <li>Review the separate cash and noncash balances. Enter expenses, select applicable event effects, and approve any liege payment, tithe, or XP award you want to record.</li>
        <li>Select <strong>Record turn</strong>. Open the receipt from the calendar’s <strong>Domain turn</strong> entry or the holding’s <strong>Turn history</strong>.</li>
      </ol>
    </section>
    <section aria-labelledby="resolve-a-disaster" hidden={topic !== 'get-started' && topic !== 'resolve-a-disaster'}>
      <h3 id="resolve-a-disaster" tabIndex={-1}>{topics['resolve-a-disaster']}</h3>
      <p>For example, an earthquake on Growfest 2 in Greyhawk can reduce resource income in Planting, the next regular month.</p>
      <ol>
        <li>Open the holding’s <strong>Confidence and events</strong> panel. Select <strong>Schedule event</strong>, enter the earthquake and its date, check <strong>Natural disaster</strong>, and save.</li>
        <li>When the campaign clock reaches the event date, open the event and select <strong>Resolve event</strong>, then <strong>Review confidence</strong>. A <strong>One-check modifier</strong> applies only to that check. Use <strong>Lasting change</strong> to change the holding’s score. For a standalone monthly adjustment, select <strong>Add confidence check or adjustment</strong> and choose the <strong>Monthly adjustment</strong> trigger.</li>
        <li>Under <strong>Financial effects</strong>, choose the resolved event or its confidence check as the source. For a lost harvest, select <strong>Resource income</strong> and <strong>Noncash</strong>, then enter a negative amount. Choose the target month and select <strong>Approve effect for turn</strong>. If the target month is already closed, you can use the next unresolved turn.</li>
        <li>When the target turn is due, select the effect under <strong>Approved event and confidence effects</strong>. Check the updated ledger and record the turn to post it.</li>
      </ol>
    </section>
    <section aria-labelledby="reopen-a-turn" hidden={topic !== 'get-started' && topic !== 'reopen-a-turn'}>
      <h3 id="reopen-a-turn" tabIndex={-1}>{topics['reopen-a-turn']}</h3>
      <p>Rewinding the clock preserves receipts and balances. To correct a recorded month, reopen its turn.</p>
      <ol>
        <li>Open the receipt and choose <strong>Reopen turn</strong>. Review the selected month and any later months that will reopen for the same holding. The confirmation shows the balances that will be restored.</li>
        <li>Use <strong>Download backup</strong> if you want to save the current state. Select <strong>Confirm reopen</strong> to clear the affected receipts and their calendar entries.</li>
        <li>Preview each reopened month in order once it is due. The preview starts with the original inputs and recalculates opening balances from the current ledger. <strong>Reset to current defaults</strong> uses the holding’s current settings.</li>
        <li>Review prior approvals. Payments, XP, and event effects need fresh approval. The event and confidence check remain recorded separately. Record the turn to replace its receipt.</li>
      </ol>
    </section>
  </dialog>
}
