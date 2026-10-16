import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ConnectionQR } from "../shared/connection";

export function ConnectDevice({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<ConnectionQR>();
  const [error, setError] = useState("");
  const [workflow, setWorkflow] = useState<"setup" | "app">("setup");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    let active = true;
    void api<ConnectionQR>("/connection-info")
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
      element.close();
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const setup = workflow === "setup";
  const url = setup ? info?.setupUrl : info?.appUrl;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Copy is unavailable. Select and copy the link above.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="connect-device"
      aria-labelledby="connect-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="connect-heading">
        <h2 id="connect-title">Connect Device</h2>
        <button onClick={onClose} aria-label="Close Connect Device">
          ✕
        </button>
      </div>
      <div
        className="connect-workflows"
        role="group"
        aria-label="Connection workflow"
      >
        <button
          aria-pressed={setup}
          className={setup ? "selected" : ""}
          onClick={() => {
            setWorkflow("setup");
            setCopied(false);
            setCopyError("");
          }}
        >
          New Device Setup
        </button>
        <button
          aria-pressed={!setup}
          className={!setup ? "selected" : ""}
          onClick={() => {
            setWorkflow("app");
            setCopied(false);
            setCopyError("");
          }}
        >
          Open Mars Comms
        </button>
      </div>
      <p className="connect-description">
        {setup
          ? "For devices using Mars Comms for the first time."
          : "For devices that are already set up."}
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !info ? (
        <p role="status">Preparing QR codes…</p>
      ) : (
        <>
          <img
            className="connect-qr"
            width="256"
            height="256"
            src={setup ? info.setupQR : info.appQR}
            alt={setup ? "New Device Setup QR code" : "Open Mars Comms QR code"}
          />
          <a
            className="connect-link"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {url}
          </a>
          <button className="primary copy-link" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy Link"}
          </button>
          <p className="copy-feedback" role="status">
            {copyError || (copied ? "Link copied" : "")}
          </p>
        </>
      )}
    </dialog>
  );
}
