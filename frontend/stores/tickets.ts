import { defineStore, acceptHMRUpdate } from "pinia";
import { Events } from "@wailsio/runtime";
import {
  CreateTicket,
  GetTicketWindow,
  ListMyTickets,
  ReplyTicket,
  SetHelpCenterView,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Ticket } from "~/bindings/github.com/lagzap/zap/data";

function pickString(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return "";
}

function pickNumber(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return 0;
}

function pickBool(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (!(key in raw)) {
      continue;
    }
    const value = raw[key];
    if (value === true || value === 1 || value === "1" || value === "true") {
      return true;
    }
    if (value === false || value === 0 || value === "0" || value === "false") {
      return false;
    }
  }
  return false;
}

function normalizeTicket(raw: unknown): Ticket | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  // Wails event payloads are often wrapped
  const unwrapped =
    "data" in raw && (raw as { data: unknown }).data
      ? (raw as { data: unknown }).data
      : raw;
  const source = (
    Array.isArray(unwrapped) ? unwrapped[0] : unwrapped
  ) as Record<string, unknown> | null;
  if (!source || typeof source !== "object") {
    return null;
  }

  const id = pickString(source, "id", "Id", "ID");
  if (!id) {
    return null;
  }

  const unreadMessages = pickNumber(
    source,
    "unread_messages",
    "unreadMessages",
    "UnreadMessages",
  );
  const unread =
    pickBool(
      source,
      "unread",
      "Unread",
      "creator_has_unread",
      "creatorHasUnread",
      "CreatorHasUnread",
    ) || unreadMessages > 0;

  const ticket = {
    ...source,
    id,
    type: pickString(source, "type", "Type") || (source.type as string) || "",
    status:
      pickString(source, "status", "Status") || (source.status as string) || "",
    subject:
      pickString(source, "subject", "Subject") ||
      (source.subject as string) ||
      "",
    body: pickString(source, "body", "Body") || (source.body as string) || "",
    requestable_type:
      pickString(source, "requestable_type", "requestableType", "RequestableType") ||
      null,
    requestable_id:
      pickString(source, "requestable_id", "requestableId", "RequestableId") ||
      null,
    close_reason:
      pickString(source, "close_reason", "closeReason", "CloseReason") || null,
    assignee_name:
      pickString(source, "assignee_name", "assigneeName", "AssigneeName") ||
      null,
    created_at:
      pickString(source, "created_at", "createdAt", "CreatedAt") || undefined,
    updated_at:
      pickString(source, "updated_at", "updatedAt", "UpdatedAt") || undefined,
    unread,
    unread_messages: unreadMessages,
    messages: (source.messages as Ticket["messages"]) ?? [],
  } as Ticket;

  return ticket;
}

function clearLocalUnread(ticket: Ticket) {
  ticket.unread = false;
  (ticket as Ticket & { unread_messages?: number }).unread_messages = 0;
}

type TicketMessageRow = NonNullable<Ticket["messages"]>[number];

/** Messages of both lists by id, the newer copy winning, oldest first. A
 * chat is loaded a window at a time, so nothing ever replaces it whole. */
function mergeMessages(
  have: Ticket["messages"] | undefined,
  incoming: Ticket["messages"] | undefined,
): TicketMessageRow[] {
  const byId = new Map<string, TicketMessageRow>();
  const order: string[] = [];
  for (const message of [...(have ?? []), ...(incoming ?? [])]) {
    if (!message?.id) continue;
    if (!byId.has(message.id)) order.push(message.id);
    byId.set(message.id, message);
  }
  const out = order.map((id) => byId.get(id)!);
  // ISO times sort as strings; equal or missing ones keep their order.
  return out
    .map((message, i) => ({ message, i }))
    .sort((a, b) => {
      const at = a.message.created_at || "";
      const bt = b.message.created_at || "";
      return at && bt && at !== bt ? at.localeCompare(bt) : a.i - b.i;
    })
    .map(({ message }) => message);
}

/** How many messages a chat loads at a time. */
const MESSAGE_PAGE = 50;

function cloneTicket(ticket: Ticket): Ticket {
  return {
    ...ticket,
    messages: [...(ticket.messages ?? [])],
  } as Ticket;
}

export const useTicketsStore = defineStore("tickets", () => {
  const tickets = ref<Ticket[]>([]);
  /** Full ticket payloads keyed by id (detail cache). */
  const ticketById = ref<Record<string, Ticket>>({});
  const unreadCount = ref(0);
  const unreadMessagesTotal = ref(0);
  const loading = ref(false);
  const refreshing = ref(false);
  const loaded = ref(false);
  const activeTicket = ref<Ticket | null>(null);
  const activeLoading = ref(false);
  /** Whether a chat has messages before those loaded (scroll up for more). */
  const hasOlder = ref<Record<string, boolean>>({});
  const loadingOlder = ref(false);
  /** Whole tickets popup session (list and/or chat). */
  const popupActive = ref(false);
  const popupTicketId = ref<string | null>(null);
  const popupMinimized = ref(false);
  let listening = false;
  let openRequestSeq = 0;

  const popupVisible = computed(() => popupActive.value);
  const popupOpen = computed(
    () => popupActive.value && !popupMinimized.value,
  );
  const popupShowingChat = computed(() => !!popupTicketId.value);

  const rememberTicket = (ticket: Ticket, { mergeList = true } = {}) => {
    if (!ticket?.id) {
      return;
    }
    const prev = ticketById.value[ticket.id];
    const next = {
      ...ticket,
      messages: mergeMessages(prev?.messages, ticket.messages),
    } as Ticket;
    ticketById.value = { ...ticketById.value, [ticket.id]: cloneTicket(next) };
    if (mergeList) {
      const idx = tickets.value.findIndex((t) => t.id === ticket.id);
      if (idx >= 0) {
        tickets.value.splice(idx, 1, next);
      } else {
        tickets.value.unshift(next);
      }
      tickets.value.sort((a, b) => {
        const aAt = a.updated_at || a.created_at || "";
        const bAt = b.updated_at || b.created_at || "";
        return bAt.localeCompare(aAt);
      });
    }
  };

  const cachedTicket = (id: string): Ticket | null => {
    const full = ticketById.value[id];
    if (full) {
      return cloneTicket(full);
    }
    const listed = tickets.value.find((t) => t.id === id);
    return listed ? cloneTicket(listed) : null;
  };

  const upsertTicket = (ticket: Ticket) => {
    rememberTicket(ticket);
    if (activeTicket.value?.id === ticket.id) {
      activeTicket.value = cloneTicket(ticketById.value[ticket.id] ?? ticket);
    }
  };

  const refreshUnreadFromList = () => {
    unreadCount.value = tickets.value.filter((t) => t.unread).length;
    unreadMessagesTotal.value = tickets.value.reduce((sum, t) => {
      const n = Number(
        (t as Ticket & { unread_messages?: number }).unread_messages ?? 0,
      );
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  };

  const fetchTickets = async ({ silent = false } = {}) => {
    const hasCache = tickets.value.length > 0 || loaded.value;
    if (hasCache) {
      refreshing.value = true;
      if (!silent) {
        // Keep previous rows visible; only first load uses the big spinner.
      }
    } else {
      loading.value = true;
    }
    try {
      const result = await ListMyTickets();
      const list = (result?.tickets ?? [])
        .map((item) => normalizeTicket(item))
        .filter(Boolean) as Ticket[];

      // List rows are summaries: keep the messages already loaded.
      tickets.value = list.map((ticket) => {
        rememberTicket(ticket, { mergeList: false });
        return ticketById.value[ticket.id];
      });

      const resultAny = result as {
        unreadCount?: number;
        unreadMessagesTotal?: number;
      } | null;
      unreadCount.value =
        typeof resultAny?.unreadCount === "number"
          ? resultAny.unreadCount
          : list.filter((t) => t.unread).length;
      unreadMessagesTotal.value =
        typeof resultAny?.unreadMessagesTotal === "number"
          ? resultAny.unreadMessagesTotal
          : list.reduce((sum, t) => {
              const n = Number(
                (t as Ticket & { unread_messages?: number }).unread_messages ??
                  0,
              );
              return sum + (Number.isFinite(n) ? n : 0);
            }, 0);
      loaded.value = true;
      return result;
    } finally {
      loading.value = false;
      refreshing.value = false;
    }
  };

  const createTicket = async (
    type: string,
    subject: string,
    body: string,
    requestableType?: string | null,
    requestableID?: string | null,
  ) => {
    const raw = await CreateTicket(
      type,
      subject,
      body,
      requestableType ?? null,
      requestableID ?? null,
    );
    const ticket = normalizeTicket(raw);
    if (!ticket) {
      throw new Error("ticket_create_failed");
    }
    upsertTicket(ticket);
    return ticket;
  };

  const openTicket = async (id: string) => {
    const seq = ++openRequestSeq;
    const cached = cachedTicket(id);
    if (cached) {
      activeTicket.value = cached;
      // Soft refresh indicator only when we have nothing to show yet.
      activeLoading.value = false;
    } else {
      activeLoading.value = true;
    }

    try {
      // Loaded before: only what came after its newest message. First open:
      // the newest page; older ones load when scrolled up to (loadOlder).
      const newest = ticketById.value[id]?.messages?.at(-1)?.id ?? "";
      const raw = await GetTicketWindow(id, "", newest, newest ? 0 : MESSAGE_PAGE);
      const ticket = normalizeTicket(raw);
      if (seq !== openRequestSeq) {
        return ticket;
      }
      if (ticket) {
        if (!newest) {
          hasOlder.value = { ...hasOlder.value, [id]: !!raw?.has_older };
        }
        // GET_TICKET marks seen server-side; clear local badge immediately.
        clearLocalUnread(ticket);
        rememberTicket(ticket);
        refreshUnreadFromList();
        activeTicket.value = cloneTicket(ticketById.value[id] ?? ticket);
      }
      return ticket;
    } finally {
      if (seq === openRequestSeq) {
        activeLoading.value = false;
      }
    }
  };

  /** Older messages of a chat, a page before the oldest one loaded. */
  const loadOlder = async (id: string) => {
    if (loadingOlder.value || !hasOlder.value[id]) {
      return false;
    }
    const oldest = ticketById.value[id]?.messages?.[0]?.id;
    if (!oldest) {
      return false;
    }
    loadingOlder.value = true;
    try {
      const raw = await GetTicketWindow(id, oldest, "", MESSAGE_PAGE);
      const ticket = normalizeTicket(raw);
      if (!ticket) {
        return false;
      }
      hasOlder.value = { ...hasOlder.value, [id]: !!raw?.has_older };
      clearLocalUnread(ticket);
      upsertTicket(ticket);
      return (ticket.messages?.length ?? 0) > 0;
    } finally {
      loadingOlder.value = false;
    }
  };

  const replyTicket = async (id: string, body: string) => {
    const ticket = normalizeTicket(await ReplyTicket(id, body));
    if (!ticket) {
      throw new Error("ticket_reply_failed");
    }
    // A reply is when an answer is most likely: poll at the fastest pace.
    tellHelpCenterView();
    clearLocalUnread(ticket);
    upsertTicket(ticket);
    refreshUnreadFromList();
    return ticket;
  };

  const clearActive = () => {
    activeTicket.value = null;
  };

  const openTicketsPopup = () => {
    popupActive.value = true;
    popupMinimized.value = false;
    popupTicketId.value = null;
    clearActive();
    ensureListeners();
  };

  const openTicketPopup = (id: string) => {
    if (!id) {
      return;
    }
    popupActive.value = true;
    popupMinimized.value = false;
    popupTicketId.value = id;
    ensureListeners();
    const cached = cachedTicket(id);
    if (cached) {
      activeTicket.value = cached;
    }
  };

  const backToTicketList = () => {
    popupTicketId.value = null;
    clearActive();
  };

  const minimizeTicketPopup = () => {
    if (!popupActive.value) {
      return;
    }
    popupMinimized.value = true;
  };

  const expandTicketPopup = () => {
    if (!popupActive.value) {
      return;
    }
    popupMinimized.value = false;
  };

  const closeTicketPopup = () => {
    popupActive.value = false;
    popupMinimized.value = false;
    popupTicketId.value = null;
    clearActive();
  };

  /** The chat on screen, if any (popup or help page). */
  const viewingId = () =>
    popupOpen.value && popupTicketId.value
      ? popupTicketId.value
      : activeTicket.value?.id ?? null;

  // Re-read the ticket on screen from the server: a push may be a summary
  // without the new message, and reading it marks it seen for the staff.
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const reloadViewed = (id: string) => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (viewingId() === id) {
        void openTicket(id).catch(() => undefined);
      }
    }, 150);
  };

  const onTicketUpdated = (payload: unknown) => {
    const ticket = normalizeTicket(payload);
    if (!ticket) {
      return;
    }
    // Viewing this ticket: keep messages, do not bump unread badge.
    if (viewingId() === ticket.id) {
      clearLocalUnread(ticket);
      upsertTicket(ticket);
      refreshUnreadFromList();
      reloadViewed(ticket.id);
      return;
    }
    upsertTicket(ticket);
    refreshUnreadFromList();
  };

  /** "ticket-receipts": the other side received or read messages. */
  const onTicketReceipts = (payload: unknown) => {
    const unwrapped =
      payload && typeof payload === "object" && "data" in payload
        ? (payload as { data: unknown }).data
        : payload;
    const raw = (Array.isArray(unwrapped) ? unwrapped[0] : unwrapped) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return;
    }
    const ticketId = pickString(raw, "ticket_id", "ticketId", "TicketId");
    if (!ticketId) {
      return;
    }
    const receipts = new Map<string, { seen: string; received: string }>();
    for (const item of (raw.receipts as Record<string, unknown>[] | undefined) ?? []) {
      const id = pickString(item, "id", "Id");
      if (id) {
        receipts.set(id, {
          seen: pickString(item, "seen_at", "seenAt", "SeenAt"),
          received: pickString(item, "received_at", "receivedAt", "ReceivedAt"),
        });
      }
    }
    const apply = (ticket: Ticket): Ticket => {
      const messages = (ticket.messages ?? []).map((message) => {
        const r = message?.id ? receipts.get(message.id) : undefined;
        if (!r) return message;
        return {
          ...message,
          seen_at: r.seen || message.seen_at,
          received_at: r.received || message.received_at,
        };
      });
      const next = { ...ticket, messages } as Ticket;
      if (viewingId() !== ticketId) {
        next.unread = pickBool(raw, "unread", "Unread");
        (next as Ticket & { unread_messages?: number }).unread_messages = pickNumber(
          raw,
          "unread_messages",
          "unreadMessages",
          "UnreadMessages",
        );
      }
      return next;
    };
    const known = ticketById.value[ticketId] ?? tickets.value.find((t) => t.id === ticketId);
    if (!known) {
      return;
    }
    upsertTicket(apply(known));
    refreshUnreadFromList();
  };

  // Without live pushes (HTTP sync, or the link down) Go asks the server for
  // ticket changes, faster the closer the user is to the conversation; it
  // also catches up after a reconnect. It learns where the user is here.
  const helpCenterView = () =>
    popupOpen.value ? (popupTicketId.value ? "chat" : "list") : "closed";
  const tellHelpCenterView = () => {
    void SetHelpCenterView(helpCenterView()).catch(() => undefined);
  };

  const ensureListeners = () => {
    if (listening) {
      return;
    }
    listening = true;
    Events.On("ticket-updated", ({ data }) => onTicketUpdated(data));
    Events.On("ticket-receipts", ({ data }) => onTicketReceipts(data));
    watch([popupOpen, popupTicketId], tellHelpCenterView, { immediate: true });
  };

  const navBadgeCount = computed(() => {
    if (unreadMessagesTotal.value > 0) {
      return unreadMessagesTotal.value;
    }
    return unreadCount.value;
  });

  return {
    tickets,
    ticketById,
    unreadCount,
    unreadMessagesTotal,
    navBadgeCount,
    loading,
    refreshing,
    loaded,
    activeTicket,
    activeLoading,
    hasOlder,
    loadingOlder,
    loadOlder,
    popupTicketId,
    popupMinimized,
    popupActive,
    popupOpen,
    popupVisible,
    popupShowingChat,
    cachedTicket,
    fetchTickets,
    createTicket,
    openTicket,
    replyTicket,
    clearActive,
    openTicketsPopup,
    openTicketPopup,
    backToTicketList,
    minimizeTicketPopup,
    expandTicketPopup,
    closeTicketPopup,
    upsertTicket,
    ensureListeners,
    onTicketUpdated,
    onTicketReceipts,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTicketsStore, import.meta.hot));
}
