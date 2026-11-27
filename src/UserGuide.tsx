import { useLayoutEffect, useRef, useState } from 'react'
import { Modal } from './Dialog'

const topics = {
  'get-started': 'Create and manage campaigns',
  'calendar-settings': 'Calendar settings and migration',
  'events': 'Create, repeat, and find events',
  'print': 'Print the calendar',
  'backups': 'Back up and restore a campaign',
  'manage-holdings': 'Set up and archive holdings',
  'quick-resolution': 'Use quick resolution',
  'close-a-turn': 'Close a domain turn',
  'resolve-a-disaster': 'Resolve a disaster and apply its effect',
  'battle-siege-records': 'Record a battle or siege',
  'military-expenses': 'Track garrisons and military expenses',
  'estimate-construction': 'Estimate a castle project',
  'track-construction': 'Track castle construction',
  'reopen-a-turn': 'Reopen and replay a turn',
}

type Article = keyof typeof topics
export type GuideTopic = Article | 'contents'
const groups: { title: string; articles: Article[] }[] = [
  { title: 'Campaign and calendar', articles: ['get-started', 'calendar-settings'] },
  { title: 'Events and output', articles: ['events', 'print', 'backups'] },
  { title: 'Domain Play', articles: ['manage-holdings', 'close-a-turn', 'resolve-a-disaster', 'reopen-a-turn'] },
  { title: 'Construction and warfare', articles: ['estimate-construction', 'track-construction', 'military-expenses', 'battle-siege-records', 'quick-resolution'] },
]

export function UserGuide({ topic, onClose }: { topic: GuideTopic; onClose: () => void }) {
  const [article, setArticle] = useState(topic)
  const guide = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const heading = guide.current?.querySelector<HTMLElement>(`#${article}`)
    heading?.focus({ preventScroll: true })
    heading?.scrollIntoView({ block: 'start' })
  }, [article])
  return <Modal title="User Guide" dismiss={onClose} className="guide-dialog">
    <div ref={guide}>
    {article !== 'contents' && <button type="button" onClick={() => setArticle('contents')}>Contents</button>}
    {article === 'contents' && <nav aria-labelledby="contents">
      <h3 id="contents" tabIndex={-1}>Contents</h3>
      <div className="guide-contents">{groups.map(group => <section key={group.title}>
        <h4>{group.title}</h4><ul>{group.articles.map(id => <li key={id}>
          <button type="button" onClick={() => setArticle(id)}>{topics[id]}</button>
        </li>)}</ul>
      </section>)}</div>
    </nav>}
    <section aria-labelledby="get-started" hidden={article !== 'get-started'}>
      <h3 id="get-started" tabIndex={-1}>{topics['get-started']}</h3>
      <p>Choose <strong>Campaign → New campaign</strong> to start with a generic, Dragonlance, or Greyhawk calendar. Use <strong>Switch campaign</strong> in the Campaign menu to move between campaigns stored in this browser.</p>
      <p>Rename the active campaign in <strong>Campaign → Calendar settings</strong>. To delete it, open <strong>Backups and data → Delete active campaign</strong> and review the confirmation. Download a backup first if you want to keep a copy.</p>
      <p>Browsing the calendar leaves campaign time where it is. Select the dated button in the calendar toolbar to jump back to the campaign date. Open <strong>Campaign clock options</strong> beside it for <strong>Set date</strong> or <strong>Advance one day</strong>.</p>
    </section>
    <section aria-labelledby="calendar-settings" hidden={article !== 'calendar-settings'}>
      <h3 id="calendar-settings" tabIndex={-1}>{topics['calendar-settings']}</h3>
      <ol>
        <li>Open <strong>Campaign → Calendar settings</strong>. Edit the campaign name, weekday names, era labels, periods, or moons. Mark a period as a <strong>Festival</strong> to place it on the calendar without giving it a monthly domain turn.</li>
        <li>Under <strong>Moons</strong>, set each cycle, anchor date, anchor phase, and color. Use <strong>Show moons on the calendar</strong> for inline moon symbols. The selected-day panel identifies the moons and their phases.</li>
        <li>Select <strong>Review calendar</strong>. For edits that keep existing dates in place, review the changes and choose <strong>Save changes</strong>. Use <strong>Back</strong> to edit the draft.</li>
        <li>If changes move calendar dates, use the migration calendar to review the affected dates. Resolve any errors, download a backup if needed, and choose <strong>Apply migration</strong>.</li>
      </ol>
    </section>
    <section aria-labelledby="events" hidden={article !== 'events'}>
      <h3 id="events" tabIndex={-1}>{topics.events}</h3>
      <ol>
        <li>Select a date and choose its <strong>+</strong> or <strong>New event</strong>. Enter a title and date range. Clear <strong>All day</strong> to enter start and end times.</li>
        <li>To repeat an event, choose a frequency under <strong>Repeat</strong>, set the interval and end, and select weekdays for a weekly series. For a monthly or yearly event starting in a festival, review <strong>Festival repeats</strong>.</li>
        <li>Open a recurring occurrence to edit or delete it. Under <strong>Apply changes to</strong>, choose <strong>This occurrence</strong>, <strong>This and following</strong>, or <strong>Entire series</strong> before saving or deleting.</li>
        <li>Use <strong>Search</strong> in the calendar toolbar to find a title, location, or note within a date range.</li>
      </ol>
    </section>
    <section aria-labelledby="print" hidden={article !== 'print'}>
      <h3 id="print" tabIndex={-1}>{topics.print}</h3>
      <ol>
        <li>Open <strong>Campaign → Print</strong>. Choose <strong>Current view</strong> or <strong>Choose months or festivals</strong>.</li>
        <li>For a range, confirm the <strong>First period</strong> and <strong>Last period</strong>. They start at the campaign clock’s current year boundaries. Choose whether each period starts on a new page.</li>
        <li>Select the event types and whether to <strong>Include moons</strong>. Choose <strong>Print</strong> to check the result in the browser preview before printing or saving a PDF.</li>
      </ol>
    </section>
    <section aria-labelledby="backups" hidden={article !== 'backups'}>
      <h3 id="backups" tabIndex={-1}>{topics.backups}</h3>
      <p>Open <strong>Campaign → Backups and data</strong> and choose <strong>Back up</strong> to download the active campaign. The file includes its calendar, events, domain history, and saved drafts.</p>
      <p>To restore, switch to the campaign you want to replace, choose a file under <strong>Restore campaign backup</strong>, and review the two campaign names. Select <strong>Replace active campaign</strong> to confirm. Use a throwaway campaign to inspect a backup without replacing a campaign you still use.</p>
      <p>Save a separate backup before applying a structural calendar migration or reopening turns if you may need the original state.</p>
    </section>
    <section aria-labelledby="manage-holdings" hidden={article !== 'manage-holdings'}>
      <h3 id="manage-holdings" tabIndex={-1}>{topics['manage-holdings']}</h3>
      <ol>
        <li>Open <strong>Domain → Domain Play → Add holding</strong>. Set the ruler, optional liege, opening balances, and <strong>First month to close</strong>.</li>
        <li>Give each territory its population and resources. A holding aggregates those territories in one ledger. Use <strong>Edit holding</strong> to change defaults for future turns.</li>
        <li>At the bottom of <strong>Edit holding</strong>, choose <strong>Archive holding</strong> to pause new turn posting and hide the holding from the default list. Receipts, calendar entries, and pending charges remain available. Use <strong>Show archived holdings</strong>, then <strong>Edit holding → Unarchive holding</strong> to resume from the same unresolved turn.</li>
      </ol>
    </section>
    <section aria-labelledby="close-a-turn" hidden={article !== 'close-a-turn'}>
      <h3 id="close-a-turn" tabIndex={-1}>{topics['close-a-turn']}</h3>
      <p>Close a regular month to record a holding’s approved population changes, income, and expenses.</p>
      <ol>
        <li>Open <strong>Domain → Domain Play → Add holding</strong>. Enter the ruler, territory, families, and resources. Choose the <strong>First month to close</strong> and save the holding.</li>
        <li>Move the campaign clock to the holding’s closing date. Open <strong>Domain Play</strong> and choose <strong>Preview turn</strong>. If several months are due, start with the earliest one. Festivals have no turn of their own.</li>
        <li>Under <strong>Population and income</strong>, review each territory’s population and resources. The first territory turn leaves suggested growth off by default. Enter adjustments or approve growth as needed.</li>
        <li>In <strong>Expenses and obligations</strong>, enter expenses, select applicable event or project costs, and review military expenses, liege payments, tithes, and XP. Review the cash and noncash totals in <strong>Ledger and record turn</strong>.</li>
        <li>Select <strong>Record turn</strong>. Open the receipt from the calendar’s <strong>Domain turn</strong> entry or the holding’s <strong>Turn history</strong>.</li>
      </ol>
    </section>
    <section aria-labelledby="resolve-a-disaster" hidden={article !== 'resolve-a-disaster'}>
      <h3 id="resolve-a-disaster" tabIndex={-1}>{topics['resolve-a-disaster']}</h3>
      <p>Use <strong>Generate annual candidates</strong> to review the saved annual event list. Each enabled event rolls separately against its chance. The d4 sets a target count. Save list changes separately from decisions about what to schedule.</p>
      <p>For example, an earthquake on Growfest 2 in Greyhawk can reduce resource income in Planting, the next regular month.</p>
      <ol>
        <li>Open the holding’s <strong>Confidence and events</strong> panel. Select <strong>Schedule event</strong>, enter the earthquake and its date, check <strong>Natural disaster</strong>, and save.</li>
        <li>When the campaign clock reaches the event date, open the event and select <strong>Resolve event</strong>, then <strong>Review confidence</strong>. A <strong>One-check modifier</strong> applies only to that check. Use <strong>Lasting change</strong> to change the holding’s score. For a standalone monthly adjustment, select <strong>Add confidence check or adjustment</strong> and choose the <strong>Monthly adjustment</strong> trigger.</li>
        <li>Under <strong>Financial effects</strong>, choose the resolved event or its confidence check as the source. For a lost harvest, select <strong>Resource income</strong> and <strong>Noncash</strong>, then enter a negative amount. Choose the target month and select <strong>Approve effect for turn</strong>. If the target month is already closed, you can use the next unresolved turn.</li>
        <li>When the target turn is due, select the effect under <strong>Approved effects and project costs</strong>. Check the updated ledger and record the turn to post it.</li>
      </ol>
    </section>
    <section aria-labelledby="reopen-a-turn" hidden={article !== 'reopen-a-turn'}>
      <h3 id="reopen-a-turn" tabIndex={-1}>{topics['reopen-a-turn']}</h3>
      <p>Rewinding the clock preserves receipts and balances. To correct a recorded month, reopen its turn.</p>
      <ol>
        <li>Open the receipt and choose <strong>Reopen turn</strong>. Review the selected month and any later months that will reopen for the same holding. The confirmation shows the balances that will be restored.</li>
        <li>Use <strong>Download backup</strong> if you want to save the current state. Select <strong>Confirm reopen</strong> to clear the affected receipts and their calendar entries.</li>
        <li>Preview each reopened month in order once it is due. The preview starts with the original inputs and recalculates opening balances from the current ledger. <strong>Reset to current defaults</strong> uses the holding’s current settings.</li>
        <li>Review prior approvals. Payments, XP, and event effects need fresh approval. The event and confidence check remain recorded separately. Check any military charge marked as no longer pending before closing the replay. Record the turn to replace its receipt.</li>
      </ol>
    </section>
    <section aria-labelledby="track-construction" hidden={article !== 'track-construction'}>
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
    <section aria-labelledby="battle-siege-records" hidden={article !== 'battle-siege-records'}>
      <h3 id="battle-siege-records" tabIndex={-1}>{topics['battle-siege-records']}</h3>
      <ol>
        <li>Open <strong>Domain → Battles and sieges</strong>. Enter the dates, participants, and outcome from play at the table. A siege without an end date appears in <strong>Active sieges</strong> while browsing dates on or after its start.</li>
        <li>Save the engagement, then propose consequences individually. Review the dated unit strength before approving a roster change. Link a repair project and any existing cost, or propose a separate one-off expense.</li>
        <li>Approve an expense in its target turn. For confidence, open the proposed review and decide whether to record a check. Use the linked roster, project, or receipt to correct applied consequences.</li>
        <li>Use <strong>Archive engagement</strong> to hide it from the calendar, search, and print while preserving linked history. Find it again with <strong>Show archived engagements</strong>. Delete a mistaken engagement only when it has no approved result or applied consequence.</li>
      </ol>
    </section>
    <section aria-labelledby="military-expenses" hidden={article !== 'military-expenses'}>
      <h3 id="military-expenses" tabIndex={-1}>{topics['military-expenses']}</h3>
      <ol>
        <li>Open <strong>Domain → Domain Play → Garrison roster</strong> for a holding. Muster a unit, choose its effective date and service terms, then save the roster.</li>
        <li>Record dated deployments, arrivals, returns, losses, and releases. Use <strong>Roster date</strong> to review the unit's strength on a past or future date. Use <strong>Edit unit details</strong> to correct the name or type.</li>
        <li>In the monthly turn, review <strong>Military expenses</strong>. Approve, skip, or defer pay and extra supplies. A mid-month change needs a GM-entered amount. A deferred charge keeps its original service dates.</li>
        <li>Edit or withdraw an extra supply proposal in the roster before a turn records a decision. Afterward, open its decision or replay to make a correction. Review any charge that is no longer pending before recording a replay.</li>
      </ol>
    </section>
    <section aria-labelledby="estimate-construction" hidden={article !== 'estimate-construction'}>
      <h3 id="estimate-construction" tabIndex={-1}>{topics['estimate-construction']}</h3>
      <ol>
        <li>Open <strong>Domain → Castle estimates → New estimate</strong>. Choose <strong>Stone wall</strong>, select <strong>Add module line</strong>, and set <strong>Quantity</strong> to 2. The default estimate is 1,100 gp and 66 worker-weeks after standard finish and overhead.</li>
        <li>Choose a <strong>Finish</strong> and review the seven <strong>Site Production Modifier</strong> factors. Changing a factor recalculates cost and labor. If you enter an override, note the reason.</li>
        <li>Under <strong>Staffing and work seasons</strong>, pick a crew preset or enter a custom plan. Special worker equivalents count toward the crew. Enter any agreed compensation separately. The Work Time Modifier is a planning reference. The finish forecast uses the project’s week length, festival pace, and dated closures.</li>
        <li>Select <strong>Save estimate draft</strong> to continue later, or <strong>Review project handoff</strong>. Choose a holding and create a project or revise an existing one. For a staffing revision, resolve pending work before its effective date. The preview shows the new budget, remaining work, and forecast. Confirm any completion change before applying it.</li>
        <li>Use <strong>Manage module catalog</strong> to edit or add campaign modules. Use <strong>Remove line</strong> and add the module again to bring an existing draft line up to date. Delete unused drafts from the estimate list. Approved estimates stay under <strong>Approved estimate history</strong> in the project.</li>
      </ol>
    </section>
    <section aria-labelledby="quick-resolution" hidden={article !== 'quick-resolution'}>
      <h3 id="quick-resolution" tabIndex={-1}>{topics['quick-resolution']}</h3>
      <ol>
        <li>Open <strong>Domain → Battles and sieges → Quick resolution</strong>. Start a draft or open Quick resolution from an existing engagement.</li>
        <li>Enter each side’s BATTLESYSTEM force points, average morale, and conditions. For a siege, choose the date of each phase. The campaign clock stays in place.</li>
        <li>Enter manual rolls or roll in the app and follow the prompts. Each recorded step saves automatically. Resume from the list or use <strong>Undo latest step</strong> to redo a draft step.</li>
        <li>Preview the reported outcome and choose <strong>Approve and save to engagement</strong>. The roll history stays available. Approve any troop, construction, ledger, or confidence consequences separately through the engagement.</li>
      </ol>
    </section>
    </div>
  </Modal>
}
