import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const DATASET = "openerp-six-books/v2";

const SCHEMA = "openerp-six-books-observation/v2";

const REQUIRED_ROLE = "restricted accounting runtime";

function sha256HexUtf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function requireLoopback(url) {
  const parsed = new URL(url);

  const allowed = new Set(["localhost", "127.0.0.1", "[::1]"]);

  if (!allowed.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error("Use an explicitly verified loopback synthetic environment.");
  }
}

async function applicationCommit() {
  try {
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { timeout: 10_000 });

    return stdout.trim();
  } catch {
    return "unrecorded-skeleton";
  }
}

export function requireLoopbackExport(url) {
  requireLoopback(url);
}

export async function createAdapter(config) {
  if (!config || config.dataset !== DATASET) {
    throw new Error(`Adapter requires dataset ${DATASET}.`);
  }

  if (config.allowExternalNetwork !== false) {
    throw new Error("External network must stay disabled for six-books fixtures.");
  }

  const state = {
    books: new Map(),
    clocks: new Map(),
    sources: new Map(),
    bank: new Map(),
    traces: [],
    createdAt: new Date().toISOString(),
    commit: await applicationCommit(),
  };

  function bookState(book) {
    const entry = state.books.get(book);

    if (!entry) {
      throw new Error(`Book ${book} has no staged fixture. Call provisionFixtureBook first.`);
    }

    return entry;
  }

  return {
    async assertIsolated(requirements) {
      if (requirements.syntheticOnly !== true) {
        throw new Error("Six-books fixtures are synthetic only.");
      }

      if (requirements.allowExternalNetwork !== false) {
        throw new Error("External network must stay disabled.");
      }

      if (requirements.requiredRole !== REQUIRED_ROLE) {
        throw new Error(`Required role is ${REQUIRED_ROLE}.`);
      }

      if (requirements.noProductionData !== true) {
        throw new Error("Production data is out of scope for six-books fixtures.");
      }

      for (const name of ["SIXBOOKS_BASE_URL", "SIXBOOKS_ADMIN_URL", "DATABASE_URL"]) {
        const value = process.env[name];

        if (value) {
          try {
            requireLoopback(value);
          } catch {
            throw new Error(`${name} must name an explicitly verified loopback host.`);
          }
        }
      }

      const baseUrl = process.env.SIXBOOKS_BASE_URL;

      if (baseUrl) {
        requireLoopback(baseUrl);
      }
    },

    async provisionFixtureBook(book, profile, provisioning) {
      if (!["A", "B", "C", "D", "E", "F"].includes(book)) {
        throw new Error(`Unknown book ${book}.`);
      }

      if (!profile || profile.synthetic !== true || profile.no_production_identity !== true) {
        throw new Error(`Book ${book} profile must stay synthetic with no production identity.`);
      }

      if (!provisioning || !provisioning.chart || !provisioning.actors) {
        throw new Error("Provisioning requires chart and actors from the challenge bundle.");
      }

      const fixtureHash = sha256HexUtf8(JSON.stringify({ book, profile, provisioning }));

      state.books.set(book, { profile, provisioning, fixtureHash });

      state.sources.set(book, new Map());

      state.bank.set(book, new Map());
    },

    async setFixtureClock(instant, scope) {
      if (!scope || !scope.book || scope.dataset !== DATASET) {
        throw new Error("Fixture clock scope must name the book and six-books dataset.");
      }

      bookState(scope.book);

      const parsed = new Date(instant);

      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid fixture clock instant ${instant}.`);
      }

      state.clocks.set(scope.book, instant);
    },

    async retainOriginals(book, sources) {
      const staged = state.sources.get(book);

      if (!staged) {
        throw new Error(`Book ${book} has no staged fixture.`);
      }

      for (const source of sources) {
        if (!source || !source.sourceId || typeof source.originalUtf8 !== "string") {
          throw new Error("Original input must carry sourceId and originalUtf8.");
        }

        const actual = sha256HexUtf8(source.originalUtf8);

        if (actual !== source.expectedTransportHash) {
          throw new Error(
            `Transport hash mismatch for ${source.sourceId}: expected ${source.expectedTransportHash}, observed ${actual}.`,
          );
        }

        staged.set(source.sourceId, {
          hash: actual,
          availableAt: source.availableAt,
          bytes: Buffer.byteLength(source.originalUtf8, "utf8"),
        });
      }
    },

    async retainBankObservations(book, observations) {
      const staged = state.bank.get(book);

      if (!staged) {
        throw new Error(`Book ${book} has no staged fixture.`);
      }

      for (const observation of observations) {
        const id = observation.transaction_id ?? observation.id;

        if (!id) {
          throw new Error("Bank observation must carry transaction_id.");
        }

        staged.set(id, observation);
      }
    },

    async executeScenarioAction(action) {
      if (!action || !action.event_id || !action.book || !action.intent) {
        throw new Error("Scenario action must carry event_id, book and intent.");
      }

      bookState(action.book);

      const trace = {
        operation: `${action.intent}:BLOCKED_UNSUPPORTED:skeleton-no-owner-call`,
        requestKey: action.event_id,
        actorAlias: "prep_1",
        actualRequestId: `skeleton-${action.book}-${action.event_id}`,
        applicationCommit: state.commit,
        observedAt: new Date().toISOString(),
        outcome: "unknown",
        financialEffect: false,
      };

      state.traces.push({ book: action.book, event_id: action.event_id, actualTrace: [trace] });

      return [trace];
    },

    async observeNormalizedResults(request) {
      if (!request || request.dataset !== DATASET) {
        throw new Error(`Observation requires dataset ${DATASET}.`);
      }

      const books = [...new Set(request.books)];

      if (books.some((book) => !["A", "B", "C", "D", "E", "F"].includes(book))) {
        throw new Error("Unknown book in observation request.");
      }

      return {
        schema: SCHEMA,
        dataset: DATASET,
        adapter: "skeleton-only",
        applicationCommit: state.commit,
        books: books.map((book) => {
          const staged = state.books.get(book);

          const sources = state.sources.get(book) ?? new Map();

          return {
            book,
            status: "BLOCKED_UNSUPPORTED",
            reason:
              "Skeleton only: isolation, fixture staging and byte retention are real; no financial groups were observed through real application owners yet.",
            fixtureHash: staged ? staged.fixtureHash : null,
            fixtureClock: state.clocks.get(book) ?? null,
            retainedSources: [...sources.entries()].map(([sourceId, entry]) => ({
              sourceId,
              hash: entry.hash,
              availableAt: entry.availableAt,
            })),
            executedEvents: state.traces
              .filter((entry) => entry.book === book)
              .map((entry) => entry.event_id),
          };
        }),
      };
    },
  };
}
