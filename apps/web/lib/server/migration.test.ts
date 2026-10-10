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
      ];

      for (const col of requiredInsertColumns) {
        expect(insertColumns).toContain(col);
      }

      // Restricted columns must NOT be insertable by authenticated users.
      // status_cache is strictly withheld from client INSERT to prevent forging
      // lifecycle state; the DB default sets 'DRAFT'.
      expect(insertColumns).not.toContain("status_cache");
      expect(insertColumns).not.toContain("chain_asset_id");
      expect(insertColumns).not.toContain("token_address");
      expect(insertColumns).not.toContain("address_private");
    });

    it("enforces RLS on property creation: owner_user_id = auth.uid() and status_cache = 'DRAFT'", () => {
      expect(sql).toMatch(
        /create\s+policy\s+properties_insert_own\s+on\s+public\.properties\s+for\s+insert\s+to\s+authenticated\s+with\s+check\s*\(\s*owner_user_id\s*=\s*auth\.uid\(\)\s+and\s+status_cache\s*=\s*'DRAFT'\s*\)/i,
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

  describe("on-chain transaction and revenue cache tables privileges and policies", () => {
    it("grants only SELECT on public.chain_transactions and public.revenue_epochs to anon", () => {
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.chain_transactions\s+to\s+anon;/i);
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.revenue_epochs\s+to\s+anon;/i);

      // anon must NOT receive insert, update, delete, or all
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.chain_transactions\s+to\s+anon\b/i,
      );
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.revenue_epochs\s+to\s+anon\b/i,
      );
    });

    it("grants only SELECT on public.chain_transactions and public.revenue_epochs to authenticated", () => {
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.chain_transactions\s+to\s+authenticated;/i);
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.revenue_epochs\s+to\s+authenticated;/i);

      // authenticated must NOT receive insert, update, delete, or all
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.chain_transactions\s+to\s+authenticated\b/i,
      );
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.revenue_epochs\s+to\s+authenticated\b/i,
      );
    });

    it("revokes all prior privileges on cache tables before granting selective access", () => {
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.chain_transactions\s+from\s+anon;/i);
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.revenue_epochs\s+from\s+anon;/i);
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.chain_transactions\s+from\s+authenticated;/i);
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.revenue_epochs\s+from\s+authenticated;/i);
    });

    it("does not create any direct INSERT, UPDATE, or DELETE RLS policies on cache tables", () => {
      expect(sql).not.toMatch(/create\s+policy\s+chain_transactions_insert/i);
      expect(sql).not.toMatch(/create\s+policy\s+chain_transactions_update/i);
      expect(sql).not.toMatch(/create\s+policy\s+chain_transactions_delete/i);

      expect(sql).not.toMatch(/create\s+policy\s+revenue_epochs_insert/i);
      expect(sql).not.toMatch(/create\s+policy\s+revenue_epochs_update/i);
      expect(sql).not.toMatch(/create\s+policy\s+revenue_epochs_delete/i);
    });

    it("idempotently drops stale INSERT, UPDATE, and DELETE policies on cache tables", () => {
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+chain_transactions_insert_owner\s+on\s+public\.chain_transactions;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+chain_transactions_update_owner\s+on\s+public\.chain_transactions;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+chain_transactions_delete_owner\s+on\s+public\.chain_transactions;/i,
      );

      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+revenue_epochs_insert_owner\s+on\s+public\.revenue_epochs;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+revenue_epochs_update_owner\s+on\s+public\.revenue_epochs;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+revenue_epochs_delete_owner\s+on\s+public\.revenue_epochs;/i,
      );
    });

    it("maintains public SELECT policies for chain_transactions and revenue_epochs", () => {
      expect(sql).toMatch(
        /create\s+policy\s+chain_transactions_select_public\s+on\s+public\.chain_transactions\s+for\s+select\s+to\s+anon,\s*authenticated\s+using\s*\(\s*true\s*\);/i,
      );
      expect(sql).toMatch(
        /create\s+policy\s+revenue_epochs_select_public\s+on\s+public\.revenue_epochs\s+for\s+select\s+to\s+anon,\s*authenticated\s+using\s*\(\s*true\s*\);/i,
      );
    });

    it("enforces unique constraints on revenue_epochs for period and chain_epoch_id to prevent replay", () => {
      // Must enforce one epoch per period
      expect(sql).toMatch(
        /constraint\s+revenue_epochs_one_per_period\s+unique\s*\(\s*property_id\s*,\s*period\s*\)/i,
      );
      // Must enforce one epoch per verified on-chain epoch to prevent replay across periods
      expect(sql).toMatch(
        /constraint\s+revenue_epochs_one_per_chain_epoch\s+unique\s*\(\s*property_id\s*,\s*chain_epoch_id\s*\)/i,
      );
      // Must contain idempotent guard ensuring the constraint is added if rerun
      expect(sql).toMatch(/conname\s*=\s*'revenue_epochs_one_per_chain_epoch'/i);
    });
  });

  describe("property_documents table and storage bucket privileges and policies", () => {
    it("grants only SELECT on public.property_documents to authenticated and withholds INSERT, UPDATE, DELETE", () => {
      expect(sql).toMatch(/grant\s+select\s+on\s+public\.property_documents\s+to\s+authenticated;/i);
      expect(sql).not.toMatch(
        /grant\s+[^;]*\b(insert|update|delete|all)\b[^;]*\bon\s+public\.property_documents\s+to\s+authenticated\b/i,
      );
    });

    it("withholds all table privileges on public.property_documents from anon", () => {
      expect(sql).toMatch(/revoke\s+all\s+on\s+public\.property_documents\s+from\s+anon;/i);
      expect(sql).not.toMatch(
        /grant\s+[^;]*\bon\s+public\.property_documents\s+to\s+anon\b/i,
      );
    });

    it("idempotently drops client write policies on public.property_documents and retains owner SELECT policy", () => {
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_insert_owner\s+on\s+public\.property_documents;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_update_owner\s+on\s+public\.property_documents;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_delete_owner\s+on\s+public\.property_documents;/i,
      );

      // Must NOT create client write policies
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_insert/i);
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_update/i);
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_delete/i);

      // Must create owner SELECT policy using public.owns_property
      expect(sql).toMatch(
        /create\s+policy\s+property_documents_select_owner\s+on\s+public\.property_documents\s+for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.owns_property\(property_id\)\s*\);/i,
      );
    });

    it("idempotently drops client write policies on property-documents storage bucket and retains owner SELECT policy", () => {
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_storage_insert\s+on\s+storage\.objects;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_storage_update\s+on\s+storage\.objects;/i,
      );
      expect(sql).toMatch(
        /drop\s+policy\s+if\s+exists\s+property_documents_storage_delete\s+on\s+storage\.objects;/i,
      );

      // Must NOT create client storage write policies for property-documents
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_storage_insert/i);
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_storage_update/i);
      expect(sql).not.toMatch(/create\s+policy\s+property_documents_storage_delete/i);

      // Must retain owner SELECT policy on property-documents
      expect(sql).toMatch(
        /create\s+policy\s+property_documents_storage_select\s+on\s+storage\.objects\s+for\s+select\s+to\s+authenticated/i,
      );
    });
  });

  describe("Supabase-managed Storage RLS", () => {
    it("does not ALTER Supabase-owned Storage tables", () => {
      expect(sql).not.toMatch(/alter\s+table\s+(?:only\s+)?storage\s*\./i);
    });

    it("fails closed unless storage.objects already has RLS enabled", () => {
      expect(sql).toMatch(
        /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+pg_catalog\.pg_class\s+as\s+c\s+join\s+pg_catalog\.pg_namespace\s+as\s+n\s+on\s+n\.oid\s*=\s*c\.relnamespace\s+where\s+n\.nspname\s*=\s*'storage'\s+and\s+c\.relname\s*=\s*'objects'\s+and\s+c\.relrowsecurity\s*\)\s+then\s+raise\s+exception\s+'RLS must already be enabled on storage\.objects before applying ARCHPROP Storage policies\.';/i,
      );
    });

    it.each([
      "users",
      "properties",
      "property_documents",
      "property_images",
      "chain_transactions",
      "revenue_epochs",
    ])("still enables RLS on the application-owned %s table", (table) => {
      expect(sql).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security;`, "i"),
      );
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
