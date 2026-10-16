import { useEffect, useState } from "react";
import { api } from "./api";
import type { ControlCredential } from "../shared/control";
export function ControlCredentials({
  userId,
  onError,
}: {
  userId: string;
  onError: (message: string) => void;
}) {
  const [credentials, setCredentials] = useState<ControlCredential[]>([]);
  const [name, setName] = useState("Companion");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const path = `/admin/users/${userId}/control-credentials`;
  async function load() {
    setCredentials(await api<ControlCredential[]>(path));
  }
  useEffect(() => {
    void load().catch((error: Error) => onError(error.message));
  }, [userId]);
  async function create() {
    setBusy(true);
    setToken("");
    setCopied(false);
    try {
      const result = await api<{ token: string }>(path, "POST", { name });
      setToken(result.token);
      await load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    try {
      await api(path + "/" + id, "DELETE");
      setToken("");
      await load();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>External Control</legend>
      {credentials
        .filter((key) => !key.revokedAt)
        .map((key) => (
          <p key={key.id}>
            {key.name} · Active{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke(key.id)}
            >
              Revoke
            </button>
          </p>
        ))}
      <label>
        Control credential name
        <input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="muted">
        One active key per user. Generating a new key revokes the previous one.
      </p>
      <button
        type="button"
        disabled={busy || !name.trim()}
        onClick={() => void create()}
      >
        Generate New Key
      </button>
      {token && (
        <div>
          <p>Copy this key now. It will not be shown again.</p>
          <input
            aria-label="New control API key"
            readOnly
            value={token}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(token)
                .then(() => setCopied(true))
                .catch(() => onError("Select and copy the key manually."))
            }
          >
            {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
