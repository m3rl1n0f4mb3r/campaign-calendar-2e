# Campaign Calendar 2e

A browser-local calendar and domain management tool for AD&D 2e. Track what happens in your campaign, from recurring festivals and moon phases to a holding’s monthly finances, castle construction, and the aftermath of a siege.

## What you can do

- **Run the campaign calendar.** Start with an editable generic calendar, Greyhawk’s festival calendar, or a pre-Cataclysm Dragonlance example with three moons. Browse by month, week, day, or agenda. Set the campaign clock, schedule and search recurring events, and print a single view or a range of months with the event types and moon phases you choose.
- **Manage holdings and monthly turns.** Track population and resources across territories, review income and expenses, and approve liege payments, tithes, and rulership XP. Record confidence changes and dominion events. Reopen and replay a turn when you need to correct its ledger.
- **Design and build castles.** Estimate modules, staffing, and seasonal work using *The Castle Guide*. Forecast completion, approve progress and setbacks, and bring project costs into the monthly ledger.
- **Track garrisons and engagements.** Record troop strength and deployments, review pay and supplies, and log battles and sieges played at the table. Use the optional *Castle Guide* quick resolution to roll an outcome in the app. Approve troop changes, repairs, and expenses separately.

The Shadowdark edition is a separate project. [Campaign Calendar for Shadowdark](https://github.com/m3rl1n0f4mb3r/campaign-calendar-sd)

## Get started

On a first visit, **Example Campaign** opens on the day Rivergate Bridge reopens. Explore the earlier months to see a fiscal year of events and domain turns for four rulers in the Alder Vale. Returning visits open the last active campaign.

Choose **Campaign → New campaign** to pick a template. Use **Calendar settings** to name the campaign and customize its months, festivals, weekdays, eras, and moons. Use **Domain → Domain Play** to create a holding when the campaign is ready for domain turns. **Help** opens the in-app User Guide, and workflow screens link to the relevant walkthroughs.

The Dragonlance template uses the three moon cycle lengths from *Tales of the Lance*. The starting phases are illustrative. Set a known phase and anchor date for each moon to match your own campaign. [*Tales of the Lance*](https://tuscriaturasarchivos.home.blog/wp-content/uploads/2018/12/Tales-of-the-Lance.pdf)

## Campaign data and backups

Campaign data stays in browser storage. Use **Campaign → Backups and data** to export the active campaign, including its settings, events, and domain history. Keep the JSON file if you want to move a campaign to another browser or recover it after clearing browser storage.

To restore a backup, first switch to the campaign you want to replace. Choose the file and review the campaign names before selecting **Replace active campaign**. For an older backup containing multiple campaigns, restore uses the campaign that was active when the file was exported.

## Run locally

Install dependencies and start the Vite development server.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Deployment

Run `npm run build` and publish `dist/` as a static site over HTTPS. In Vercel, import this repository as a new project and select the Vite framework preset. Domain saves require a secure browser context with support for cross-tab locking.

## License

[MIT License](LICENSE.md)
