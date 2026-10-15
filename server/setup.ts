import express from "express";
export type SetupOptions = {
  address: string;
  httpsPort: number;
  fingerprint: string;
  publicCertificate: () => string;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function setupRoutes(options: SetupOptions) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    next();
  });
  router.get("/certificate", (_req, res) => {
    try {
      const certificate = options.publicCertificate();
      if (
        !certificate.startsWith("-----BEGIN CERTIFICATE-----") ||
        certificate.includes("PRIVATE KEY")
      )
        throw Error("Invalid public certificate");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="Mars-Comms-CA.crt"',
      );
      res.type("application/x-x509-ca-cert").send(certificate);
    } catch {
      res
        .status(503)
        .type("text")
        .send(
          "The public CA is unavailable. Ask the operator to check the certificate in Mars Comms.",
        );
    }
  });
  router.get("/setup", (req, res) => {
    const url = `https://${options.address}:${options.httpsPort}`;
    const secure = "encrypted" in req.socket;
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mars Comms Client Setup</title><style>body{background:#111116;color:#ece8f2;font:16px system-ui;line-height:1.6;max-width:760px;margin:40px auto;padding:24px}h1{letter-spacing:-1px}h2{font-size:19px;margin-top:30px}a{color:#bda0ff}code{overflow-wrap:anywhere}.button{display:inline-block;background:#7851cf;color:white;padding:13px 20px;border-radius:9px;text-decoration:none;margin:10px 0}small{color:#aaa0b9}.notice{padding:15px;background:#2a2437;border-radius:8px}.fingerprint{font-size:12px;word-break:break-all}</style><h1>Mars Comms Client Setup</h1><p>Production intercom: <a href="${url}">${url}</a></p><p>HTTPS intercom: enabled. This setup connection: ${secure ? "HTTPS" : "HTTP (public certificate setup only)"}.</p><div class="notice">Install only the <strong>Mars Comms Local CA public certificate</strong>. This lets this device trust certificates signed by the production computer. Never install a CA from an unknown operator. Compare the actual downloaded certificate's SHA-256 fingerprint in a certificate viewer with the native launcher. The text displayed on this HTTP page alone is not proof. If your device cannot verify the certificate fingerprint, use the CA exported directly by your operator over a trusted transfer instead.</div><p><a class="button" href="/certificate">Download Mars Comms CA Certificate</a></p><p class="fingerprint">CA SHA-256 fingerprint:<br><code>${escape(options.fingerprint)}</code></p><h2>Windows</h2><p>Open the downloaded .crt file → Install Certificate → Current User → Place all certificates in the following store → Trusted Root Certification Authorities. Confirm only if the fingerprint matches your operator's launcher.</p><h2>macOS</h2><p>Open the .crt file in Keychain Access, import into the login keychain, open Mars Comms Local CA, and under Trust set SSL / Always Trust. Confirm the OS prompt.</p><h2>iPhone / iPad</h2><p>Download the certificate in Safari. Open Settings → General → VPN &amp; Device Management and install the downloaded profile. Then Settings → General → About → Certificate Trust Settings → enable full trust for Mars Comms Local CA. Return to Safari.</p><h2>Android</h2><p>Download the .crt file. In Settings → Security / Privacy → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate, select the file. Exact names vary by device. Managed devices may require administrator assistance.</p><h2>Linux</h2><p>Import the CA into your distribution/browser's trusted authorities. Firefox may use its own certificate store.</p><h2>Ready to talk</h2><p><a class="button" href="${url}">Open Mars Comms HTTPS</a></p><p>Open the HTTPS address without a certificate warning, log in, press Enable Microphone and allow permission. Use a headset. Keep the page visible on phones.</p><small>The CA only needs installing once while your production computer keeps the same CA. Changing IP or renewing the server certificate does not require reinstalling it. HTTP bootstrap traffic is unencrypted and may be replaced by a network attacker; verify the actual certificate fingerprint in person or use a certificate exported directly by your trusted operator.</small></html>`,
      );
  });
  return router;
}
export function createBootstrapApp(options: SetupOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.sendStatus(405);
      return;
    }
    next();
  });
  app.get("/", (_req, res) => res.redirect("/setup"));
  app.use(setupRoutes(options));
  app.use((_req, res) => res.sendStatus(404));
  return app;
}
