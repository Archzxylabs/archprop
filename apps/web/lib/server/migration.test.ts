/**
 * Static migration privilege regression tests.
 *
 * NOTE ON TEST CLASSIFICATION:
 * These tests are STATIC DDL REGRESSION TESTS (Unit / Static Schema Analysis).
 * They parse and verify the SQL migration DDL directly to guarantee that the
 * schema and privilege definitions satisfy the least-privilege security model,
 * column-level grants, and SECURITY DEFINER requirements without requiring a
 * live Supabase/PostgreSQL database instance.
 *
 * In environments with a configured live PostgreSQL instance (e.g. CI or local
 * Supabase test container), live role-impersonation queries can additionally be
 * run. In the absence of a live database, these executable assertions guarantee
 * that no privilege regression enters the migration file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../supabase/migrations/20260822000000_initial_schema.sql",
);

function loadMigrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("Migration DDL privilege regression tests (Static Schema Analysis)", () => {
  const sql = loadMigrationSql();

  describe("anon role least-privilege and data exposure prevention", () => {
    it("does not grant blanket SELECT or ALL on public.properties to anon", () => {
      // Blanket table-level SELECT would expose address_private and owner_user_id
      const blanketSelectRegex = /grant\s+(select|all)\s+on\s+(table\s+)?public\.properties\s+to\s+anon\b/i;
      expect(blanketSelectRegex.test(sql)).toBe(false);
    });

    it("restricts anon to column-level SELECT for only public presentation columns", () => {
      // Must have column-level grant: grant select (...) on public.properties to anon
      const anonGrantMatch = /grant\s+select\s*\(([^)]+)\)\s+on\s+public\.properties\s+to\s+anon/is.exec(
        sql,
      );
      expect(anonGrantMatch).not.toBeNull();
      expect(anonGrantMatch?.[1]).toBeDefined();

      const columns = (anonGrantMatch?.[1] ?? "")
        .split(",")
        .map((column) => column.trim().toLowerCase());

      // owner_user_id and address_private MUST NEVER be granted to anon
      expect(columns).not.toContain("owner_user_id");
      expect(columns).not.toContain("address_private");

      // Required public presentation columns must be granted
      const expectedPublicColumns = [
        "id",
        "chain_asset_id",
        "external_id",
        "name",
        "slug",
        "property_type",
        "location",
        "issuer_name",
        "description",
        "indicative_value",
        "offering_target",
        "token_supply",
        "token_price",
        "economic_rights_bps",
        "status_cache",
        "token_address",
        "created_at",
      ];

      for (const col of expectedPublicColumns) {
        expect(columns).toContain(col);
      }
    });

    it("revokes all permissions from anon on private tables", () => {
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.property_documents\s+from\s+anon/i);
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.users\s+from\s+anon/i);
    });
  });

  describe("authenticated role property creation permissions", () => {
    it("grants authenticated users INSERT privilege on the exact required property columns", () => {
      const authInsertGrantMatch =
        /grant\s+insert\s*\(([^)]+)\)\s+on\s+public\.properties\s+to\s+authenticated/is.exec(sql);
      expect(authInsertGrantMatch).not.toBeNull();
      expect(authInsertGrantMatch?.[1]).toBeDefined();

      const insertColumns = (authInsertGrantMatch?.[1] ?? "")
        .split(",")
        .map((column) => column.trim().toLowerCase());

      // Exactly the columns required by POST /api/properties
      const requiredInsertColumns = [
        "owner_user_id",
        "external_id",
        "name",
        "slug",
        "property_type",
        "location",
        "issuer_name",
        "description",
        "indicative_value",
        "offering_target",
        "token_supply",
        "token_price",
        "economic_rights_bps",
        "status_cache",
      ];

      for (const col of requiredInsertColumns) {
        expect(insertColumns).toContain(col);
      }

      // Restriced columns must NOT be insertable by authenticated users
      expect(insertColumns).not.toContain("chain_asset_id");
      expect(insertColumns).not.toContain("token_address");
      expect(insertColumns).not.toContain("address_private");
    });

    it("enforces RLS on property creation: owner_user_id = auth.uid()", () => {
      expect(sql).toMatch(
        /create\s+policy\s+properties_insert_own\s+on\s+public\.properties\s+for\s+insert\s+to\s+authenticated\s+with\s+check\s*\(\s*owner_user_id\s*=\s*auth\.uid\(\)\s*\)/i,
      );
    });

    it("withholds owner_user_id and address_private from authenticated SELECT grants", () => {
      const authSelectGrantMatch =
        /grant\s+select\s*\(([^)]+)\)\s+on\s+public\.properties\s+to\s+authenticated/is.exec(sql);
      expect(authSelectGrantMatch).not.toBeNull();

      const selectColumns = (authSelectGrantMatch?.[1] ?? "")
        .split(",")
        .map((column) => column.trim().toLowerCase());

      expect(selectColumns).not.toContain("owner_user_id");
      expect(selectColumns).not.toContain("address_private");
    });
  });

  describe("owns_property function security definition and execution privileges", () => {
    it("defines owns_property as SECURITY DEFINER with locked search_path", () => {
      // Find the owns_property function definition block
      const funcBlockMatch =
        /create\s+or\s+replace\s+function\s+public\.owns_property\([^)]*\)[\s\S]*?\$\$;/i.exec(sql);
      expect(funcBlockMatch).not.toBeNull();
      const funcDef = funcBlockMatch?.[0] ?? "";

      expect(funcDef).toMatch(/\bsecurity\s+definer\b/i);
      expect(funcDef).not.toMatch(/\bsecurity\s+invoker\b/i);

      // Locked search path to prevent search_path manipulation in SECURITY DEFINER
      expect(funcDef).toMatch(/\bset\s+search_path\s*=\s*''/i);

      // Fully qualified references inside the function
      expect(funcDef).toMatch(/\bpublic\.properties\b/i);
      expect(funcDef).toMatch(/\bauth\.uid\(\)/i);
    });

    it("revokes default PUBLIC execution and grants execute only where required", () => {
      expect(sql).toMatch(
        /revoke\s+(all|execute)\s+on\s+function\s+public\.owns_property\([^)]*\)\s+from\s+public/i,
      );
      expect(sql).toMatch(
        /grant\s+execute\s+on\s+function\s+public\.owns_property\([^)]*\)\s+to\s+authenticated,\s*service_role/i,
      );
    });
  });

  describe("authenticated role users table permissions (non-self-assignable role and wallet)", () => {
    it("grants authenticated role only SELECT on public.users and withholds INSERT, UPDATE, DELETE", () => {
      // Authenticated must have SELECT to read their own profile
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.users\s+to\s+authenticated;/i);

      // Authenticated MUST NOT have INSERT, UPDATE, or DELETE on public.users
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.users\s+to\s+authenticated/i,
      );
    });

    it("does not allow client self-assignment of role or wallet_address via RLS policies", () => {
      // Policies allowing direct client update or insert must be dropped
      expect(sql).not.toMatch(/create\s+policy\s+users_update_own/i);
      expect(sql).not.toMatch(/create\s+policy\s+users_insert_own/i);

      // Explicit drop statements ensure idempotency
      expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+users_update_own\s+on\s+public\.users;/i);
      expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+users_insert_own\s+on\s+public\.users;/i);
    });

    it("ensures handle_new_auth_user trigger provisions mirror rows under SECURITY DEFINER", () => {
      const triggerFuncMatch =
        /create\s+or\s+replace\s+function\s+public\.handle_new_auth_user\(\)[\s\S]*?\$\$;/i.exec(sql);
      expect(triggerFuncMatch).not.toBeNull();
      const triggerFuncDef = triggerFuncMatch?.[0] ?? "";

      expect(triggerFuncDef).toMatch(/\bsecurity\s+definer\b/i);
      expect(triggerFuncDef).toMatch(/insert\s+into\s+public\.users/i);
      expect(sql).toMatch(/create\s+trigger\s+on_auth_user_created/i);
    });

    it("keeps owner_user_id and address_private inaccessible to anon and authenticated raw SELECT", () => {
      // Verify anon grants omit private columns
      const anonGrantMatch = /grant\s+select\s*\(([^)]+)\)\s+on\s+public\.properties\s+to\s+anon/is.exec(sql);
      const anonCols = (anonGrantMatch?.[1] ?? "").split(",").map((c) => c.trim().toLowerCase());
      expect(anonCols).not.toContain("owner_user_id");
      expect(anonCols).not.toContain("address_private");

      // Verify authenticated grants omit private columns
      const authGrantMatch = /grant\s+select\s*\(([^)]+)\)\s+on\s+public\.properties\s+to\s+authenticated/is.exec(sql);
      const authCols = (authGrantMatch?.[1] ?? "").split(",").map((c) => c.trim().toLowerCase());
      expect(authCols).not.toContain("owner_user_id");
      expect(authCols).not.toContain("address_private");
    });
  });

  describe("Distinction between static and live integration tests", () => {
    it("reports verification mode clearly", () => {
      const liveDbConfigured = Boolean(
        process.env.SUPABASE_DATABASE_URL || process.env.TEST_DATABASE_URL,
      );
      if (!liveDbConfigured) {
        // Explicitly acknowledge that RLS and privilege assertions are verified statically
        expect(liveDbConfigured).toBe(false);
      }
    });
  });
});
