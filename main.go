package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	authURL   = "https://accounts.google.com/o/oauth2/v2/auth"
	tokenURL  = "https://oauth2.googleapis.com/token"
	revokeURL = "https://oauth2.googleapis.com/revoke"
	scope     = "https://www.googleapis.com/auth/calendar.readonly"
)

var errNotAuthorized = errors.New("not authorized")

type config struct {
	clientID     string
	clientSecret string
	redirectURL  string
	staticDir    string
	tokenPath    string
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

type storedToken struct {
	RefreshToken string `json:"refresh_token"`
}

type tokenStore struct {
	cfg          config
	client       *http.Client
	mu           sync.Mutex
	refreshToken string
	accessToken  string
	expiry       time.Time
}

func (s *tokenStore) load() error {
	b, err := os.ReadFile(s.cfg.tokenPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var t storedToken
	if err := json.Unmarshal(b, &t); err != nil {
		return err
	}
	s.refreshToken = t.RefreshToken
	return nil
}

func (s *tokenStore) save(refreshToken string) error {
	b, err := json.Marshal(storedToken{RefreshToken: refreshToken})
	if err != nil {
		return err
	}
	tmp := s.cfg.tokenPath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.cfg.tokenPath)
}

func (s *tokenStore) clear() {
	s.refreshToken = ""
	s.accessToken = ""
	s.expiry = time.Time{}
	if err := os.Remove(s.cfg.tokenPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("remove token file: %v", err)
	}
}

func (s *tokenStore) exchange(form url.Values) (*tokenResponse, error) {
	form.Set("client_id", s.cfg.clientID)
	form.Set("client_secret", s.cfg.clientSecret)
	resp, err := s.client.PostForm(tokenURL, form)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if tr.Error == "invalid_grant" {
		return nil, errNotAuthorized
	}
	if resp.StatusCode != http.StatusOK || tr.Error != "" {
		return nil, fmt.Errorf("token endpoint %d: %s %s", resp.StatusCode, tr.Error, tr.ErrorDesc)
	}
	return &tr, nil
}

func (s *tokenStore) setAccess(tr *tokenResponse) {
	s.accessToken = tr.AccessToken
	s.expiry = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
}

func (s *tokenStore) accessTokenFor() (string, time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.refreshToken == "" {
		return "", time.Time{}, errNotAuthorized
	}
	if time.Until(s.expiry) > 5*time.Minute {
		return s.accessToken, s.expiry, nil
	}

	tr, err := s.exchange(url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {s.refreshToken},
	})
	if errors.Is(err, errNotAuthorized) {
		s.clear()
		return "", time.Time{}, err
	}
	if err != nil {
		return "", time.Time{}, err
	}
	s.setAccess(tr)
	return s.accessToken, s.expiry, nil
}

func (s *tokenStore) handleToken(w http.ResponseWriter, r *http.Request) {
	token, expiry, err := s.accessTokenFor()
	if errors.Is(err, errNotAuthorized) {
		http.Error(w, "not authorized", http.StatusUnauthorized)
		return
	}
	if err != nil {
		log.Printf("refresh access token: %v", err)
		http.Error(w, "token refresh failed", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{
		"access_token": token,
		"expires_in":   int(time.Until(expiry).Seconds()),
	})
}

func (s *tokenStore) handleLogin(w http.ResponseWriter, r *http.Request) {
	b := make([]byte, 16)
	rand.Read(b)
	state := hex.EncodeToString(b)
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/auth/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	q := url.Values{
		"client_id":     {s.cfg.clientID},
		"redirect_uri":  {s.cfg.redirectURL},
		"response_type": {"code"},
		"scope":         {scope},
		"access_type":   {"offline"},
		"prompt":        {"consent"},
		"state":         {state},
	}
	http.Redirect(w, r, authURL+"?"+q.Encode(), http.StatusFound)
}

func (s *tokenStore) handleCallback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("oauth_state")
	if err != nil || cookie.Value == "" || cookie.Value != r.URL.Query().Get("state") {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Path: "/auth/", MaxAge: -1})

	if e := r.URL.Query().Get("error"); e != "" {
		http.Error(w, "google returned: "+e, http.StatusBadRequest)
		return
	}

	tr, err := s.exchange(url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {r.URL.Query().Get("code")},
		"redirect_uri": {s.cfg.redirectURL},
	})
	if err != nil {
		log.Printf("exchange code: %v", err)
		http.Error(w, "code exchange failed", http.StatusBadGateway)
		return
	}
	if tr.RefreshToken == "" {
		http.Error(w, "google did not return a refresh token", http.StatusBadGateway)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.save(tr.RefreshToken); err != nil {
		log.Printf("save token: %v", err)
		http.Error(w, "could not save token", http.StatusInternalServerError)
		return
	}
	s.refreshToken = tr.RefreshToken
	s.setAccess(tr)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (s *tokenStore) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.refreshToken != "" {
		resp, err := s.client.PostForm(revokeURL, url.Values{"token": {s.refreshToken}})
		if err != nil {
			log.Printf("revoke token: %v", err)
		} else {
			resp.Body.Close()
		}
	}
	s.clear()
	w.WriteHeader(http.StatusNoContent)
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("%s is required", key)
	}
	return v
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	cfg := config{
		clientID:     mustEnv("GOOGLE_CLIENT_ID"),
		clientSecret: mustEnv("GOOGLE_CLIENT_SECRET"),
		redirectURL:  mustEnv("REDIRECT_URL"),
		staticDir:    envOr("STATIC_DIR", "dist"),
		tokenPath:    filepath.Join(envOr("DATA_DIR", "data"), "token.json"),
	}
	if !strings.HasSuffix(cfg.redirectURL, "/auth/callback") {
		log.Fatalf("REDIRECT_URL must end in /auth/callback, got %q", cfg.redirectURL)
	}

	store := &tokenStore{cfg: cfg, client: &http.Client{Timeout: 15 * time.Second}}
	if err := store.load(); err != nil {
		log.Fatalf("load token: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/token", store.handleToken)
	mux.HandleFunc("GET /auth/login", store.handleLogin)
	mux.HandleFunc("GET /auth/callback", store.handleCallback)
	mux.HandleFunc("POST /auth/logout", store.handleLogout)
	mux.Handle("/", http.FileServer(http.Dir(cfg.staticDir)))

	addr := ":" + envOr("PORT", "3000")
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
