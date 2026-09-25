import AiBadge from './AiBadge'

/**
 * "AI" badge plus visible label text (story page metadata row, embed header). The badge is
 * decorative here, so screen readers announce the text once. Color and size come from the parent.
 */
export default function AiLabel({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`.trim()}>
      <AiBadge decorative />
      <span>{text}</span>
    </span>
  )
}
