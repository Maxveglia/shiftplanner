import { accessScope } from '../../lib/access';
import { useT } from '../../lib/i18n';

/**
 * What an account gets into, app by app, as the business has them: said
 * before a login is given (the form) and beside one that exists, so that what
 * the manager is told is what is true for their business -- an employee of a
 * business with the shop can charge at the till, one without cannot.
 */
export function AccessScope({
  role,
  apps,
  className = '',
}: {
  role: 'employee' | 'store';
  apps: readonly string[];
  className?: string;
}) {
  const t = useT();
  const scope = accessScope(role, apps);
  if (scope.length === 0) return null;
  return (
    <div className={['text-xs text-gray-600', className].join(' ')}>
      <p>{t(role === 'store' ? 'people.access.scope.introStore' : 'people.access.scope.intro')}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {scope.map((app) => (
          <li key={app}>{t(`people.access.scope.${app}`)}</li>
        ))}
      </ul>
    </div>
  );
}
