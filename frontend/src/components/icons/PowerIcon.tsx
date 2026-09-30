/** The power symbol every "log out" in the app carries: the launcher's corner
 *  button, the sidebar, the employee's header, the back office. Drawn in the
 *  text colour; size and any turn on hover come with `className`. */
export function PowerIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10 3v6.5" />
      <path d="M6.1 5.6a6 6 0 1 0 7.8 0" />
    </svg>
  );
}
