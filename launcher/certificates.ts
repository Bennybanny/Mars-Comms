import { generate } from "selfsigned";
import { X509Certificate, createPublicKey, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isIPv4 } from "node:net";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { CertificateStatus } from "../shared/launcher.js";
import { writeAtomic } from "./files.js";
const DAY = 86400000;
export class CertificateManager {
  readonly directory: string;
  readonly caCertPath: string;
  readonly caKeyPath: string;
  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "certificates");
    this.caCertPath = join(this.directory, "ca", "mars-comms-root-ca.pem");
    this.caKeyPath = join(this.directory, "ca", "mars-comms-root-ca-key.pem");
  }
  private publicKeyMatches(cert: X509Certificate, key: string) {
    return (
      cert.publicKey.export({ type: "spki", format: "pem" }) ===
      createPublicKey(key).export({ type: "spki", format: "pem" })
    );
  }
  private ca() {
    try {
      const cert = new X509Certificate(readFileSync(this.caCertPath));
      const key = readFileSync(this.caKeyPath, "utf8");
      if (
        !cert.ca ||
        !cert.verify(cert.publicKey) ||
        !this.publicKeyMatches(cert, key)
      )
        throw Error(
          "The local CA files do not match. Restore the original CA from a backup; it will not be replaced automatically.",
        );
      return { cert, key };
    } catch {
      throw Error(
        "Mars Comms could not load its local CA. Restore the original CA certificate and private key from a backup. The CA will not be replaced automatically.",
      );
    }
  }
  leafPaths() {
    const active = JSON.parse(
      readFileSync(join(this.directory, "active.json"), "utf8"),
    );
    if (
      typeof active.generation !== "string" ||
      !/^[a-f0-9-]{36}$/.test(active.generation)
    )
      throw Error("Invalid certificate metadata");
    return {
      cert: join(
        this.directory,
        "server",
        active.generation,
        "mars-comms-server.pem",
      ),
      key: join(
        this.directory,
        "server",
        active.generation,
        "mars-comms-server-key.pem",
      ),
    };
  }
  publicCertificate() {
    const cert = new X509Certificate(readFileSync(this.caCertPath));
    if (!cert.ca) throw Error("The public CA certificate is invalid.");
    return cert.toString();
  }
  exportPublicCA(destination: string) {
    const rel = relative(resolve(this.directory), resolve(destination));
    if (!rel || (!rel.startsWith("..") && !isAbsolute(rel)))
      throw Error(
        "Choose an export destination outside the private certificate folder.",
      );
    writeAtomic(destination, this.publicCertificate(), 0o644);
  }
  status(address: string, now = Date.now()): CertificateStatus {
    const base: CertificateStatus = {
      state: "missing",
      message: "Generate a certificate for this network before starting.",
      names: [],
    };
    if (!existsSync(this.caCertPath) && !existsSync(this.caKeyPath))
      return existsSync(join(this.directory, "active.json"))
        ? {
            ...base,
            state: "error",
            message:
              "The local CA is missing from an existing installation. Restore its original certificate and private key from backup; it will not be replaced automatically.",
          }
        : base;
    try {
      if (!existsSync(this.caCertPath) || !existsSync(this.caKeyPath))
        throw Error(
          "The local CA is incomplete. Restore its certificate and private key from backup.",
        );
      const root = this.ca();
      base.fingerprint = root.cert.fingerprint256;
      base.caExpires = root.cert.validTo;
      if (new Date(root.cert.validTo).getTime() <= now)
        return {
          ...base,
          state: "expired",
          message:
            "The local CA has expired. Restore a valid CA backup or arrange a new CA and client trust setup.",
        };
      if (new Date(root.cert.validFrom).getTime() > now)
        throw Error(
          "The local CA is not valid yet. Check the computer date and time.",
        );
      if (!existsSync(join(this.directory, "active.json"))) return base;
      const paths = this.leafPaths(),
        leaf = new X509Certificate(readFileSync(paths.cert));
      if (
        !leaf.checkIssued(root.cert) ||
        !leaf.verify(root.cert.publicKey) ||
        leaf.ca ||
        !this.publicKeyMatches(leaf, readFileSync(paths.key, "utf8"))
      )
        throw Error(
          "Mars Comms could not validate its HTTPS certificate. Update the certificate before starting.",
        );
      base.names = (leaf.subjectAltName ?? "")
        .split(", ")
        .map((n) => n.replace(/^(DNS:|IP Address:)/, ""));
      base.expires = leaf.validTo;
      if (new Date(leaf.validTo).getTime() <= now)
        return {
          ...base,
          state: "expired",
          message:
            "The server certificate has expired. Update it; crew devices keep trusting the same CA.",
        };
      if (new Date(leaf.validFrom).getTime() > now)
        throw Error(
          "The server certificate is not valid yet. Check the computer date and time.",
        );
      if (
        !leaf.checkIP(address) ||
        !leaf.checkIP("127.0.0.1") ||
        !leaf.checkHost("MarsComms.local") ||
        !leaf.checkHost("localhost")
      )
        return {
          ...base,
          state: "needs-update",
          message: `The certificate does not cover ${address}. Update the certificate for the selected network; the local CA will stay the same.`,
        };
      if (new Date(leaf.validTo).getTime() - now < 30 * DAY)
        return {
          ...base,
          state: "needs-update",
          message:
            "The certificate expires within 30 days. Update it before the next production.",
        };
      return { ...base, state: "ready", message: "Certificate ready" };
    } catch (error) {
      const message = (error as Error).message;
      return {
        ...base,
        state: "error",
        message: /^(The local CA|The server certificate|Mars Comms)/.test(
          message,
        )
          ? message
          : "Mars Comms could not load its HTTPS certificate. Click Update Certificate. If this fails, check the data folder permissions and restore the original CA from backup.",
      };
    }
  }
  async generate(address: string) {
    try {
      await this.generateInternal(address);
    } catch (error) {
      const message = (error as Error).message;
      throw Error(
        /^(The local CA|The CA folder|Mars Comms|Select an available)/.test(
          message,
        )
          ? message
          : "Mars Comms could not generate its HTTPS certificate. Check the data folder permissions and available disk space, then retry. Existing CA files will not be replaced automatically.",
      );
    }
  }
  private async generateInternal(address: string) {
    if (!isIPv4(address) || address === "0.0.0.0")
      throw Error("Select an available IPv4 network interface.");
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const now = Date.now(),
      notBeforeDate = new Date(now - 5 * 60000);
    if (!existsSync(this.caCertPath) && !existsSync(this.caKeyPath)) {
      const parent = join(this.directory, "ca");
      if (existsSync(join(this.directory, "active.json")))
        throw Error(
          "The local CA is missing from an existing installation. Restore it from backup; it will not be replaced automatically.",
        );
      if (existsSync(parent))
        throw Error(
          "The CA folder is incomplete. Restore it from backup before continuing.",
        );
      const root = await generate(
        [{ name: "commonName", value: "Mars Comms Local CA" }],
        {
          algorithm: "sha256",
          keySize: 3072,
          notBeforeDate,
          notAfterDate: new Date(now + 3650 * DAY),
          extensions: [
            {
              name: "basicConstraints",
              cA: true,
              pathLenConstraint: 0,
              critical: true,
            },
            {
              name: "keyUsage",
              keyCertSign: true,
              cRLSign: true,
              critical: true,
            },
          ],
        },
      );
      const temporary = join(this.directory, "ca-" + randomUUID());
      mkdirSync(temporary, { mode: 0o700 });
      writeFileSync(
        join(temporary, "mars-comms-root-ca-key.pem"),
        root.private,
        { mode: 0o600 },
      );
      writeFileSync(join(temporary, "mars-comms-root-ca.pem"), root.cert, {
        mode: 0o644,
      });
      renameSync(temporary, parent);
    }
    const root = this.ca();
    if (new Date(root.cert.validTo).getTime() <= now + DAY)
      throw Error(
        "The local CA is expired or about to expire. Restore a valid CA backup; it will not be replaced automatically.",
      );
    const leaf = await generate(
      [{ name: "commonName", value: "MarsComms.local" }],
      {
        algorithm: "sha256",
        keySize: 2048,
        notBeforeDate,
        notAfterDate: new Date(
          Math.min(
            now + 397 * DAY,
            new Date(root.cert.validTo).getTime() - DAY,
          ),
        ),
        ca: { cert: root.cert.toString(), key: root.key },
        extensions: [
          { name: "basicConstraints", cA: false, critical: true },
          {
            name: "keyUsage",
            digitalSignature: true,
            keyEncipherment: true,
            critical: true,
          },
          { name: "extKeyUsage", serverAuth: true },
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "MarsComms.local" },
              { type: 2, value: "localhost" },
              ...[...new Set(["127.0.0.1", address])].map((ip) => ({
                type: 7 as const,
                ip,
              })),
            ],
          },
        ],
      },
    );
    const generation = randomUUID(),
      directory = join(this.directory, "server", generation);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, "mars-comms-server-key.pem"), leaf.private, {
      mode: 0o600,
    });
    writeFileSync(join(directory, "mars-comms-server.pem"), leaf.cert, {
      mode: 0o644,
    });
    writeAtomic(
      join(this.directory, "active.json"),
      JSON.stringify({ generation }),
    );
    const status = this.status(address);
    if (status.state !== "ready") throw Error(status.message);
  }
}
