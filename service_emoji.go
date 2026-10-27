package main

// OpenEmojiPanel opens the OS emoji / IME picker for the focused input.
func (s *Service) OpenEmojiPanel() error {
	return openEmojiPanel()
}
