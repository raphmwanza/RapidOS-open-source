package service

import (
	"sync"
	"time"

	"rapidos/internal/logger"
)

// WebhookDispatcher processes WhatsApp messages in the background so the
// webhook can acknowledge Meta immediately. Messages of the same conversation
// (company + sender) run one after another, in arrival order; different
// conversations run in parallel. Message ids seen recently are skipped (Meta
// retries deliveries); the database dedupe remains the source of truth.
type WebhookDispatcher struct {
	log *logger.Logger

	mu    sync.Mutex
	tails map[string]chan struct{}
	seen  map[string]time.Time
	ttl   time.Duration
	wg    sync.WaitGroup
}

// NewWebhookDispatcher creates a dispatcher.
func NewWebhookDispatcher(log *logger.Logger) *WebhookDispatcher {
	if log == nil {
		log = logger.New()
	}
	return &WebhookDispatcher{log: log, tails: map[string]chan struct{}{}, seen: map[string]time.Time{}, ttl: 15 * time.Minute}
}

// MarkSeen records a message id and reports whether it is new.
func (d *WebhookDispatcher) MarkSeen(messageID string) bool {
	if messageID == "" {
		return true
	}
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	for id, at := range d.seen {
		if now.Sub(at) > d.ttl {
			delete(d.seen, id)
		}
	}
	if _, dup := d.seen[messageID]; dup {
		return false
	}
	d.seen[messageID] = now
	return true
}

// Submit runs job after every job previously submitted with the same key.
func (d *WebhookDispatcher) Submit(key string, job func()) {
	d.mu.Lock()
	prev := d.tails[key]
	done := make(chan struct{})
	d.tails[key] = done
	d.mu.Unlock()

	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		defer func() {
			close(done)
			d.mu.Lock()
			if d.tails[key] == done {
				delete(d.tails, key)
			}
			d.mu.Unlock()
		}()
		if prev != nil {
			<-prev
		}
		defer func() {
			if r := recover(); r != nil {
				d.log.Errorf("❌ [WEBHOOK] message processing panicked: %v", r)
			}
		}()
		job()
	}()
}

// Wait blocks until every submitted job has finished (tests, shutdown).
func (d *WebhookDispatcher) Wait() { d.wg.Wait() }

// WebhookMessages lists the customer messages of a webhook payload.
func WebhookMessages(webhook WhatsAppWebhook) []WhatsAppIncomingMessage {
	var out []WhatsAppIncomingMessage
	for _, entry := range webhook.Entry {
		for _, change := range entry.Changes {
			out = append(out, change.Value.Messages...)
		}
	}
	return out
}

// HandleMessageForCompany processes one webhook message of a company.
func (w *WhatsAppService) HandleMessageForCompany(msg WhatsAppIncomingMessage, companyID string) error {
	return w.handleIncomingMessageForCompany(msg, companyID)
}
