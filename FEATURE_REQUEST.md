# OCode Feature Requests

This index links to the individual feature requests for the OCode fork of OpenCode. Each request is documented separately so it can be shared with another model or implemented independently.

1. [Synchronize session activity with terminal tab titles](feature-requests/01-tab-animation-sync.md)
2. [Read sessions from other local OpenCode installations](feature-requests/02-cross-installation-sessions.md)
3. [Group resumable sessions by harness for the current directory](feature-requests/03-harness-session-categories.md)
4. [Expose model quota information through the OmniRoute API](feature-requests/04-omniroute-quota-api.md)
5. [Render provider-aware model quotas in the OCode footer](feature-requests/05-ocode-provider-aware-footer.md) — consumes Feature 4's OmniRoute API when OmniRoute is selected
6. [Make links in assistant responses clickable](feature-requests/06-clickable-response-links.md)
7. [Recall undelivered queued prompts with the Up arrow](feature-requests/07-queued-prompt-recall.md)
8. [Use a two-line, Powerlevel10k-inspired footer/status bar](feature-requests/08-powerlevel10k-footer.md)

Each request is intended to be shareable and implementable on its own unless a dependency is stated. Requests 2 and 3 are related: harness grouping requires session sources to be discoverable and readable. Requests 4 and 5 are coordinated but separate deliverables: OmniRoute exposes quota data, and OCode consumes it.
