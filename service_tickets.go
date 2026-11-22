package main

import (
	E "github.com/lagzap/zap/common/exceptions"
	D "github.com/lagzap/zap/data"
)

// MyTicketsResult is the Wails-friendly shape for ListMyTickets.
type MyTicketsResult struct {
	Tickets             []*D.Ticket `json:"tickets"`
	UnreadCount         uint32      `json:"unreadCount"`
	UnreadMessagesTotal uint32      `json:"unreadMessagesTotal"`
}

func (s *Service) CreateTicket(ticketType, subject, body string, requestableType, requestableID *string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.CreateTicket(ticketType, subject, body, requestableType, requestableID)
}

func (s *Service) ListMyTickets() (*MyTicketsResult, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	tickets, unreadCount, unreadMessagesTotal, err := s.coordinator.ListMyTickets()
	if err != nil {
		return nil, err
	}
	return &MyTicketsResult{
		Tickets:             tickets,
		UnreadCount:         unreadCount,
		UnreadMessagesTotal: unreadMessagesTotal,
	}, nil
}

func (s *Service) GetTicket(ticketID string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.GetTicket(ticketID)
}

// GetTicketWindow reads a ticket with a window of its messages: the newest
// limit, those before beforeID (scrolling up) or after afterID (catching up).
func (s *Service) GetTicketWindow(ticketID, beforeID, afterID string, limit uint32) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.GetTicketWindow(ticketID, beforeID, afterID, limit)
}

// SetHelpCenterView says what the help center shows ("closed", "list",
// "chat"), and that the user is active in it.
func (s *Service) SetHelpCenterView(view string) {
	if s.coordinator != nil {
		s.coordinator.SetHelpCenterView(view)
	}
}

// ReplyTicket sends a message; replyToID quotes one of the ticket's messages
// (empty: none) and clientID lets a retry return the stored copy.
func (s *Service) ReplyTicket(ticketID, body, replyToID, clientID string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.ReplyTicket(ticketID, body, replyToID, clientID)
}

// ReactTicketMessage sets the user's reaction on a message; an empty emoji
// removes it.
func (s *Service) ReactTicketMessage(ticketID, messageID, emoji string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.ReactTicketMessage(ticketID, messageID, emoji)
}

// CloseTicket closes one of the user's open tickets.
func (s *Service) CloseTicket(ticketID string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.CloseTicket(ticketID)
}

// SetTicketTyping tells support the user is typing in a ticket, or stopped.
func (s *Service) SetTicketTyping(ticketID string, typing bool) {
	if s.IsReady() {
		_ = s.coordinator.SetTicketTyping(ticketID, typing)
	}
}
