// Makes the key pair the Worker signs push notifications with. Run once:
//   node make-vapid-keys.mjs
// then follow the two commands it prints. Keep the private key secret; the
// public key is safe to share (phones need it to subscribe).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);

console.log(`
Public key  (VAPID_PUBLIC_KEY):  ${raw.toString("base64url")}
Private key (VAPID_PRIVATE_KEY): ${priv.d}

1. Put the public key in wrangler.toml under [vars]:
     VAPID_PUBLIC_KEY = "${raw.toString("base64url")}"
2. Store the private key as a Worker secret (paste it when asked):
     npx wrangler secret put VAPID_PRIVATE_KEY
`);
