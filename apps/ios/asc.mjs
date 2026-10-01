#!/usr/bin/env node
// App Store Connect from the command line, for the TestFlight pipeline. Delta's
// apps/ios/asc.mjs, adapted.
//
//   node apps/ios/asc.mjs setup          register the bundle ids and their capabilities,
//                                        and make sure the app's internal TestFlight group
//                                        exists with the account holder in it. Idempotent.
//   node apps/ios/asc.mjs wait <build>   wait until build <build> is processed (VALID).
//
// Auth: PULSO_ASC_KEY_ID, PULSO_ASC_ISSUER_ID, PULSO_ASC_KEY_PATH (the .p8), read
// from the environment or apps/ios/.asc.env (gitignored).
//
// The app RECORD ("Pulso by BiXKu") is not created here: the API cannot create apps.
// It was made once on appstoreconnect.apple.com and is found by bundle id.
import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, createSign } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const local = join(dirname(fileURLToPath(import.meta.url)), ".asc.env");
if (existsSync(local)) {
  for (const line of readFileSync(local, "utf8").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace("$HOME", homedir());
  }
}

const APP_BUNDLE_ID = process.env.PULSO_APP_BUNDLE_ID || "com.facundo.pulso";
const DEV_BUNDLE_ID = "com.facundo.pulso.dev";
const INTERNAL_GROUP = "Facundo";

// Every id the app embeds, for both flavours: Release goes to TestFlight, Debug is
// what phone.sh installs by hand. App groups and keychain sharing are set up by
// Xcode's automatic signing from the entitlements; HealthKit and App Groups must be
// enabled on the id.
const BUNDLES = [APP_BUNDLE_ID, DEV_BUNDLE_ID].flatMap((base) => [
  { identifier: base, name: base === DEV_BUNDLE_ID ? "Pulso Dev" : "Pulso", capabilities: ["HEALTHKIT", "APP_GROUPS"] },
  { identifier: `${base}.activity`, name: "Pulso activity", capabilities: [] },
  { identifier: `${base}.widgets`, name: "Pulso widgets", capabilities: ["APP_GROUPS"] },
]);

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} (or apps/ios/.asc.env)`);
  return value;
}

function token() {
  const b64u = (input) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: env("PULSO_ASC_KEY_ID"), typ: "JWT" };
  // Apple caps a token at 20 minutes; each request mints its own.
  const payload = { iss: env("PULSO_ASC_ISSUER_ID"), iat: now, exp: now + 1200, aud: "appstoreconnect-v1" };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(input);
  signer.end();
  // JWS ES256 is raw R||S, not Node's default DER.
  const key = createPrivateKey(readFileSync(env("PULSO_ASC_KEY_PATH"), "utf8"));
  return `${input}.${b64u(signer.sign({ key, dsaEncoding: "ieee-p1363" }))}`;
}

async function api(method, path, body) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = (json.errors || []).map((error) => `${error.code}: ${error.detail || error.title}`).join("; ");
    throw new Error(`${method} ${path} → ${response.status} ${detail}`);
  }
  return json;
}

const log = (line) => console.log(`[asc] ${line}`);

async function findApp() {
  const found = await api("GET", `/v1/apps?filter[bundleId]=${APP_BUNDLE_ID}&fields[apps]=name,bundleId`);
  const app = found.data.find((entry) => entry.attributes.bundleId === APP_BUNDLE_ID);
  if (!app) throw new Error(`no App Store Connect app has bundle id ${APP_BUNDLE_ID} — create the record first`);
  return app;
}

async function ensureBundle({ identifier, name, capabilities }) {
  const found = await api("GET", `/v1/bundleIds?filter[identifier]=${identifier}&include=bundleIdCapabilities&limit=10`);
  // The filter is a prefix match; take the exact one.
  let bundle = found.data.find((entry) => entry.attributes.identifier === identifier);
  let have = new Set();
  if (bundle) {
    const ids = new Set((bundle.relationships?.bundleIdCapabilities?.data || []).map((entry) => entry.id));
    have = new Set((found.included || []).filter((entry) => ids.has(entry.id)).map((entry) => entry.attributes.capabilityType));
  } else {
    bundle = (await api("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS" } } })).data;
    log(`registered ${identifier}`);
  }
  for (const capabilityType of capabilities) {
    if (have.has(capabilityType)) continue;
    await api("POST", "/v1/bundleIdCapabilities", {
      data: { type: "bundleIdCapabilities", attributes: { capabilityType }, relationships: { bundleId: { data: { type: "bundleIds", id: bundle.id } } } },
    });
    log(`${identifier}: enabled ${capabilityType}`);
  }
}

/** The internal group gets every build, and only the account holder — the person asked for themselves alone. */
async function ensureInternalGroup(app) {
  const groups = await api("GET", `/v1/apps/${app.id}/betaGroups?fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds`);
  let group = groups.data.find((entry) => entry.attributes.isInternalGroup && entry.attributes.name === INTERNAL_GROUP);
  if (!group) {
    group = (
      await api("POST", "/v1/betaGroups", {
        data: { type: "betaGroups", attributes: { name: INTERNAL_GROUP, isInternalGroup: true, hasAccessToAllBuilds: true }, relationships: { app: { data: { type: "apps", id: app.id } } } },
      })
    ).data;
    log(`created internal TestFlight group "${INTERNAL_GROUP}"`);
  }
  const users = await api("GET", "/v1/users?fields[users]=username,firstName,lastName,roles&limit=50");
  const holder = users.data.find((user) => (user.attributes.roles || []).includes("ACCOUNT_HOLDER")) || users.data[0];
  if (!holder) throw new Error("no App Store Connect user to add as tester");
  const email = String(holder.attributes.username).toLowerCase();
  const testers = await api("GET", `/v1/betaGroups/${group.id}/betaTesters?fields[betaTesters]=email&limit=200`);
  if (!testers.data.some((entry) => String(entry.attributes.email).toLowerCase() === email)) {
    await api("POST", "/v1/betaTesters", {
      data: {
        type: "betaTesters",
        attributes: { email, firstName: holder.attributes.firstName, lastName: holder.attributes.lastName },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } },
      },
    });
    log(`added ${email} to "${INTERNAL_GROUP}"`);
  }
  log(`internal group "${INTERNAL_GROUP}": ${email}, every build`);
}

async function setup() {
  for (const bundle of BUNDLES) await ensureBundle(bundle);
  log(`bundle ids ready (${BUNDLES.length})`);
  const app = await findApp();
  log(`app record: ${app.attributes.name} (${app.id})`);
  await ensureInternalGroup(app);
}

/** Poll until App Store Connect has processed the upload: PROCESSING → VALID. */
async function wait(buildNumber, { timeoutMinutes = 40 } = {}) {
  const app = await findApp();
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const builds = await api("GET", `/v1/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&fields[builds]=version,processingState`);
    const state = builds.data[0]?.attributes.processingState || "NOT_YET_VISIBLE";
    if (state !== last) log(`build ${buildNumber}: ${state}`);
    last = state;
    if (state === "VALID") return;
    if (state === "FAILED" || state === "INVALID") throw new Error(`App Store Connect refused build ${buildNumber} (${state}) — Apple's email says why`);
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
  throw new Error(`build ${buildNumber} was not processed within ${timeoutMinutes} minutes (last state ${last})`);
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "setup") await setup();
  else if (command === "bundles") for (const bundle of BUNDLES) await ensureBundle(bundle);
  else if (command === "wait" && argument) await wait(argument);
  else {
    console.error("usage: node apps/ios/asc.mjs setup | bundles | wait <build-number>");
    process.exit(2);
  }
} catch (error) {
  console.error(`[asc] ${error.message}`);
  process.exit(1);
}
