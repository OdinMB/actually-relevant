import { useSubscribe } from "./SubscribeProvider";

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export default function NewsletterBanner() {
  const { openSubscribe } = useSubscribe();

  return (
    <div className="py-8 md:py-10 text-center max-w-2xl mx-auto">
      <div className="flex items-center justify-center gap-4 mb-5">
        <span
          className="flex-1 border-t border-neutral-200"
          aria-hidden="true"
        />
        <MailIcon className="w-5 h-5 text-brand-300" />
        <span
          className="flex-1 border-t border-neutral-200"
          aria-hidden="true"
        />
      </div>
      <p className="text-lg text-neutral-600 leading-relaxed mb-4">
        Don&rsquo;t miss what&rsquo;s actually relevant.
      </p>
      <button
        type="button"
        onClick={() => openSubscribe()}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-neutral-800 rounded-lg hover:bg-neutral-700 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <MailIcon className="w-4 h-4" />
        Get the Newsletter
      </button>
    </div>
  );
}
