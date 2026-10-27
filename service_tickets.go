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

func (s *Service) ReplyTicket(ticketID, body string) (*D.Ticket, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.ReplyTicket(ticketID, body)
}
