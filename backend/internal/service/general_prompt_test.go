package service

import (
	"strings"
	"testing"
)

func boolPtr(b bool) *bool { return &b }

func sampleCoverage() []CoverageInfo {
	return []CoverageInfo{{
		TypeName:    "AUTO",
		DisplayName: "Motor",
		Fields: []CoverageField{
			{Name: "vehicle_plate", Label: "Licence plate", Type: "text", Required: true},
			{Name: "damage_photos", Label: "Damage photos", Type: "array", Required: true},
			{Name: "driver_license", Label: "Driving licence", Type: "document", Required: true},
		},
	}}
}

func TestBehaviorFromSettings_DefaultsAndOverrides(t *testing.T) {
	b := BehaviorFromSettings(nil)
	if b != DefaultBotBehavior() {
		t.Fatalf("missing settings should keep defaults, got %+v", b)
	}
	b = BehaviorFromSettings([]CompanySettingInfo{
		{Name: SettingHumanHandoff, Type: "BOOLEAN", BoolValue: boolPtr(false)},
		{Name: SettingRequireClaimPhotos, Type: "boolean", BoolValue: boolPtr(false)},
		{Name: SettingClaimStatusLookup, Type: "TEXT"},
	})
	if b.HumanHandoff || b.RequirePhotos || !b.RequireDocuments || !b.StatusLookup {
		t.Fatalf("unexpected behaviour %+v", b)
	}
}

func TestBuildGeneralPrompt_EnglishUsesCompanyAndCoverage(t *testing.T) {
	p := BuildGeneralPrompt(GeneralPromptInput{
		Profile:  BotProfile{CompanyName: "Acme Cover", Language: "en", SystemPrompt: "You are the Acme Cover assistant."},
		Behavior: DefaultBotBehavior(),
		Coverage: sampleCoverage(),
		Message:  "hello",
		Mode:     "general",
	})
	for _, want := range []string{"Acme Cover", "Always answer in English", "You are the Acme Cover assistant.", "Motor [AUTO]", "Licence plate", "Damage photos", "Driving licence", "[STATUS]", "[ESCALATE]", "[INTENT_CODE] ::", "=== CURRENT CONVERSATION MODE: general ==="} {
		if !strings.Contains(p, want) {
			t.Errorf("English prompt missing %q", want)
		}
	}
	if strings.Contains(p, "Democratic Republic of Congo") || strings.Contains(p, "Réponds") {
		t.Error("English prompt should not contain the old hardcoded French/DRC text")
	}
}

func TestBuildGeneralPrompt_FrenchIsDefault(t *testing.T) {
	p := BuildGeneralPrompt(GeneralPromptInput{Profile: BotProfile{CompanyName: "Assur Plus", Language: ""}, Behavior: DefaultBotBehavior(), Mode: "claim_filing"})
	for _, want := range []string{"Assur Plus", "Réponds toujours en français", "=== MODE ACTUEL DE LA CONVERSATION: claim_filing ===", "[CANCEL]"} {
		if !strings.Contains(p, want) {
			t.Errorf("French prompt missing %q", want)
		}
	}
}

func TestBuildGeneralPrompt_TogglesOff(t *testing.T) {
	for _, lang := range []string{"en", "fr"} {
		p := BuildGeneralPrompt(GeneralPromptInput{
			Profile:  BotProfile{CompanyName: "Acme", Language: lang},
			Behavior: BotBehavior{},
			Coverage: sampleCoverage(),
			Mode:     "general",
		})
		for _, banned := range []string{"[ESCALATE]", "[STATUS]", "Damage photos", "Driving licence"} {
			if strings.Contains(p, banned) {
				t.Errorf("%s prompt with toggles off should not contain %q", lang, banned)
			}
		}
		if !strings.Contains(p, "Licence plate") {
			t.Errorf("%s prompt should still list required information", lang)
		}
	}
}

func TestFormatKnowledgeBase_SkipsBehaviorToggles(t *testing.T) {
	text := "Mon-Fri 8-17"
	kb := formatKnowledgeBase([]CompanySettingInfo{
		{Name: "business_hours", Description: "Business hours", Type: "TEXT", TextValue: &text},
		{Name: SettingHumanHandoff, Description: "Hand off", Type: "BOOLEAN", BoolValue: boolPtr(true)},
	}, "en")
	if !strings.Contains(kb, "Mon-Fri 8-17") || !strings.Contains(kb, "TEXT SETTINGS") {
		t.Errorf("knowledge base missing text setting: %s", kb)
	}
	if strings.Contains(kb, SettingHumanHandoff) {
		t.Error("behaviour toggles must not be listed as knowledge")
	}
}

func TestBotMessage_Language(t *testing.T) {
	if !strings.Contains(botMessage("en", msgEscalated), "support team") {
		t.Error("English escalation message expected")
	}
	if !strings.Contains(botMessage("xx", msgEscalated), "équipe") {
		t.Error("unknown language should fall back to French")
	}
}

func TestBuildGeneralPrompt_OtherLanguagesUseEnglishBase(t *testing.T) {
	for _, tc := range []struct{ lang, name, native string }{
		{"vi", "Vietnamese", "Tiếng Việt"},
		{"sw", "Swahili", "Kiswahili"},
		{"ar", "Arabic", "العربية"},
	} {
		p := BuildGeneralPrompt(GeneralPromptInput{Profile: BotProfile{CompanyName: "Acme", Language: tc.lang}, Behavior: DefaultBotBehavior(), Mode: "general"})
		for _, want := range []string{"The company's language is " + tc.name + " (" + tc.native + ")", "Always answer in " + tc.name, "detect their language", "=== CLAIM FILING PROCESS (CLAIM) ==="} {
			if !strings.Contains(p, want) {
				t.Errorf("%s prompt missing %q", tc.lang, want)
			}
		}
		if strings.Contains(p, "Réponds") || strings.Contains(p, "Always answer in English") {
			t.Errorf("%s prompt should use the English scaffold with its own language rule", tc.lang)
		}
	}
}

func TestBuildGeneralPrompt_ReplyInCustomerLanguageToggle(t *testing.T) {
	b := DefaultBotBehavior()
	if !b.ReplyInCustomerLanguage {
		t.Fatal("reply in customer language should default to on")
	}
	b = BehaviorFromSettings([]CompanySettingInfo{{Name: SettingReplyInCustomerLanguage, Type: "BOOLEAN", BoolValue: boolPtr(false)}})
	for lang, want := range map[string]string{
		"en": "Always answer in English, even if the customer writes in another language",
		"fr": "Réponds toujours en français, même si le client écrit dans une autre langue",
		"sw": "Always answer in Swahili (Kiswahili), even if the customer writes in another language",
	} {
		p := BuildGeneralPrompt(GeneralPromptInput{Profile: BotProfile{CompanyName: "Acme", Language: lang}, Behavior: b})
		if !strings.Contains(p, want) {
			t.Errorf("%s prompt with toggle off missing %q", lang, want)
		}
		if strings.Contains(p, "detect their language") || strings.Contains(p, "détecte alors sa langue") {
			t.Errorf("%s prompt with toggle off should not switch to the customer's language", lang)
		}
	}
	if !IsBehaviorSetting(SettingReplyInCustomerLanguage) {
		t.Error("the toggle must be kept out of the knowledge base")
	}
}

func TestGeneralFallbackMessage_Localized(t *testing.T) {
	if got := generalFallbackMessage("vi", "help"); got != "Hôm nay tôi có thể giúp gì cho bạn?" {
		t.Errorf("vi help = %q", got)
	}
	if got := generalFallbackMessage("fr", "error"); !strings.HasPrefix(got, "Désolé") {
		t.Errorf("fr error = %q", got)
	}
	if got := generalFallbackMessage("xx", "whatever"); got != botText("fr", "general.help") {
		t.Errorf("unknown language should fall back to the French default, got %q", got)
	}
}

func TestStatusUpdateMessage_AllRegisteredLanguages(t *testing.T) {
	want := []string{"am", "ar", "bn", "en", "es", "fr", "ha", "hi", "id", "ln", "pt", "sw", "tl", "vi", "yo"}
	if got := strings.Join(SupportedBotLanguages(), ","); got != strings.Join(want, ",") {
		t.Fatalf("bot languages = %s, want %s", got, strings.Join(want, ","))
	}
	en := StatusUpdateMessage("en", "APPROVED", "Ana", "CLM-1", "Acme", false)
	for _, lang := range want[:] {
		msg := StatusUpdateMessage(lang, "APPROVED", "Ana", "CLM-1", "Acme", true)
		if lang != "en" && msg == en {
			t.Errorf("%s status message is identical to English", lang)
		}
		if !strings.Contains(msg, "CLM-1") || !strings.Contains(msg, "Acme") || !strings.Contains(msg, "Ana") {
			t.Errorf("%s status message lost a placeholder value:\n%s", lang, msg)
		}
	}
}
