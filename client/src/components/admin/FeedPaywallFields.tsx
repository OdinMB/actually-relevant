import { Input } from '../ui/Input'

interface FeedPaywallFieldsProps {
  detection: boolean
  titleMarker: string
  onDetectionChange: (value: boolean) => void
  onTitleMarkerChange: (value: string) => void
}

/** A feed's paywall setting (ADR-0032), shared by the create dialog and the edit panel. */
export function FeedPaywallFields({ detection, titleMarker, onDetectionChange, onTitleMarkerChange }: FeedPaywallFieldsProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium text-neutral-700 mb-1">Paywall</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={detection}
          onChange={e => onDetectionChange(e.target.checked)}
          className="rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
        />
        Detect paywalled articles automatically
      </label>
      <Input
        id="feed-paywall-marker"
        label="Subscriber-article title marker (regex, optional)"
        value={titleMarker}
        onChange={e => onTitleMarkerChange(e.target.value)}
        placeholder="e.g. ^\(S\+\)"
        aria-describedby="feed-paywall-hint"
      />
      <p id="feed-paywall-hint" className="text-xs text-neutral-500">
        Locked articles are rejected at crawl and never analyzed. Turn detection off for a feed that serves full text although its pages are marked paid; a title matching the marker is always treated as locked. Changes apply to future crawls only.
      </p>
    </fieldset>
  )
}
