package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(pw string, cost int) (string, error) { b, err := bcrypt.GenerateFromPassword([]byte(pw), cost); return string(b), err }
func CheckPassword(hash, pw string) bool { return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil }
