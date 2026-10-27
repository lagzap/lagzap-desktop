import { computed } from "vue";
import type { Ticket } from "~/bindings/github.com/lagzap/zap/data";
import {
  MAX_FAVORITE_TICKETS,
  useSettings,
} from "~/composables/useSettings";
import { displayAlert } from "~/composables/alert";
import { useLocale } from "vuetify";

function typeIcon(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "bug":
      return "mdi-bug";
    case "feedback":
      return "mdi-message-text-outline";
    case "request":
      return "mdi-lightbulb-outline";
    default:
      return "mdi-lifebuoy";
  }
}

export function useTicketQuickAccess() {
  const { t } = useLocale();
  const tickets = useTicketsStore();
  const {
    settings,
    setFavoriteTicketIds,
    touchRecentTicket,
  } = useSettings();

  const favoriteTicketIds = computed(
    () => settings.value.favoriteTicketIds ?? [],
  );
  const favoriteIdSet = computed(() => new Set(favoriteTicketIds.value));
  const recentEntries = computed(() => settings.value.recentTickets ?? []);

  const resolveTicket = (id: string): Ticket | null => {
    return (
      tickets.ticketById[id] ||
      tickets.tickets.find((ticket) => ticket.id === id) ||
      null
    );
  };

  const favoriteTickets = computed((): Ticket[] => {
    return favoriteTicketIds.value
      .map((id) => resolveTicket(id))
      .filter((ticket): ticket is Ticket => !!ticket);
  });

  const recentTicketsExcludingFavorites = computed((): Ticket[] => {
    const pinned = favoriteIdSet.value;
    return recentEntries.value
      .filter((entry) => !pinned.has(entry.id))
      .map((entry) => resolveTicket(entry.id))
      .filter((ticket): ticket is Ticket => !!ticket);
  });

  const isFavorite = (ticketId: string) => favoriteIdSet.value.has(ticketId);

  const canPinMore = computed(
    () => favoriteTicketIds.value.length < MAX_FAVORITE_TICKETS,
  );

  const pinTicket = async (ticketId: string) => {
    if (!ticketId || favoriteIdSet.value.has(ticketId)) {
      return false;
    }
    if (!canPinMore.value) {
      displayAlert(t("$vuetify.tickets.favoriteLimit"), "warning");
      return false;
    }
    await setFavoriteTicketIds([...favoriteTicketIds.value, ticketId]);
    return true;
  };

  const unpinTicket = async (ticketId: string) => {
    if (!favoriteIdSet.value.has(ticketId)) {
      return false;
    }
    await setFavoriteTicketIds(
      favoriteTicketIds.value.filter((id) => id !== ticketId),
    );
    return true;
  };

  const toggleFavorite = async (ticketId: string) => {
    if (isFavorite(ticketId)) {
      return unpinTicket(ticketId);
    }
    return pinTicket(ticketId);
  };

  const visitTicket = async (ticketId: string) => {
    if (!ticketId) {
      return;
    }
    await touchRecentTicket(ticketId);
  };

  const ticketIcon = (ticket: Ticket) => typeIcon(ticket.type);

  const ticketUnread = (ticket: Ticket) => {
    const n = Number(
      (ticket as Ticket & { unread_messages?: number }).unread_messages ?? 0,
    );
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
    return ticket.unread ? 1 : 0;
  };

  return {
    MAX_FAVORITE_TICKETS,
    favoriteTicketIds,
    favoriteTickets,
    recentTicketsExcludingFavorites,
    canPinMore,
    isFavorite,
    pinTicket,
    unpinTicket,
    toggleFavorite,
    visitTicket,
    ticketIcon,
    ticketUnread,
  };
}
