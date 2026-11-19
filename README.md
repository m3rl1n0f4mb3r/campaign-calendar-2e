# Campaign Calendar 2e

A browser-local campaign calendar for AD&D 2e. Create a campaign from an editable generic calendar, a Greyhawk festival calendar, or a pre-Cataclysm Dragonlance example.

The [Shadowdark edition](https://github.com/m3rl1n0f4mb3r/campaign-calendar-sd) is a separate project.

## Run locally

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Use **Calendar settings** to configure months, festivals, weekdays, eras, and moon cycles. Use **Data** to download a backup of the active campaign. To restore a backup, select the campaign you want to replace. For an older backup containing multiple campaigns, restore uses the campaign that was active when the file was exported.

The Dragonlance example uses the three cycle lengths in [*Tales of the Lance*](https://tuscriaturasarchivos.home.blog/wp-content/uploads/2018/12/Tales-of-the-Lance.pdf). Its starting phases are illustrative. Set a known phase and date for each moon in your own campaign before relying on the forecast.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

## Deployment

Run `npm run build` and publish `dist/` as a static site. In Vercel, import this repository as a new project and select the Vite framework preset.

## License

Source code is available under the [MIT License](LICENSE.md).
