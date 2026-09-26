import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { hashOwnerPassword } from "../server/ownerAuth.ts";

const directory = resolve(".allowance");
const password = randomBytes(24).toString("base64url");
const hash = await hashOwnerPassword(password);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(join(directory, "owner-setup.txt"), `Owner password: ${password}\n\nALLOWANCE_PASSWORD_HASH=${hash}\n\nKeep the password in your password manager. Put only the hash in the server environment. This file is private and ignored by Git.\n`, { mode: 0o600, flag: "wx" });
console.log("Owner credentials saved privately in .allowance/owner-setup.txt. Existing credentials are never overwritten.");
