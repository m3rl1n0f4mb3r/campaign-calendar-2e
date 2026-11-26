import { useEffect, useRef } from 'react'

const topics = {
  'get-started': 'Get started',
  'close-a-turn': 'Close a domain turn',
  'resolve-a-disaster': 'Resolve a disaster and apply its effect',
  'battle-siege-records': 'Record a battle or siege',
  'military-expenses': 'Track garrisons and military expenses',
  'estimate-construction': 'Estimate a castle project',
  'track-construction': 'Track castle construction',
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
      <p>Choose <strong>Campaign → New campaign</strong> to start with a calendar template. Select a date on the grid, then select its <strong>+</strong> or use <strong>New event</strong> to schedule something on that date.</p>
      <p>Browsing the calendar leaves campaign time where it is. Select the dated button in the calendar toolbar to jump back to the campaign date. Open <strong>Campaign clock options</strong> beside it for <strong>Set date</strong> or <strong>Advance one day</strong>.</p>
      <p>Open <strong>Campaign → Calendar settings → Moons</strong> to control whether moon phases appear on the calendar. Use <strong>Campaign → Print</strong> to print the current view or a range of months and festivals, with your choice of event types and moon phases.</p>
      <p>Use <strong>Campaign → Backups and data</strong> to download a backup of the active campaign. Restoring a backup replaces the campaign selected in the app, including its events, holdings, and turn history.</p>
    </section>
    <section aria-labelledby="close-a-turn" hidden={topic !== 'get-started' && topic !== 'close-a-turn'}>
      <h3 id="close-a-turn" tabIndex={-1}>{topics['close-a-turn']}</h3>
      <p>Close a regular month to record a holding’s approved population changes, income, and expenses.</p>
      <ol>
        <li>Open <strong>Domain → Domain Play → Add holding</strong>. Enter the ruler, territory, families, and resources. Choose the <strong>First month to close</strong> and save the holding.</li>
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
        <li>When the target turn is due, select the effect under <strong>Approved effects and project costs</strong>. Check the updated ledger and record the turn to post it.</li>
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
    <section aria-labelledby="track-construction" hidden={topic !== 'get-started' && topic !== 'track-construction'}>
      <h3 id="track-construction" tabIndex={-1}>{topics['track-construction']}</h3>
      <p>For example, start a Greyhawk project during Growfest and review a weather delay when work begins in Planting.</p>
      <ol>
        <li>Open the holding’s <strong>Construction projects</strong> and choose <strong>Add project</strong>. Set the start to Growfest 1, enter the budget and required weeks, and leave <strong>Festival pace</strong> at <strong>No work</strong>. Apply the settings and choose <strong>Save construction changes</strong>. Review the forecast starting in Planting.</li>
        <li>Set the clock to the first scheduled workday in Planting. Open <strong>Review project</strong>. Roll or enter a d100 result, or choose <strong>Skip review</strong>. A result of 70 offers a weather stoppage. Approve it if it applies, record the review, and save the construction changes.</li>
        <li>At month-end, open <strong>Preview turn</strong> and find the <strong>Construction</strong> section. The saved review appears in its project. Approve any work actually completed through the closing date. A full-month stoppage normally means no scheduled work is credited.</li>
        <li>Use <strong>Queue construction cost</strong> to add a proposed expense. Select it under <strong>Approved effects and project costs</strong> and record the turn. The project shows it as posted after confirmation.</li>
        <li>Reopening the domain turn retains the project’s work and event history. Select the proposed cost again if it still applies. Use the separate project reopen controls to correct a work entry or review.</li>
      </ol>
    </section>
    <section aria-labelledby="battle-siege-records" hidden={topic !== 'get-started' && topic !== 'battle-siege-records'}>
      <h3 id="battle-siege-records" tabIndex={-1}>{topics['battle-siege-records']}</h3>
      <ol>
        <li>Open <strong>Domain → Battles and sieges</strong>. Enter the dates, participants, and outcome from play at the table. A siege without an end date appears in <strong>Active sieges</strong> while browsing dates on or after its start.</li>
        <li>Save the engagement, then propose consequences individually. Review the dated unit strength before approving a roster change. Link a repair project and any existing cost, or propose a separate one-off expense.</li>
        <li>Approve an expense in its target turn. For confidence, open the proposed review and decide whether to record a check. Use the linked roster, project, or receipt to correct applied consequences.</li>
      </ol>
    </section>
    <section aria-labelledby="military-expenses" hidden={topic !== 'get-started' && topic !== 'military-expenses'}>
      <h3 id="military-expenses" tabIndex={-1}>{topics['military-expenses']}</h3>
      <ol>
        <li>Open <strong>Domain → Domain Play → Garrison roster</strong> for a holding. Muster a unit, choose its effective date and service terms, then save the roster.</li>
        <li>Record dated deployments, arrivals, returns, losses, and releases. Use <strong>Roster date</strong> to review the unit's strength on a past or future date.</li>
        <li>In the monthly turn, review <strong>Military expenses</strong>. Approve, skip, or defer pay and extra supplies. A mid-month change needs a GM-entered amount. A deferred charge keeps its original service dates.</li>
        <li>When replaying a turn, review the original decisions and any charges that are no longer pending before recording it again.</li>
      </ol>
    </section>
    <section aria-labelledby="estimate-construction" hidden={topic !== 'get-started' && topic !== 'estimate-construction'}>
      <h3 id="estimate-construction" tabIndex={-1}>{topics['estimate-construction']}</h3>
      <ol>
        <li>Open <strong>Domain → Castle estimates → New estimate</strong>. Choose <strong>Stone wall</strong>, select <strong>Add module line</strong>, and set <strong>Quantity</strong> to 2. The default estimate is 1,100 gp and 66 worker-weeks after standard finish and overhead.</li>
        <li>Choose a <strong>Finish</strong> and review the seven <strong>Site Production Modifier</strong> factors. Changing a factor recalculates cost and labor. If you enter an override, note the reason.</li>
        <li>Under <strong>Staffing and work seasons</strong>, pick a crew preset or enter a custom plan. Special worker equivalents count toward the crew. Enter any agreed compensation separately. The Work Time Modifier is a planning reference. The finish forecast uses the project’s week length, festival pace, and dated closures.</li>
        <li>Select <strong>Save estimate draft</strong> to continue later, or <strong>Review project handoff</strong>. Choose a holding and create a project or revise an existing one. For a staffing revision, resolve pending work before its effective date. The preview shows the new budget, remaining work, and forecast. Confirm any completion change before applying it.</li>
        <li>Use <strong>Manage module catalog</strong> to edit or add campaign modules. Use <strong>Remove line</strong> and add the module again to bring an existing draft line up to date. Approved estimates are available under <strong>Approved estimate history</strong> in the project.</li>
      </ol>
    </section>
  </dialog>
}
