import { Link } from 'react-router-dom'
import { useOngoingOn } from '../../hooks/usePublicOverviews'
import { TEXT_LINK } from '../../lib/control-classes'
import { ONGOING_METHOD_ID, OVERVIEW_LABEL_TEXT } from './overviewCopy'

/**
 * The methodology page's "Ongoing Stories" section (`.context/overviews.md`, "Switching on"). It
 * describes what the `link_overviews` step does, so it shows only while the step is switched on
 * (`useOngoingOn`, never while prerendering): switching the step on needs no change here. The words
 * are the owner's (approved 2026-11-24), less the summary's: overviews shipped as a timeline on
 * 2026-11-28 without "Where this stands", so the second paragraph's sentences on it went and its first
 * sentence ends at the timeline. The label it quotes is `AI_DISCLOSURE_COPY.overviewLabel`. When the
 * stands switch on, their sentences come back for the owner's approval.
 */
export default function OngoingStoriesMethod() {
  if (!useOngoingOn()) return null
  return (
    <>
      <h2 id={ONGOING_METHOD_ID} className="section-heading mt-10 scroll-mt-20">
        Ongoing Stories
      </h2>
      <p>
        Many stories are part of a development that runs for weeks or months, such as an outbreak, a war or a negotiation. After a story is published, AI checks
        whether it belongs to one we already follow, among those its most similar earlier stories belong to. It adds the story only when it can quote both the
        story and the development for a shared cause and place, and code finds each quote in their text. When two stories each report something that has
        happened in a development we don&apos;t follow yet, not just a warning, forecast or reaction, AI drafts what belongs to it and what stays separate, and
        a second AI check must agree before it starts. A development gets its own page once an AI review keeps at least three stories in it.
      </p>
      <p>
        The page shows a timeline of our stories with the turning points AI marked. As a development grows, AI reviews it again and may take stories out or
        narrow what belongs. When enough new stories show it has grown or shifted, AI may widen it, but only when two AI checks agree and keep the stories it
        started from. This happens at most twice per development, and an editor can undo it. When three weeks pass without a new story, the page shows the date
        of the last one, and a new story that belongs picks the development up again. These pages carry the label &quot;{OVERVIEW_LABEL_TEXT}&quot; and are
        listed under{' '}
        <Link to="/ongoing" className={TEXT_LINK}>
          Ongoing Stories
        </Link>
        .
      </p>
    </>
  )
}
