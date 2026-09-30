import { Logo } from './Logo';

/**
 * The product's face when it speaks or works: the same circle in the interview
 * chat and over the calendar being built, so both read as one assistant.
 */
export function AssistantAvatar() {
  return (
    <div
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-deep text-white shadow-[0_6px_18px_-8px_rgb(68_214_180/0.8)] ring-1 ring-inset ring-white/15"
    >
      <Logo size={15} />
    </div>
  );
}

/** Three dots breathing: something is being thought of. */
export function ThinkingDots({ dotClassName = 'h-2 w-2 bg-gray-400' }: { dotClassName?: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={`chat-dot rounded-full ${dotClassName}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
