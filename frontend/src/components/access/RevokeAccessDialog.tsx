// Taking one person's login away, asked first: it is deleted, not paused, and
// giving it back means a new password to pass on. Asked the way deleting a
// shop account is (AccessPage), from both places a login is taken: the
// person's own page (TeamAccessCard) and the access window (/access).

import { useDeleteEmployeeAccount } from '../../api/accounts';
import { getErrorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { Button } from '../Button';
import { Modal } from '../Modal';

export function RevokeAccessDialog({
  open,
  onClose,
  employeeId,
  name,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  /** Their name as the roster has it. */
  name: string;
}) {
  const t = useT();
  const revoke = useDeleteEmployeeAccount(employeeId);
  const close = () => {
    revoke.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t('people.access.revokeConfirm.title', { name })}
      footer={
        <>
          <Button variant="secondary" className="min-h-11" onClick={close}>
            {t('people.action.cancel')}
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate(undefined, { onSuccess: close })}
          >
            {revoke.isPending ? t('people.access.revoking') : t('people.access.revokeConfirm.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700">{t('people.access.revokeConfirm.body', { name })}</p>
      {revoke.isError && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {getErrorMessage(revoke.error)}
        </p>
      )}
    </Modal>
  );
}
