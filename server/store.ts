import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { User, Group } from "../shared/types.js";
import { GROUP_COLOR_PATTERN, DEFAULT_GROUP_COLOR } from "../shared/types.js";
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const actual = scryptSync(password, salt, 64);
  return (
    key?.length === 128 && timingSafeEqual(actual, Buffer.from(key, "hex"))
  );
}
export const userInput = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w.-]+$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256).optional(),
  admin: z.boolean(),
  enabled: z.boolean(),
  groups: z.array(z.string()).max(100),
  micGain: z.number().min(0).max(1.5),
});
export const groupInput = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().regex(GROUP_COLOR_PATTERN),
  enabled: z.boolean(),
});
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,hash TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL,expires INTEGER NOT NULL);",
    );
    if (!this.users().length) {
      for (const name of ["Camera", "Tech", "Show", "Audio"])
        this.saveGroup(undefined, {
          name,
          color: DEFAULT_GROUP_COLOR,
          enabled: true,
        });
      this.saveUser(undefined, {
        username: "admin",
        displayName: "Administrator",
        password: "admin",
        admin: true,
        enabled: true,
        groups: this.groups().map((g) => g.id),
        micGain: 1,
      });
    }
  }
  users(): User[] {
    return (
      this.db.prepare("SELECT json FROM users").all() as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  user(id: string) {
    return this.users().find((u) => u.id === id);
  }
  groups(): Group[] {
    return (
      this.db.prepare("SELECT json FROM groups").all() as { json: string }[]
    ).map((r) => JSON.parse(r.json));
  }
  saveUser(id: string | undefined, input: unknown) {
    const d = userInput.parse(input);
    const old = id ? this.user(id) : undefined;
    if (id && !old) throw Error("User not found");
    if (!old && !d.password) throw Error("Password required");
    if (d.groups.some((g) => !this.groups().some((x) => x.id === g)))
      throw Error("Unknown group");
    if (
      old?.admin &&
      (!d.admin || !d.enabled) &&
      !this.users().some((u) => u.id !== id && u.admin && u.enabled)
    )
      throw Error("Keep at least one enabled administrator");
    const previous = id
      ? (this.db.prepare("SELECT hash FROM users WHERE id=?").get(id) as
          { hash: string } | undefined)
      : undefined;
    const user: User = {
      id: id ?? randomUUID(),
      username: d.username,
      displayName: d.displayName,
      admin: d.admin,
      enabled: d.enabled,
      groups: [...new Set(d.groups)],
      micGain: d.micGain,
      defaultPassword: d.password
        ? d.username === "admin" && d.password === "admin"
        : (old?.defaultPassword ?? false),
    };
    this.db
      .prepare(
        "INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,hash=excluded.hash,json=excluded.json",
      )
      .run(
        user.id,
        user.username,
        d.password ? hashPassword(d.password) : previous!.hash,
        JSON.stringify(user),
      );
    return user;
  }
  deleteUser(id: string) {
    const u = this.user(id);
    if (
      u?.admin &&
      !this.users().some((x) => x.id !== id && x.admin && x.enabled)
    )
      throw Error("Keep at least one enabled administrator");
    this.db.prepare("DELETE FROM users WHERE id=?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE userId=?").run(id);
  }
  saveGroup(id: string | undefined, input: unknown) {
    const d = groupInput.parse(input);
    if (id && !this.groups().some((g) => g.id === id))
      throw Error("Group not found");
    const group = { ...d, id: id ?? randomUUID() };
    this.db
      .prepare("INSERT OR REPLACE INTO groups VALUES(?,?)")
      .run(group.id, JSON.stringify(group));
    return group;
  }
  deleteGroup(id: string) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM groups WHERE id=?").run(id);
      for (const u of this.users())
        if (u.groups.includes(id))
          this.saveUser(u.id, {
            ...u,
            groups: u.groups.filter((g) => g !== id),
          });
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  login(username: string, password: string) {
    const row = this.db
      .prepare("SELECT id,hash FROM users WHERE username=?")
      .get(username) as { id: string; hash: string } | undefined;
    const fallback = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = verifyPassword(password, row?.hash ?? fallback);
    if (!row || !valid || !this.user(row.id)?.enabled) return undefined;
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(token, row.id, Date.now() + 12 * 3600000);
    return token;
  }
  session(token: string) {
    const row = this.db
      .prepare("SELECT userId FROM sessions WHERE token=? AND expires>?")
      .get(token, Date.now()) as { userId: string } | undefined;
    const u = row ? this.user(row.userId) : undefined;
    return u?.enabled ? u : undefined;
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  }
}
