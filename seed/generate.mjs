#!/usr/bin/env node
/**
 * Emit seed SQL for a tenant profile so the profile JSON stays the single
 * source of truth. Usage:
 *
 *   npm run seed:sql -- <profile-key> > seed/.generated.sql
 *   npx wrangler d1 execute DB --remote --file seed/.generated.sql
 *
 * Seeds the customer, task(s), and route(s) from profiles/<key>.json. Rerunning
 * would duplicate rows, so seed a fresh database only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const key = process.argv[2];
if (!key) {
  console.error('usage: node seed/generate.mjs <profile-key>');
  process.exit(1);
}

const profile = JSON.parse(readFileSync(join(here, '..', 'profiles', `${key}.json`), 'utf8'));

/**
 * Refuse to seed a profile that hasn't actually been filled in.
 *
 * Both of these fail silently and expensively if they get through: a `TODO:`
 * string lands as a customer name on a real invoice, and `oneWayMiles: 0`
 * makes every trip bill zero miles — the app looks like it's working while
 * quietly under-billing every journey. Seeding runs once against a fresh
 * database, so the mistake is also annoying to unwind.
 */
function unfilledPlaceholders(p) {
  const problems = [];
  const walk = (value, path) => {
    if (typeof value === 'string' && /TODO/i.test(value)) {
      problems.push(`${path} is still a placeholder: ${JSON.stringify(value)}`);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(p.seed ?? {}, 'seed');
  for (const [i, r] of (p.seed?.routes ?? []).entries()) {
    if (!(r.oneWayMiles > 0)) {
      problems.push(
        `seed.routes[${i}].oneWayMiles is ${JSON.stringify(r.oneWayMiles)} — every trip on this route would bill zero miles`,
      );
    }
  }
  return problems;
}

const problems = unfilledPlaceholders(profile);
if (problems.length > 0) {
  console.error(`Refusing to generate seed SQL from profiles/${key}.json:\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nFill these in, then re-run.');
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lines = [`-- Generated from profiles/${key}.json — do not edit by hand.`];

const seed = profile.seed ?? {};
if (seed.customer) {
  const c = seed.customer;
  lines.push(
    `INSERT INTO customers (name, address, email) VALUES (${q(c.name)}, ${q(c.address)}, ${q(c.email)});`,
  );
  // Attach tasks/routes to the customer just inserted.
  for (const t of seed.tasks ?? []) {
    const cents = Math.round((t.rateDollarsPerHour ?? 0) * 100);
    lines.push(
      `INSERT INTO tasks (customer_id, name, description, rate_cents_per_hour) ` +
        `VALUES ((SELECT id FROM customers WHERE name = ${q(c.name)}), ${q(t.name)}, ${q(t.description)}, ${cents});`,
    );
  }
}
for (const r of seed.routes ?? []) {
  lines.push(
    `INSERT INTO routes (label, from_address, to_address, one_way_miles) ` +
      `VALUES (${q(r.label)}, ${q(r.fromAddress)}, ${q(r.toAddress)}, ${r.oneWayMiles});`,
  );
}

process.stdout.write(lines.join('\n') + '\n');
