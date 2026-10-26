/**
 * An in-memory Plunk for PostgreSQL tests of the newsletter sends: a test file mocks the real
 * client with it, `vi.mock('../services/plunk.js', () => import('../test/fakePlunk.js'))`, and reads
 * `fakePlunk` for what was created and sent. It records campaigns and the sends it accepted, and
 * fails on script the way the real API can: refused before connecting, a 4xx answer, or an
 * ambiguous failure after Plunk already accepted the send (a lost response).
 */
import type { CampaignStats, CreateCampaignOpts } from '../services/plunk.js'

export type SendFailure = 'not_connected' | 'client_error' | 'ambiguous'

interface FakeCampaign extends CreateCampaignOpts {
  id: string
}

class FakePlunk {
  campaigns: FakeCampaign[] = []
  /** Sends Plunk accepted, in order (an ambiguous failure is accepted too). */
  accepted: { campaignId: string; audienceType: CreateCampaignOpts['audienceType']; scheduledFor?: string }[] = []
  private createFailures: Error[] = []
  private sendFailures: SendFailure[] = []

  reset(): void {
    this.campaigns = []
    this.accepted = []
    this.createFailures = []
    this.sendFailures = []
  }

  /** The next createCampaign call fails (after any already scripted). */
  failNextCreate(): void {
    this.createFailures.push(Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } }))
  }

  /** The next sendCampaign call fails this way (after any already scripted). */
  failNextSend(kind: SendFailure): void {
    this.sendFailures.push(kind)
  }

  /** Accepted sends to all subscribers. */
  liveSends() {
    return this.accepted.filter(send => send.audienceType === 'ALL')
  }

  async createCampaign(opts: CreateCampaignOpts): Promise<{ id: string }> {
    const failure = this.createFailures.shift()
    if (failure) throw failure
    const campaign = { ...opts, id: `campaign-${this.campaigns.length + 1}` }
    this.campaigns.push(campaign)
    return { id: campaign.id }
  }

  async sendCampaign(id: string, scheduledFor?: string): Promise<void> {
    const campaign = this.campaigns.find(c => c.id === id)
    if (!campaign) throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })
    const failure = this.sendFailures.shift()
    if (failure === 'not_connected') throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })
    if (failure === 'client_error') throw Object.assign(new Error('Request failed with status code 422'), { response: { status: 422 } })
    this.accepted.push({ campaignId: id, audienceType: campaign.audienceType, scheduledFor })
    if (failure === 'ambiguous') throw Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
  }
}

export const fakePlunk = new FakePlunk()

// The plunk.js functions the newsletter code calls
export const createCampaign = (opts: CreateCampaignOpts) => fakePlunk.createCampaign(opts)
export const sendCampaign = (id: string, scheduledFor?: string) => fakePlunk.sendCampaign(id, scheduledFor)
export const getCampaignStats = async (): Promise<CampaignStats> => ({ delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 })
