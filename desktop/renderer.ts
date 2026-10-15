import type { LauncherAPI, LauncherSnapshot } from "../shared/launcher";
declare global {
  interface Window {
    marsLauncher: LauncherAPI;
  }
}
const api = window.marsLauncher;
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let state: LauncherSnapshot | undefined;
let busy = false;
let selectionSignature = "";
let feedback = "";
const certificateLabels = {
  missing: "No certificate",
  ready: "Certificate ready",
  "needs-update": "Certificate needs update",
  expired: "Certificate expired",
  error: "Certificate error",
};
function displayError(error: unknown) {
  element("error").textContent = String(
    error instanceof Error ? error.message : error,
  ).replace(/^Error invoking remote method '[^']+': Error: /, "");
  element("error").hidden = false;
}
function render(next: LauncherSnapshot) {
  state = next;
  element("version").textContent = "v" + next.version;
  const locked =
    busy ||
    next.generating ||
    next.state === "Starting" ||
    next.state === "Stopping";
  const running = next.state === "Running";
  const signature = JSON.stringify([next.interfaces, next.config]);
  if (signature !== selectionSignature) {
    selectionSignature = signature;
    const select = element<HTMLSelectElement>("interface");
    select.replaceChildren();
    if (next.selectionMissing) {
      const option = new Option(
        `${next.config.interfaceName} — ${next.config.address} (unavailable)`,
        next.config.address,
      );
      option.disabled = true;
      select.add(option);
    }
    for (const nic of next.interfaces)
      select.add(new Option(`${nic.name} — ${nic.address}`, nic.address));
    select.value = next.config.address;
    for (const name of ["port", "setupPort"] as const) {
      if (document.activeElement !== element(name))
        element<HTMLInputElement>(name).value = String(next.config[name]);
    }
  }
  element("missing").hidden = !next.selectionMissing;
  element("certStatus").textContent = certificateLabels[next.certificate.state];
  element("certStatus").className =
    "badge " +
    (next.certificate.state === "ready"
      ? "green"
      : next.certificate.state === "error" ||
          next.certificate.state === "expired"
        ? "red"
        : "orange");
  element("certMessage").textContent = next.certificate.message;
  element("generate").textContent = next.generating
    ? "Generating…"
    : next.certificate.state === "missing"
      ? "Generate Certificate"
      : "Update Certificate";
  element<HTMLButtonElement>("generate").disabled =
    locked || running || next.selectionMissing;
  element<HTMLButtonElement>("export").disabled =
    locked || !next.certificate.fingerprint;
  element("certDetails").hidden = !next.certificate.expires;
  element("names").textContent = next.certificate.names.join(" · ");
  element("expiry").textContent = next.certificate.expires
    ? new Date(next.certificate.expires).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
  element("serverStatus").textContent = "● " + next.state;
  element("serverStatus").className =
    "badge " +
    (running
      ? "green"
      : next.state === "Error"
        ? "red"
        : next.state === "Stopped"
          ? ""
          : "orange");
  element("mdns").textContent = next.mdns;
  for (const id of ["interface", "port", "setupPort"])
    element<HTMLInputElement>(id).disabled = locked || running;
  element<HTMLButtonElement>("import").disabled = locked || running;
  const button = element<HTMLButtonElement>("lifecycle");
  button.disabled =
    locked ||
    (!running && (next.selectionMissing || next.certificate.state !== "ready"));
  button.textContent =
    next.state === "Starting"
      ? "STARTING…"
      : next.state === "Stopping"
        ? "STOPPING…"
        : running
          ? "STOP SERVER"
          : "START SERVER";
  button.classList.toggle("stop", running);
  element("addresses").hidden = !running;
  element("url").textContent = next.url ?? "";
  element("mdnsUrl").textContent = next.mdnsUrl ?? "";
  element("mdnsUrl").hidden = !next.mdnsUrl;
  element("notice").textContent = next.notice ?? feedback;
  element("notice").hidden = !next.notice && !feedback;
  element("dataDirectory").textContent = next.dataDirectory;
  if (next.error) displayError(next.error);
  if (!running) (element("qrDialog") as HTMLDialogElement).close();
}
async function action(work: () => Promise<unknown>) {
  if (busy) return;
  busy = true;
  element("error").hidden = true;
  if (state) render(state);
  try {
    await work();
  } catch (error) {
    displayError(error);
  } finally {
    busy = false;
    try {
      render(await api.snapshot());
    } catch (error) {
      displayError(error);
    }
  }
}
async function configure() {
  feedback = "";
  if (!state) return;
  const address = element<HTMLSelectElement>("interface").value;
  const nic = state.interfaces.find((entry) => entry.address === address);
  if (!nic) throw Error("Select an available network.");
  await api.configure({
    interfaceName: nic.name,
    address,
    port: Number(element<HTMLInputElement>("port").value),
    setupPort: Number(element<HTMLInputElement>("setupPort").value),
  });
}
for (const id of ["interface", "port", "setupPort"])
  element(id).addEventListener("change", () => void action(configure));
element("generate").onclick = () =>
  void action(async () => {
    await configure();
    await api.generate();
  });
element("export").onclick = () =>
  void action(async () => {
    if (await api.exportCA()) {
      feedback =
        "Public CA exported. Install and trust it on crew devices; private keys remain on this computer.";
    }
  });
element("lifecycle").onclick = () =>
  void action(async () => {
    if (state?.state === "Running") await api.stop();
    else {
      await configure();
      await api.start();
    }
  });
element("open").onclick = () => void action(() => api.openIntercom());
element("import").onclick = () => void action(() => api.importDatabase());
element("showQR").onclick = () =>
  void action(async () => {
    element<HTMLImageElement>("qr").src = await api.setupQR();
    element("setupUrl").textContent = state?.setupUrl ?? "";
    element("fingerprint").textContent = state?.certificate.fingerprint ?? "";
    element<HTMLDialogElement>("qrDialog").showModal();
  });
element("closeQR").onclick = () =>
  element<HTMLDialogElement>("qrDialog").close();
api.onChange(render);
api.snapshot().then(render).catch(displayError);
