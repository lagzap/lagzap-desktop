import { defineStore, acceptHMRUpdate } from "pinia";
import { Events } from "@wailsio/runtime";
import {
  CreateTicket,
  GetTicket,
  ListMyTickets,
  ReplyTicket,
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
    const next =
      prev &&
      !(ticket.messages?.length) &&
      (prev.messages?.length ?? 0) > 0
        ? ({ ...ticket, messages: prev.messages } as Ticket)
        : ticket;
    ticketById.value = { ...ticketById.value, [ticket.id]: cloneTicket(next) };
    if (mergeList) {
      const idx = tickets.value.findIndex((t) => t.id === ticket.id);
      if (idx >= 0) {
        const listPrev = tickets.value[idx];
        const listNext =
          !(ticket.messages?.length) && (listPrev.messages?.length ?? 0) > 0
            ? ({ ...ticket, messages: listPrev.messages } as Ticket)
            : ticket;
        tickets.value.splice(idx, 1, listNext);
      } else {
        tickets.value.unshift(ticket);
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

      // Preserve richer cached detail (messages) when list rows are summaries.
      tickets.value = list.map((ticket) => {
        const cached = ticketById.value[ticket.id];
        if (cached && (cached.messages?.length ?? 0) > 0) {
          const merged = {
            ...ticket,
            messages: cached.messages,
          } as Ticket;
          ticketById.value[ticket.id] = cloneTicket(merged);
          return merged;
        }
        rememberTicket(ticket, { mergeList: false });
        return ticket;
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
      const ticket = normalizeTicket(await GetTicket(id));
      if (seq !== openRequestSeq) {
        return ticket;
      }
      if (ticket) {
        // GET_TICKET marks seen server-side; clear local badge immediately.
        clearLocalUnread(ticket);
        rememberTicket(ticket);
        refreshUnreadFromList();
        activeTicket.value = cloneTicket(ticket);
      }
      return ticket;
    } finally {
      if (seq === openRequestSeq) {
        activeLoading.value = false;
      }
    }
  };

  const replyTicket = async (id: string, body: string) => {
    const ticket = normalizeTicket(await ReplyTicket(id, body));
    if (!ticket) {
      throw new Error("ticket_reply_failed");
    }
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

  const onTicketUpdated = (payload: unknown) => {
    const ticket = normalizeTicket(payload);
    if (!ticket) {
      return;
    }
    // Viewing this ticket: keep messages, do not bump unread badge.
    if (activeTicket.value?.id === ticket.id) {
      clearLocalUnread(ticket);
      upsertTicket(ticket);
      refreshUnreadFromList();
      return;
    }
    upsertTicket(ticket);
    refreshUnreadFromList();
  };

  const ensureListeners = () => {
    if (listening) {
      return;
    }
    listening = true;
    Events.On("ticket-updated", ({ data }) => onTicketUpdated(data));
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
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTicketsStore, import.meta.hot));
}
