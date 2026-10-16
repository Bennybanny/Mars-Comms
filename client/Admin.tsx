import { useEffect, useState } from "react";
import { api } from "./api";
import type { User, Group } from "../shared/types";
import { ControlCredentials } from "./ControlCredentials";
export function Admin({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (s: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [groups, setGroups] = useState<Group[]>([]),
    [edit, setEdit] = useState<(Partial<User> & { password?: string }) | null>(
      null,
    ),
    [group, setGroup] = useState<Partial<Group> | null>(null);
  async function load() {
    try {
      const [u, g] = await Promise.all([
        api<User[]>("/admin/users"),
        api<Group[]>("/admin/groups"),
      ]);
      setUsers(u);
      setGroups(g);
    } catch (e) {
      onError(String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(kind: string, value: Partial<User> | Partial<Group>) {
    try {
      await api(
        "/admin/" + kind + (value.id ? "/" + value.id : ""),
        value.id ? "PUT" : "POST",
        value,
      );
      setEdit(null);
      setGroup(null);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function remove(kind: string, id: string) {
    if (!confirm("Delete this " + (kind === "users" ? "user" : "group") + "?"))
      return;
    try {
      await api("/admin/" + kind + "/" + id, "DELETE");
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <section className="admin">
      <div className="section-heading">
        <h2>Administration</h2>
        <button onClick={onClose}>Back to intercom</button>
      </div>
      <div className="section-heading">
        <h3>Crew members</h3>
        <button
          onClick={() =>
            setEdit({
              username: "",
              displayName: "",
              password: "",
              admin: false,
              enabled: true,
              groups: [],
              micGain: 1,
            })
          }
        >
          + Add user
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Name",
                "Username",
                "Groups",
                "Mic level",
                "Enabled",
                "Actions",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.displayName}
                  {u.admin ? " · Admin" : ""}
                </td>
                <td>{u.username}</td>
                <td>
                  {groups
                    .filter((g) => u.groups.includes(g.id))
                    .map((g) => g.name)
                    .join(", ")}
                </td>
                <td>{Math.round(u.micGain * 100)}%</td>
                <td>{u.enabled ? "Yes" : "No"}</td>
                <td>
                  <button onClick={() => setEdit({ ...u })}>Edit</button>{" "}
                  <button
                    className="danger"
                    onClick={() => remove("users", u.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="section-heading">
        <h3>Communication groups</h3>
        <button
          onClick={() =>
            setGroup({ name: "", color: "#8b5cf6", enabled: true })
          }
        >
          + Add group
        </button>
      </div>
      {groups.map((g) => (
        <div className="group-row" key={g.id}>
          <span className="dot" style={{ background: g.color }} />
          <strong>{g.name}</strong>
          <span>{g.enabled ? "Enabled" : "Disabled"}</span>
          <button onClick={() => setGroup({ ...g })}>Edit</button>
          <button className="danger" onClick={() => remove("groups", g.id)}>
            Delete
          </button>
        </div>
      ))}
      {edit && (
        <div className="modal">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("users", {
                ...edit,
                ...(!edit.password ? { password: undefined } : {}),
              });
            }}
          >
            <h2>{edit.id ? "Edit user" : "Add user"}</h2>
            <label>
              Display name
              <input
                required
                value={edit.displayName}
                onChange={(e) =>
                  setEdit({ ...edit, displayName: e.target.value })
                }
              />
            </label>
            <label>
              Username
              <input
                required
                pattern="[A-Za-z0-9_.-]+"
                value={edit.username}
                onChange={(e) => setEdit({ ...edit, username: e.target.value })}
              />
            </label>
            <label>
              {edit.id ? "New password (leave blank to keep)" : "Password"}
              <input
                autoComplete="new-password"
                type="password"
                required={!edit.id}
                value={edit.password ?? ""}
                onChange={(e) => setEdit({ ...edit, password: e.target.value })}
              />
            </label>
            <label>
              Mic level · {Math.round((edit.micGain ?? 1) * 100)}%
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.01"
                value={edit.micGain}
                onChange={(e) =>
                  setEdit({ ...edit, micGain: Number(e.target.value) })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.admin}
                onChange={(e) => setEdit({ ...edit, admin: e.target.checked })}
              />
              Administrator
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.enabled}
                onChange={(e) =>
                  setEdit({ ...edit, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <fieldset>
              <legend>Assigned groups</legend>
              {groups.map((g) => (
                <label className="check" key={g.id}>
                  <input
                    type="checkbox"
                    checked={edit.groups?.includes(g.id)}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        groups: e.target.checked
                          ? [...(edit.groups ?? []), g.id]
                          : edit.groups?.filter((id) => id !== g.id),
                      })
                    }
                  />
                  {g.name}
                </label>
              ))}
            </fieldset>
            {edit.id && (
              <ControlCredentials
                key={edit.id}
                userId={edit.id}
                onError={onError}
              />
            )}
            <div className="actions">
              <button type="button" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="primary">Save user</button>
            </div>
          </form>
        </div>
      )}
      {group && (
        <div className="modal">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save("groups", group);
            }}
          >
            <h2>{group.id ? "Edit group" : "Add group"}</h2>
            <label>
              Group name
              <input
                required
                value={group.name}
                onChange={(e) => setGroup({ ...group, name: e.target.value })}
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={group.color}
                onChange={(e) => setGroup({ ...group, color: e.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={group.enabled}
                onChange={(e) =>
                  setGroup({ ...group, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <div className="actions">
              <button type="button" onClick={() => setGroup(null)}>
                Cancel
              </button>
              <button className="primary">Save group</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
