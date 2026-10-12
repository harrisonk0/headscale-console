import { flushBrowserIdentity } from "./resume";
let ownsSession = false;
const channel = new BroadcastChannel("hk-remote-session-control");
channel.onmessage = async ({ data }) => {
  if (data?.type === "handoff" && ownsSession) {
    await flushBrowserIdentity();
    location.replace("/session-moved.html");
  }
};
function acquire(ifAvailable: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    navigator.locks
      .request("hk-remote-browser-client", { mode: "exclusive", ifAvailable }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        ownsSession = true;
        resolve(true);
        // The lock lives until this document is closed or navigates away.
        await new Promise<void>(() => {});
      })
      .catch(reject);
  });
}
export async function claimBrowserSession(
  showTakeover: (move: () => Promise<void>) => Promise<void>,
) {
  if (ownsSession) return;
  if (!navigator.locks)
    throw new Error(
      "This browser cannot safely share a client between tabs. Please use a current browser.",
    );
  if (await acquire(true)) return;
  await showTakeover(async () => {
    channel.postMessage({ type: "handoff" });
    if (!(await acquire(false))) throw new Error("Could not move the existing session.");
  });
}
