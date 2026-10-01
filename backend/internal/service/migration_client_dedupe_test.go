package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"rapidos/internal/logger"
)

// Integration tests against a real PostgreSQL. Skipped unless
// RAPIDOS_TEST_DATABASE_URL points at a server where the user may create
// databases, e.g.
//   RAPIDOS_TEST_DATABASE_URL='host=/tmp/pg port=5432 user=postgres dbname=postgres sslmode=disable'
// A throwaway database is created, every Prisma migration is applied, and it is dropped afterwards.

const dedupeMigration = "20261001180000_client_dedupe_e164"

func migrationsDir(t *testing.T) string {
	dir := filepath.Join("..", "..", "..", "prisma", "migrations")
	if _, err := os.Stat(filepath.Join(dir, dedupeMigration, "migration.sql")); err != nil {
		t.Skipf("prisma migrations not found at %s", dir)
	}
	return dir
}

func freshDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("RAPIDOS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("RAPIDOS_TEST_DATABASE_URL not set")
	}
	cfg := &gorm.Config{Logger: gormlogger.Default.LogMode(gormlogger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	name := fmt.Sprintf("rapidos_test_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatalf("create database: %v", err)
	}
	var dbDSN string
	if strings.Contains(dsn, "dbname=") {
		parts := strings.Fields(dsn)
		for i, p := range parts {
			if strings.HasPrefix(p, "dbname=") {
				parts[i] = "dbname=" + name
			}
		}
		dbDSN = strings.Join(parts, " ")
	} else {
		dbDSN = dsn + " dbname=" + name
	}
	db, err := gorm.Open(postgres.Open(dbDSN), cfg)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
		admin.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)")
		if sqlDB, err := admin.DB(); err == nil {
			sqlDB.Close()
		}
	})
	return db
}

// applyMigrations runs the Prisma migrations in order, stopping before `until`
// (exclusive) or running all of them when until is "".
func applyMigrations(t *testing.T, db *gorm.DB, until string) {
	t.Helper()
	dir := migrationsDir(t)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		if until != "" && n >= until {
			return
		}
		applyMigration(t, db, n)
	}
}

func applyMigration(t *testing.T, db *gorm.DB, name string) {
	t.Helper()
	sql, err := os.ReadFile(filepath.Join(migrationsDir(t), name, "migration.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(sql)).Error; err != nil {
		t.Fatalf("migration %s: %v", name, err)
	}
}

func mustExec(t *testing.T, db *gorm.DB, sql string, args ...interface{}) {
	t.Helper()
	if err := db.Exec(sql, args...).Error; err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
}

func count(t *testing.T, db *gorm.DB, sql string, args ...interface{}) int64 {
	t.Helper()
	var n int64
	if err := db.Raw(sql, args...).Scan(&n).Error; err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	return n
}

const (
	coDRC   = "11111111-1111-4111-8111-111111111111"
	coOther = "22222222-2222-4222-8222-222222222222"
	adminID = "33333333-3333-4333-8333-333333333333"
	custOld = "a0000000-0000-4000-8000-000000000001" // "+243 812 345 678", oldest, no email
	custMid = "a0000000-0000-4000-8000-000000000002" // "0812345678", has email + policy
	custNew = "a0000000-0000-4000-8000-000000000003" // "243812345678" (bot), has address
	custSep = "a0000000-0000-4000-8000-000000000004" // another person
	custOth = "a0000000-0000-4000-8000-000000000005" // same number, other company: never merged
)

func seedDuplicates(t *testing.T, db *gorm.DB) {
	mustExec(t, db, `INSERT INTO companies (id, name, slug, domain, schema, country) VALUES
		(?, 'Activa', 'activa', 'activa.test', 'activa', 'RDC'), (?, 'Globex', 'globex', 'globex.test', 'globex', NULL)`, coDRC, coOther)
	mustExec(t, db, `INSERT INTO admins (id, email, first_name, last_name, password_hash, company_id) VALUES (?, 'a@activa.test', 'A', 'Dmin', 'x', ?)`, adminID, coDRC)
	mustExec(t, db, `INSERT INTO customers (id, phone_number, first_name, last_name, email, policy_number, address, company_id, created_at) VALUES
		(?, '+243 812 345 678', 'Grace', NULL, NULL, NULL, NULL, ?, now() - interval '30 days'),
		(?, '0812345678', 'Grace', 'Mukendi', 'grace@example.com', 'POL-1', NULL, ?, now() - interval '20 days'),
		(?, '243812345678', 'WhatsApp', NULL, NULL, 'POL-2', 'Av. Lumumba 12', ?, now() - interval '10 days'),
		(?, '243990000001', 'Jean', 'Kabila', NULL, NULL, NULL, ?, now()),
		(?, '243812345678', 'Grace', 'Other', NULL, NULL, NULL, ?, now())`,
		custOld, coDRC, custMid, coDRC, custNew, coDRC, custSep, coDRC, custOth, coOther)
	for i, c := range []string{custOld, custMid, custNew, custNew} {
		claim := fmt.Sprintf("c0000000-0000-4000-8000-00000000000%d", i+1)
		conv := fmt.Sprintf("d0000000-0000-4000-8000-00000000000%d", i+1)
		mustExec(t, db, `INSERT INTO claims (id, "claimNumber", "customerId", "companyId") VALUES (?, ?, ?, ?)`, claim, fmt.Sprintf("ACTI-%d", i+1), c, coDRC)
		mustExec(t, db, `INSERT INTO auto_claim_data (id, "claimId", "insuredFullName", "phoneNumber") VALUES (gen_random_uuid(), ?, 'Grace', '243812345678')`, claim)
		mustExec(t, db, `INSERT INTO claim_documents (id, "claimId", "fileName", "filePath", "fileType", "fileSize") VALUES (gen_random_uuid(), ?, 'photo.jpg', 'x', 'image/jpeg', 1)`, claim)
		mustExec(t, db, `INSERT INTO claim_notes (id, "claimId", content, "authorId") VALUES (gen_random_uuid(), ?, 'note', ?)`, claim, adminID)
		mustExec(t, db, `INSERT INTO conversations (id, company_id, customer_id) VALUES (?, ?, ?)`, conv, coDRC, c)
		mustExec(t, db, `INSERT INTO messages (id, content, conversation_id) VALUES (gen_random_uuid(), 'hello', ?)`, conv)
	}
	mustExec(t, db, `INSERT INTO feedbacks (id, "customerId", rating, "companyId") VALUES (gen_random_uuid(), ?, (enum_range(NULL::"FeedbackRating"))[1], ?)`, custMid, coDRC)
}

func TestMigrationClientDedupe_MergesDuplicatesWithinCompany(t *testing.T) {
	db := freshDatabase(t)
	applyMigrations(t, db, dedupeMigration)
	seedDuplicates(t, db)

	applyMigration(t, db, dedupeMigration)

	// One customer for Grace in Activa: the oldest record, E.164 number.
	if n := count(t, db, `SELECT count(*) FROM customers WHERE company_id = ?`, coDRC); n != 2 {
		t.Fatalf("Activa customers = %d, want 2 (Grace merged + Jean)", n)
	}
	var kept struct {
		ID, PhoneNumber, FirstName, LastName, Email, PolicyNumber, Address string
	}
	db.Raw(`SELECT id, phone_number, coalesce(first_name,'') first_name, coalesce(last_name,'') last_name, coalesce(email,'') email,
		coalesce(policy_number,'') policy_number, coalesce(address,'') address FROM customers WHERE company_id = ? AND first_name = 'Grace'`, coDRC).Scan(&kept)
	if kept.ID != custOld || kept.PhoneNumber != "+243812345678" {
		t.Fatalf("kept %+v, want the oldest record with +243812345678", kept)
	}
	// Empty fields completed from the duplicates (first non-empty, oldest first); the
	// "WhatsApp" placeholder of the bot record never replaces the real name.
	if kept.LastName != "Mukendi" || kept.Email != "grace@example.com" || kept.PolicyNumber != "POL-1" || kept.Address != "Av. Lumumba 12" {
		t.Fatalf("merged fields wrong: %+v", kept)
	}
	// Everything moved to the kept customer.
	if n := count(t, db, `SELECT count(*) FROM claims WHERE "customerId" = ?`, custOld); n != 4 {
		t.Fatalf("claims on kept customer = %d, want 4", n)
	}
	if n := count(t, db, `SELECT count(*) FROM conversations WHERE customer_id = ?`, custOld); n != 4 {
		t.Fatalf("conversations on kept customer = %d, want 4", n)
	}
	if n := count(t, db, `SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.customer_id = ?`, custOld); n != 4 {
		t.Fatalf("messages reachable from kept customer = %d, want 4", n)
	}
	if n := count(t, db, `SELECT count(*) FROM claim_documents d JOIN claims c ON c.id = d."claimId" WHERE c."customerId" = ?`, custOld); n != 4 {
		t.Fatalf("documents = %d, want 4", n)
	}
	if n := count(t, db, `SELECT count(*) FROM claim_notes nn JOIN claims c ON c.id = nn."claimId" WHERE c."customerId" = ?`, custOld); n != 4 {
		t.Fatalf("notes = %d, want 4", n)
	}
	if n := count(t, db, `SELECT count(*) FROM feedbacks WHERE "customerId" = ?`, custOld); n != 1 {
		t.Fatalf("feedback not moved")
	}
	if n := count(t, db, `SELECT count(*) FROM auto_claim_data WHERE "phoneNumber" = '+243812345678'`); n != 4 {
		t.Fatalf("claim phone copies not in E.164: %d", n)
	}
	// Logged.
	if n := count(t, db, `SELECT count(*) FROM customer_merges WHERE kept_customer_id = ? AND merged_customer_id IN (?, ?)`, custOld, custMid, custNew); n != 2 {
		t.Fatalf("merge log rows = %d, want 2", n)
	}
	if n := count(t, db, `SELECT count(*) FROM customer_merges WHERE merged_customer_id = ? AND merged_fields->>'email' = 'grace@example.com' AND (moved_rows->>'claims')::int = 1`, custMid); n != 1 {
		t.Fatalf("merge log lacks the merged fields / moved rows")
	}
	// Other people and other companies are untouched (numbers still rewritten).
	if n := count(t, db, `SELECT count(*) FROM customers WHERE id = ? AND phone_number = '+243990000001'`, custSep); n != 1 {
		t.Fatalf("separate customer changed")
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE id = ? AND phone_number = '+243812345678' AND company_id = ?`, custOth, coOther); n != 1 {
		t.Fatalf("customer of another company was merged or not normalised")
	}
	// The approximate-date columns exist.
	mustExec(t, db, `UPDATE claims SET "incidentDateApproximate" = true, "incidentDateText" = 'mardi ou mercredi passé' WHERE "claimNumber" = 'ACTI-1'`)

	// Idempotent: running it again merges nothing.
	applyMigration(t, db, dedupeMigration)
	if n := count(t, db, `SELECT count(*) FROM customer_merges`); n != 2 {
		t.Fatalf("second run logged new merges: %d", n)
	}
}

func TestGetOrCreateCustomer_ConcurrentFormatsYieldOneCustomer(t *testing.T) {
	db := freshDatabase(t)
	applyMigrations(t, db, "")
	mustExec(t, db, `INSERT INTO companies (id, name, slug, domain, schema, country) VALUES (?, 'Activa', 'activa', 'activa.test', 'activa', 'RDC')`, coDRC)
	svc := NewDatabaseService(db, nil, logger.New())

	formats := []string{"243812000111", "+243812000111", "+243 812 000 111", "243812000111", "+243812000111", "243812000111", "+243 812-000-111", "243812000111"}
	ids := make([]string, len(formats))
	errs := make([]error, len(formats))
	var wg sync.WaitGroup
	for i, f := range formats {
		wg.Add(1)
		go func(i int, f string) {
			defer wg.Done()
			c, err := svc.GetOrCreateCustomer(f, coDRC)
			errs[i] = err
			if c != nil {
				ids[i] = c.ID
			}
		}(i, f)
	}
	wg.Wait()
	for i := range formats {
		if errs[i] != nil {
			t.Fatalf("GetOrCreateCustomer(%q): %v", formats[i], errs[i])
		}
		if ids[i] != ids[0] {
			t.Fatalf("different customers for one person: %v", ids)
		}
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE company_id = ?`, coDRC); n != 1 {
		t.Fatalf("customers = %d, want 1", n)
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE phone_number = '+243812000111'`); n != 1 {
		t.Fatalf("number not stored in E.164")
	}

	// Profile rules on the real SQL: fill empty, never overwrite unless corrected.
	if err := svc.UpdateCustomerName(ids[0], "Grace Mukendi", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.UpdateCustomerName(ids[0], "Ezali Grace", false); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE id = ? AND first_name = 'Grace' AND last_name = 'Mukendi'`, ids[0]); n != 1 {
		t.Fatalf("a non-correction overwrote the stored name")
	}
	if err := svc.UpdateCustomerName(ids[0], "Gracia", true); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE id = ? AND first_name = 'Gracia' AND last_name = 'Mukendi'`, ids[0]); n != 1 {
		t.Fatalf("an explicit first-name correction should keep the last name")
	}
	if err := svc.UpdateCustomerPolicyNumber(ids[0], "POL-1", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.UpdateCustomerPolicyNumber(ids[0], "POL-2", false); err != nil {
		t.Fatal(err)
	}
	if n := count(t, db, `SELECT count(*) FROM customers WHERE id = ? AND policy_number = 'POL-1'`, ids[0]); n != 1 {
		t.Fatalf("policy overwritten without a correction")
	}
}

// The SQL normaliser used by the migration and the Go/TS ones must agree.
func TestMigrationPhoneNormaliser_MatchesGo(t *testing.T) {
	db := freshDatabase(t)
	applyMigrations(t, db, "")
	cc := ""
	db.Raw(`SELECT rapidos_calling_code('RDC', NULL)`).Scan(&cc)
	if cc != "243" {
		t.Fatalf("calling code = %q", cc)
	}
	for _, raw := range []string{"+243 812 345 678", "00243812345678", "243812345678", "0812345678", "812345678", "(+243) 812.345.678", "15550093001", "abc", "+12", "0", "+1234567890123456"} {
		var got *string
		db.Raw(`SELECT rapidos_normalize_phone(?, '243')`, raw).Scan(&got)
		want := NormalizePhoneE164(raw, "243")
		g := ""
		if got != nil {
			g = *got
		}
		if g != want {
			t.Errorf("%q: SQL %q, Go %q", raw, g, want)
		}
	}
}
