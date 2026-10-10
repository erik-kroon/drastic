import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

// A WebAuthn authenticator in software. It produces the exact registration and
// assertion bytes a platform authenticator would (packed "none" attestation, ES256),
// so the server's real verifier runs unchanged. Flags and counters can be set to
// produce the refusals the presence contract requires.

type CborValue = number | string | Uint8Array | ReadonlyArray<readonly [CborValue, CborValue]>;

function head(major: number, length: number) {
  if (length < 24) return [(major << 5) | length];

  if (length < 0x100) return [(major << 5) | 24, length];

  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];

  return [
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
}

// Integers, byte strings, text strings and maps given as ordered entries.
function cbor(value: CborValue): Uint8Array {
  if (typeof value === "number") {
    return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  }

  if (typeof value === "string") {
    const text = new TextEncoder().encode(value);

    return Buffer.concat([Uint8Array.from(head(3, text.length)), text]);
  }

  if (value instanceof Uint8Array) {
    return Buffer.concat([Uint8Array.from(head(2, value.length)), value]);
  }

  return Buffer.concat([
    Uint8Array.from(head(5, value.length)),
    ...value.flatMap(([key, entry]) => [cbor(key), cbor(entry)]),
  ]);
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();

function counterBytes(counter: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);

  return bytes;
}

type Flags = { readonly userPresent?: boolean; readonly userVerified?: boolean };

function flagByte(flags: Flags, attested: boolean) {
  return (
    (flags.userPresent === false ? 0 : 0x01) |
    (flags.userVerified === false ? 0 : 0x04) |
    (attested ? 0x40 : 0)
  );
}

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(32);

  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });

    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id() {
    return base64url(this.credentialId);
  }

  private coseKey() {
    const jwk = this.publicKey.export({ format: "jwk" });

    return cbor([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? "", "base64url")],
      [-3, Buffer.from(jwk.y ?? "", "base64url")],
    ]);
  }

  private clientData(type: string, challenge: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
    );
  }

  register(options: { readonly challenge: string }, flags: Flags = {}) {
    const clientDataJSON = this.clientData("webauthn.create", options.challenge);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);

    const authData = Buffer.concat([
      sha256(Buffer.from(this.rpId)),
      Uint8Array.of(flagByte(flags, true)),
      counterBytes(this.counter),
      Buffer.alloc(16),
      idLength,
      this.credentialId,
      this.coseKey(),
    ]);

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(
          cbor([
            ["fmt", "none"],
            ["attStmt", []],
            ["authData", authData],
          ]),
        ),
      },
      clientExtensionResults: {},
    };
  }

  // `counter` overrides the signature counter, for example to replay an old value.
  assert(
    options: { readonly challenge: string },
    flags: Flags & { readonly counter?: number } = {},
  ) {
    // An override is sent once and does not move the authenticator's own counter.
    const counter = flags.counter ?? (this.counter += 1);
    const clientDataJSON = this.clientData("webauthn.get", options.challenge);

    const authData = Buffer.concat([
      sha256(Buffer.from(this.rpId)),
      Uint8Array.of(flagByte(flags, false)),
      counterBytes(counter),
    ]);

    const signature = sign(
      "sha256",
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );

    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: base64url(clientDataJSON),
        authenticatorData: base64url(authData),
        signature: base64url(signature),
      },
      clientExtensionResults: {},
    };
  }
}
