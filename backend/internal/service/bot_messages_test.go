package service

import (
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestStatusUpdateMessage_FollowsBotLanguage(t *testing.T) {
	en := StatusUpdateMessage("en", "APPROVED", "Ada Obi", "HM-123", "Harbor Mutual", true)
	for _, want := range []string{"Hello Ada Obi,", "#HM-123", "approved", "separate message", "The Harbor Mutual team"} {
		if !strings.Contains(en, want) {
			t.Errorf("English message missing %q:\n%s", want, en)
		}
	}
	fr := StatusUpdateMessage("fr", "approuve", "Ada Obi", "HM-123", "Harbor Mutual", false)
	for _, want := range []string{"Bonjour Ada Obi,", "n°HM-123", "approuvé", "L'équipe Harbor Mutual"} {
		if !strings.Contains(fr, want) {
			t.Errorf("French message missing %q:\n%s", want, fr)
		}
	}
	if strings.Contains(fr, "récapitulatif") {
		t.Error("PDF note must be omitted when no PDF follows")
	}
}

func TestStatusUpdateMessage_EveryStatusEveryLanguage(t *testing.T) {
	for _, lang := range SupportedBotLanguages() {
		for _, st := range []string{"NEW", "ONGOING", "APPROVED", "REJECTED", "COMPLETED", "ON_HOLD"} {
			msg := StatusUpdateMessage(lang, st, "Ada", "HM-9", "Harbor", true)
			if !strings.Contains(msg, "HM-9") || !strings.Contains(msg, "Ada") || !strings.Contains(msg, "Harbor") {
				t.Errorf("%s/%s: placeholders not filled:\n%s", lang, st, msg)
			}
			if regexp.MustCompile(`\{\w+\}`).MatchString(msg) {
				t.Errorf("%s/%s: unfilled placeholder:\n%s", lang, st, msg)
			}
		}
	}
}

func TestStatusUpdateMessage_NoNameNoCompany(t *testing.T) {
	msg := StatusUpdateMessage("en", "NEW", "  ", "HM-1", "", false)
	if !strings.HasPrefix(msg, "Hello,") || strings.Contains(msg, "The  team") || strings.Contains(msg, "The {company} team") {
		t.Errorf("unexpected message: %s", msg)
	}
}

func TestBotLocales_KeysAndPlaceholdersMatchEnglish(t *testing.T) {
	ph := regexp.MustCompile(`\{\w+\}`)
	ref := botLocales[BotFallbackLanguage]
	for lang, m := range botLocales {
		for key, enText := range ref {
			text, ok := m[key]
			if !ok || strings.TrimSpace(text) == "" {
				t.Errorf("%s: missing key %s", lang, key)
				continue
			}
			a, b := ph.FindAllString(enText, -1), ph.FindAllString(text, -1)
			sort.Strings(a)
			sort.Strings(b)
			if strings.Join(a, ",") != strings.Join(b, ",") {
				t.Errorf("%s: %s placeholders %v, want %v", lang, key, b, a)
			}
		}
		for key := range m {
			if _, ok := ref[key]; !ok {
				t.Errorf("%s: unknown key %s (not in en.json)", lang, key)
			}
		}
	}
}

func TestCanonicalClaimStatus(t *testing.T) {
	cases := map[string]string{"en_cours": "ONGOING", "termine": "COMPLETED", "approved": "APPROVED", " NEW ": "NEW"}
	for in, want := range cases {
		if got := CanonicalClaimStatus(in); got != want {
			t.Errorf("CanonicalClaimStatus(%q) = %q, want %q", in, got, want)
		}
	}
}
