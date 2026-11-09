package main

import "github.com/lagzap/lagzap/adapter"

// Team plans and the gamer tag. Each action answers with the team and the
// user's invitations after it, or the server's refusal (TeamResult.Error);
// the "team" event carries the same to every open window.

func (s *Service) teamClient() adapter.TeamClient {
	if s.coordinator == nil {
		return nil
	}
	client, _ := s.coordinator.(adapter.TeamClient)
	return client
}

func notReady() adapter.TeamResult {
	return adapter.TeamResult{Error: &adapter.TeamError{Code: adapter.TeamErrorUnreachable, Message: adapter.TeamErrorUnreachable}}
}

func (s *Service) teamAction(run func(adapter.TeamClient) adapter.TeamResult) adapter.TeamResult {
	if client := s.teamClient(); client != nil {
		return run(client)
	}
	return notReady()
}

func (s *Service) GetTeam() adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.GetTeam() })
}

// InviteToTeam invites an account by email or by phone (one of them).
func (s *Service) InviteToTeam(email, phone string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.InviteToTeam(email, phone) })
}

// CreateTeamInviteCode makes a one-time code, shown only in this reply.
func (s *Service) CreateTeamInviteCode() adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.CreateTeamInviteCode() })
}

func (s *Service) RevokeTeamInvite(id string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.RevokeTeamInvite(id) })
}

func (s *Service) AcceptTeamInvite(id string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.AcceptTeamInvite(id) })
}

func (s *Service) DeclineTeamInvite(id string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.DeclineTeamInvite(id) })
}

func (s *Service) JoinTeam(code string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.JoinTeam(code) })
}

func (s *Service) RemoveTeamMember(subscriberID string) adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.RemoveTeamMember(subscriberID) })
}

func (s *Service) LeaveTeam() adapter.TeamResult {
	return s.teamAction(func(c adapter.TeamClient) adapter.TeamResult { return c.LeaveTeam() })
}

// SetGamerTag sets the account's gamer tag.
func (s *Service) SetGamerTag(name string) adapter.NameResult {
	if client := s.teamClient(); client != nil {
		return client.SetName(name)
	}
	return adapter.NameResult{Error: &adapter.TeamError{Code: adapter.TeamErrorUnreachable, Message: adapter.TeamErrorUnreachable}}
}
