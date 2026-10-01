package service

import (
	"strings"
	"unicode"
)

// Phone numbers are stored in E.164 ("+243812345678") everywhere: customers,
// claim data and lookups. WhatsApp sends the sender as international digits
// ("243812345678"); the dashboard may receive "+243 81 234 5678",
// "00243…" or a national "0812…" number.

// countryCallingCodes maps a company country (ISO code or common name, lower
// case, accents folded) to its calling code. Used for national numbers.
var countryCallingCodes = map[string]string{
	"cd": "243", "cod": "243", "drc": "243", "rdc": "243", "dr congo": "243", "congo-kinshasa": "243", "congo kinshasa": "243",
	"democratic republic of the congo": "243", "republique democratique du congo": "243", "rd congo": "243",
	"cg": "242", "cog": "242", "congo": "242", "congo-brazzaville": "242", "republic of the congo": "242", "republique du congo": "242",
	"ke": "254", "ken": "254", "kenya": "254",
	"ug": "256", "uga": "256", "uganda": "256", "ouganda": "256",
	"tz": "255", "tza": "255", "tanzania": "255", "tanzanie": "255",
	"rw": "250", "rwa": "250", "rwanda": "250",
	"bi": "257", "bdi": "257", "burundi": "257",
	"ao": "244", "ago": "244", "angola": "244",
	"zm": "260", "zmb": "260", "zambia": "260", "zambie": "260",
	"ng": "234", "nga": "234", "nigeria": "234",
	"gh": "233", "gha": "233", "ghana": "233",
	"sn": "221", "sen": "221", "senegal": "221",
	"ci": "225", "civ": "225", "cote d'ivoire": "225", "ivory coast": "225",
	"cm": "237", "cmr": "237", "cameroon": "237", "cameroun": "237",
	"za": "27", "zaf": "27", "south africa": "27", "afrique du sud": "27",
	"et": "251", "eth": "251", "ethiopia": "251", "ethiopie": "251",
	"ma": "212", "mar": "212", "morocco": "212", "maroc": "212",
	"eg": "20", "egy": "20", "egypt": "20", "egypte": "20",
	"fr": "33", "fra": "33", "france": "33",
	"be": "32", "bel": "32", "belgium": "32", "belgique": "32",
	"gb": "44", "uk": "44", "gbr": "44", "united kingdom": "44",
	"us": "1", "usa": "1", "united states": "1", "ca": "1", "canada": "1",
	"in": "91", "ind": "91", "india": "91",
	"ph": "63", "phl": "63", "philippines": "63",
	"id": "62", "idn": "62", "indonesia": "62", "indonesie": "62",
	"vn": "84", "vnm": "84", "vietnam": "84", "viet nam": "84",
	"bd": "880", "bgd": "880", "bangladesh": "880",
	"br": "55", "bra": "55", "brazil": "55", "bresil": "55",
	"pt": "351", "prt": "351", "portugal": "351",
	"es": "34", "esp": "34", "spain": "34", "espagne": "34",
	"mx": "52", "mex": "52", "mexico": "52",
}

// CallingCodeForCountry returns the calling code of a company country ("" if unknown).
func CallingCodeForCountry(country string) string {
	return countryCallingCodes[strings.TrimSpace(foldText(country))]
}

// NormalizePhoneE164 returns the number as "+<country code><number>", or ""
// when it cannot be normalised. defaultCallingCode (e.g. "243") is used for
// national numbers ("0812345678" or "812345678"); without it such numbers are
// rejected rather than guessed. Digits-only input of 10+ digits (a WhatsApp
// wa_id) is taken as international.
func NormalizePhoneE164(raw, defaultCallingCode string) string {
	s := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || strings.ContainsRune("-.()/\u00a0", r) {
			return -1
		}
		return r
	}, strings.TrimSpace(raw))
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "00") {
		s = "+" + s[2:]
	}
	plus := strings.HasPrefix(s, "+")
	d := digitsOnly(s)
	if d == "" || len(d) != len(strings.TrimPrefix(s, "+")) {
		return "" // letters or other symbols
	}
	cc := digitsOnly(defaultCallingCode)
	if !plus {
		switch {
		case strings.HasPrefix(d, "0"):
			if cc == "" {
				return ""
			}
			d = cc + strings.TrimLeft(d, "0")
		case len(d) <= 9 && cc != "" && !strings.HasPrefix(d, cc):
			d = cc + d
		case len(d) < 10 && cc == "":
			return ""
		}
	}
	if len(d) < 8 || len(d) > 15 || d[0] == '0' {
		return ""
	}
	return "+" + d
}

// whatsappE164 converts a WhatsApp sender (international digits) to E.164.
func whatsappE164(from string) string {
	d := digitsOnly(from)
	if d == "" {
		return ""
	}
	if e := NormalizePhoneE164("+"+d, ""); e != "" {
		return e
	}
	return "+" + d
}

// phoneLookupVariants are the stored forms a number may still have in old
// rows (E.164 and digits only).
func phoneLookupVariants(e164 string) []string {
	d := digitsOnly(e164)
	if d == "" {
		return nil
	}
	return []string{"+" + d, d}
}
