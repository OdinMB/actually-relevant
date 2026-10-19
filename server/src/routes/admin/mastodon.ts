import * as mastodonService from '../../services/mastodon.js'
import {
  generateMastodonDraftBodySchema,
  pickAndDraftMastodonBodySchema,
  updateMastodonDraftBodySchema,
  listMastodonPostsQuerySchema,
  mastodonFeedQuerySchema,
} from '../../schemas/mastodon.js'
import { socialChannelRouter } from './socialChannel.js'

export default socialChannelRouter(mastodonService, {
  feedQuery: mastodonFeedQuerySchema,
  listPostsQuery: listMastodonPostsQuerySchema,
  generateDraftBody: generateMastodonDraftBodySchema,
  pickAndDraftBody: pickAndDraftMastodonBodySchema,
  updateDraftBody: updateMastodonDraftBodySchema,
})
