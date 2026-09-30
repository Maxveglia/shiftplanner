import { useId } from 'react';
import { Button } from '../Button';
import { Input } from '../Input';
import { suggestPassword } from '../../lib/password';
import { useT } from '../../lib/i18n';

/**
 * A password the manager sets for somebody else and passes on: shown in the
 * clear (it is about to be read out or written down), in a typewriter face so
 * an l is not a 1, with a button that suggests one. Its own id, so its label
 * is its label (Input ties them by id).
 */
export function PasswordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (password: string) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input
          id={id}
          label={label}
          className="w-full font-mono"
          required
          minLength={8}
          maxLength={128}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <Button type="button" variant="secondary" className="min-h-11" onClick={() => onChange(suggestPassword())}>
        {t('people.access.form.suggest')}
      </Button>
    </div>
  );
}
