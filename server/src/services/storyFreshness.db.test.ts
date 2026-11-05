/**
 * The newer-coverage reads against PostgreSQL: which later stories count, by cluster and by feed.
 * The rules themselves (gaps, headline similarity, order) are unit-tested in storyFreshness.test.ts.
 */
import { it, expect } from 'vitest'
import { createCluster, createFeed, createIssue, createStory, describeDb, useTestDatabase } from '../test/db/harness.js'
import { findNewerCoverage } from './storyFreshness.js'

const HOUR = 60 * 60 * 1000
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR)

describeDb('findNewerCoverage', () => {
  useTestDatabase()

  it("flags a chosen story with its cluster's later stories that reached analysis, newest first", async () => {
    const issue = await createIssue()
    const feedA = await createFeed(issue.id)
    const feedB = await createFeed(issue.id)
    const chosen = await createStory({ feedId: feedA.id, status: 'published', dateCrawled: hoursAgo(144) })
    // Dedup files a later report of a published story's event as a duplicate
    const duplicate = await createStory({
      feedId: feedB.id,
      status: 'rejected',
      rejectionReason: 'duplicate',
      dateCrawled: hoursAgo(72),
      title: 'The later report',
    })
    const analyzed = await createStory({ feedId: feedB.id, status: 'analyzed', dateCrawled: hoursAgo(48) })
    const trashed = await createStory({ feedId: feedB.id, status: 'trashed', dateCrawled: hoursAgo(48) })
    const editorRejected = await createStory({ feedId: feedB.id, status: 'rejected', rejectionReason: 'editor', dateCrawled: hoursAgo(48) })
    const fetched = await createStory({ feedId: feedB.id, status: 'fetched', dateCrawled: hoursAgo(24) })
    await createCluster([chosen.id, duplicate.id, analyzed.id, trashed.id, editorRejected.id, fetched.id], chosen.id)

    expect(await findNewerCoverage([chosen.id])).toEqual([
      {
        storyId: chosen.id,
        newer: [
          expect.objectContaining({ id: analyzed.id, reason: 'same_event' }),
          expect.objectContaining({ id: duplicate.id, title: 'The later report', publisher: feedB.title, reason: 'same_event' }),
        ],
      },
    ])
  })

  it('flags a chosen story whose own feed later ran a nearly identical headline, and only that feed', async () => {
    const issue = await createIssue()
    const feedA = await createFeed(issue.id)
    const feedB = await createFeed(issue.id)
    const chosen = await createStory({
      feedId: feedA.id,
      status: 'published',
      dateCrawled: hoursAgo(72),
      sourceTitle: 'Death toll rises to 40 in coastal floods',
    })
    const update = await createStory({
      feedId: feedA.id,
      status: 'analyzed',
      dateCrawled: hoursAgo(66),
      sourceTitle: 'Death toll rises to 75 in coastal floods',
    })
    await createStory({ feedId: feedA.id, status: 'analyzed', dateCrawled: hoursAgo(48), sourceTitle: 'Coastal towns plan new flood walls' })
    await createStory({ feedId: feedB.id, status: 'analyzed', dateCrawled: hoursAgo(48), sourceTitle: 'Death toll rises to 75 in coastal floods' })
    const quiet = await createStory({ feedId: feedB.id, status: 'published', dateCrawled: hoursAgo(96), sourceTitle: 'Wetlands bill passes its first vote' })

    expect(await findNewerCoverage([chosen.id, quiet.id])).toEqual([
      { storyId: chosen.id, newer: [expect.objectContaining({ id: update.id, publisher: feedA.title, reason: 'same_source' })] },
    ])
  })
})
