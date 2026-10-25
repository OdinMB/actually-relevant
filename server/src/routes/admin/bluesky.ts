import * as blueskyService from '../../services/bluesky.js'
import { generateDraftBodySchema, pickAndDraftBodySchema, updateDraftBodySchema, listPostsQuerySchema, feedQuerySchema } from '../../schemas/bluesky.js'
import { socialChannelRouter } from './socialChannel.js'

export default socialChannelRouter(blueskyService, {
  feedQuery: feedQuerySchema,
  listPostsQuery: listPostsQuerySchema,
  generateDraftBody: generateDraftBodySchema,
  pickAndDraftBody: pickAndDraftBodySchema,
  updateDraftBody: updateDraftBodySchema,
})
