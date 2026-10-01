package service

import "testing"

func TestNormalizePhoneNumber(t *testing.T) {
	tests := []struct{ name, input, expected string }{
		{"With plus", "+243123456789", "243123456789"},
		{"With dashes", "1-234-567-8901", "12345678901"},
		{"With spaces", "+243 123 456 789", "243123456789"},
		{"With parens", "(243) 123-456-789", "243123456789"},
		{"Already clean", "243123456789", "243123456789"},
		{"Empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizePhoneNumber(tt.input); got != tt.expected {
				t.Errorf("normalizePhoneNumber(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
