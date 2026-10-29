import { useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router-dom';
import { Button, Dialog, DialogContent } from '../../components/ui';

/** Stops the user losing unsaved edits: in-app navigation asks first, and closing the tab triggers the browser prompt. */
export function useLeaveGuard(dirty: boolean) {
  const allowLeave = useRef(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Use after a successful save, so leaving is not blocked. */
  const leave = (go: () => void) => {
    allowLeave.current = true;
    go();
  };

  return { blocker, leave };
}

export function DiscardChangesDialog({ blocker }: { blocker: Blocker }) {
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
    >
      <DialogContent
        title="Discard your changes?"
        description="You have unsaved changes to this resume. If you leave now they will be lost."
      >
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => blocker.state === 'blocked' && blocker.reset()}
          >
            Keep editing
          </Button>
          <Button variant="danger" onClick={() => blocker.state === 'blocked' && blocker.proceed()}>
            Discard changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
