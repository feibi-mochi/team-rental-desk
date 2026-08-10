export function createShutdownLifecycle(
  stopBackgroundWork: () => void,
  closeDatabase: () => void,
): { beforeQuit: () => void; willQuit: () => void } {
  let backgroundStopped = false;
  let databaseClosed = false;
  const beforeQuit = () => {
    if (backgroundStopped) return;
    backgroundStopped = true;
    stopBackgroundWork();
  };
  const willQuit = () => {
    beforeQuit();
    if (databaseClosed) return;
    databaseClosed = true;
    closeDatabase();
  };
  return { beforeQuit, willQuit };
}
