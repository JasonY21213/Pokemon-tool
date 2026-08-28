# Learnset source audit and policy

Phase 6 pins learnset relationships to Pokémon Showdown commit `84d7ceb4f009928221fce7a00e711bab263c5f4e`. The source is `data/learnsets.ts`; its top-level keys are Showdown Pokémon/Form IDs and each move maps to one or more acquisition source codes. The first code character is generation 1–9. The verified second-character meanings are machine (`M`), tutor (`T`), level/start (`L`), restricted or form-specific (`R`), egg (`E`), Dream World (`D`), event (`S`), transfer (`V`), and Showdown's chain-breeding helper (`C`). The complete original codes are retained at build time, including level or event-index suffixes.

The pinned file combines historical acquisition evidence across generations. Phase 6 therefore models **known move association in the pinned Showdown source across generations**, not exact current-cartridge legality and not a claim that every retained method remains available today. Runtime and UI intentionally omit acquisition-method labels; later generation/game legality work can use the preserved build-time evidence without changing stable entity or Move IDs.

Canonical data stores direct Form → Move pairs with all acquisition evidence, plus a separate Form inheritance edge. Runtime stores only each Form's direct Move IDs and optional parent Form ID, then computes the deterministic transitive union locally. This avoids copying large effective arrays across related forms while retaining the exact inheritance path at build time.

Inheritance mirrors the pinned `sim/dex-species.ts` behavior relevant to the stable registry:

- a Form without its own learnset falls back through `changesFrom`, battle-only origin, or base Form;
- a Form with its own learnset does not automatically inherit the base Form (important for independently modeled Forms such as Wormadam);
- pre-evolutions contribute learnsets along the evolution chain;
- explicit `changesFrom` families such as Rotom extend their source Form;
- Mega, Primal, and other battle-only Forms use their derived origin;
- the pinned special handling for base-evolution roots and Kyurem is retained.

All identities resolve through the existing stable Form and Move registries. No stable IDs are created. Unknown source Move IDs are reported as unresolved, and non-usable/quarantined Move records are reported separately and excluded from canonical/runtime learnsets rather than silently dropped.
