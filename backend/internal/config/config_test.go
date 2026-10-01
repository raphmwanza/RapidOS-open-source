package config

import "testing"

func TestAPIPortPrefersPlatformPORT(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh")

	cases := []struct {
		name, port, apiPort, want string
	}{
		{"defaults to 8080", "", "", "8080"},
		{"API_PORT for docker compose and host runs", "", "9090", "9090"},
		{"PORT from Railway wins", "7171", "9090", "7171"},
		{"PORT alone", "7171", "", "7171"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PORT", tc.port)
			t.Setenv("API_PORT", tc.apiPort)
			if got := Load().APIPort; got != tc.want {
				t.Fatalf("APIPort = %q, want %q", got, tc.want)
			}
		})
	}
}
