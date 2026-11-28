import { key, newCampaign, parseStore, type Campaign, type Store } from './storage'

export async function initializeCampaigns(storage: Pick<Storage, 'getItem'>, loadExample: () => Promise<Campaign>) {
  const only = (campaign: Campaign): Store => ({ version: 1, active: campaign.id, campaigns: [campaign] })
  let raw: string | null = null
  try {
    raw = storage.getItem(key)
    if (raw !== null) return { store: parseStore(raw), error: '', locked: false, raw }
  } catch {
    return { store: only(newCampaign('Example Campaign')), locked: true, raw,
      error: 'Saved data could not be read. Restore a backup, or use Campaign → Backups and data to start fresh.' }
  }
  let sample: Campaign
  let error = ''
  try { sample = await loadExample() }
  catch {
    sample = newCampaign('Example Campaign')
    error = 'The populated example could not be loaded. You can start a campaign from this calendar.'
  }
  // Another tab may have saved while the example was loading.
  try {
    raw = storage.getItem(key)
    if (raw !== null) return { store: parseStore(raw), error: '', locked: false, raw }
  } catch {
    return { store: only(newCampaign('Example Campaign')), locked: true, raw,
      error: 'Saved data could not be read. Restore a backup, or use Campaign → Backups and data to start fresh.' }
  }
  return { store: only(sample), error, locked: false, raw }
}
