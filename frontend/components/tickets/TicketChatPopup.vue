<script setup lang="ts">
import { useLocale } from "vuetify";
import { Call } from "@wailsio/runtime";
import type { Ticket } from "~/bindings/github.com/lagzap/zap/data";
import {
  MESSAGE_MAX,
  MESSAGE_TOTAL_MAX,
  splitMessage,
  startsRtl,
} from "~/utils/splitMessage";
import TicketFavoriteButton from "~/components/tickets/TicketFavoriteButton.vue";
import { displayAlert, displayError } from "~/composables/alert";
import { useTicketQuickAccess } from "~/composables/useTicketQuickAccess";
import {
  formatTicketClockTime,
  formatTicketDayLabel,
  parseTicketTimestamp,
  ticketDayKey,
  ticketDayLabelKind,
} from "~/utils/ticketTime";

const locale = useLocale();
const { t } = locale;
// My gamer tag, for the avatar on my own messages (never the email or phone).
const { user: authUser } = useSanctumAuth<DataResponse>();
const myName = computed(() => authUser.value?.user?.name?.trim() || "");
const tickets = useTicketsStore();
const store = useStore();
const { visitTicket, isFavorite } = useTicketQuickAccess();

const replyBody = ref("");
const loadError = ref(false);
const threadEl = ref<HTMLElement | null>(null);
const replyInput = ref<{ focus?: () => void } | null>(null);
/** Follow new messages unless the user scrolls up. */
const stickToBottom = ref(true);
const BOTTOM_THRESHOLD_PX = 96;
/** Message ids whose seen receipt should stay visible briefly after flipping. */

const createOpen = ref(false);
const createType = ref("support");
const createSubject = ref("");
const createBody = ref("");
const creating = ref(false);
const createForm = ref();

const TERMINAL = new Set([
  "accepted",
  "denied",
  "resolved",
  "duplicate",
  "closed",
]);

const AVATAR_COLORS = [
  "#5865f2",
  "#57f287",
  "#fee75c",
  "#eb459e",
  "#ed4245",
  "#3ba55d",
  "#faa61a",
  "#00aff4",
];

/** The message a reply quotes (its first 200 characters), or a deleted one. */
type ThreadQuote = {
  id: string;
  name: string;
  body: string;
  deleted: boolean;
};

type ThreadMessage = {
  id: string;
  displayName: string;
  body: string;
  createdAt?: string;
  isStaff: boolean;
  seen: boolean;
  replyTo: ThreadQuote | null;
  reactions: ThreadReaction[];
  /** Only on a reply typed here that the server has not stored yet. */
  state?: "sending" | "failed";
};

/** One emoji on a message: how many, whether I did, and the first 3 who did. */
type ThreadReaction = {
  emoji: string;
  count: number;
  mine: boolean;
  users: { name: string; me: boolean }[];
};

/** A reply shown at once while it is sent in the background. */
type PendingReply = {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;
  replyTo: ThreadQuote | null;
  /** Names this send, so a retry gets the stored copy instead of a second. */
  clientId: string;
  state: "sending" | "failed";
};

type ThreadItem = {
  id: string;
  message: ThreadMessage;
  showSender: boolean;
  clustered: boolean;
};

/** One sender's consecutive messages, sharing one avatar (Telegram style). */
type ThreadRun = {
  id: string;
  staff: boolean;
  name: string;
  items: ThreadItem[];
};

/** One day of the thread under its date pill (Telegram style). */
type ThreadDay = { id: string; label: string; runs: ThreadRun[] };

const ticketId = computed(() => tickets.popupTicketId || "");
const showingChat = computed(() => tickets.popupShowingChat);

const headerTitle = computed(() => {
  if (!showingChat.value) {
    return t("$vuetify.tickets.helpCenter");
  }
  return (
    tickets.activeTicket?.subject ||
    tickets.cachedTicket(ticketId.value)?.subject ||
    t("$vuetify.tickets.helpCenter")
  );
});


const canReply = computed(() => {
  const status = tickets.activeTicket?.status?.toLowerCase() || "";
  return !!tickets.activeTicket && !TERMINAL.has(status);
});

const offsetForOptimize = computed(
  () => store.optimizing && !store.optimizeMinimized,
);

/* ----- Resizing: drag the top edge, the free side or their corner. The
 * popup stays at least MIN and at most the window minus a small margin and
 * the top bar; a smaller window shrinks it to fit. The size is remembered. */
const POPUP_MIN = { w: 320, h: 400 };
const POPUP_DEFAULT = { w: 380, h: 560 };
const POPUP_MARGIN = 12;
const POPUP_EDGE = 24; // the fixed gap to the window's side and bottom
const TOP_BAR = 48; // the compact app bar
const SIZE_KEY = "lz-ticket-popup-size";

const viewport = reactive({ w: window.innerWidth, h: window.innerHeight });
/* The popup sits at the bottom left beside the drawer (bottom right in RTL),
 * near the drawer's Help Center item it opens from. On a narrow window the
 * drawer overlays the page, so the popup takes the window's edge. */
const DRAWER_GAP = 16;
const drawerEdge = ref(0);
function measureDrawer() {
  const drawer = document.querySelector<HTMLElement>(".v-navigation-drawer");
  if (
    !drawer ||
    drawer.classList.contains("v-navigation-drawer--temporary") ||
    !drawer.classList.contains("v-navigation-drawer--active")
  ) {
    drawerEdge.value = 0;
    return;
  }
  const box = drawer.getBoundingClientRect();
  drawerEdge.value = Math.max(
    0,
    locale.isRtl.value ? window.innerWidth - box.left : box.right,
  );
}
function onWindowResize() {
  viewport.w = window.innerWidth;
  viewport.h = window.innerHeight;
  measureDrawer();
}
const popupStart = computed(() =>
  drawerEdge.value ? drawerEdge.value + DRAWER_GAP : POPUP_EDGE,
);

function readSize() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || "null");
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
      return { w: saved.w as number, h: saved.h as number };
    }
  } catch {
    // no saved size
  }
  return { ...POPUP_DEFAULT };
}
const popupSize = reactive(readSize());

const popupBottom = computed(() => (offsetForOptimize.value ? 120 : POPUP_EDGE));
const popupMax = computed(() => ({
  w: Math.max(POPUP_MIN.w, viewport.w - popupStart.value - POPUP_MARGIN),
  h: Math.max(
    POPUP_MIN.h,
    viewport.h - popupBottom.value - TOP_BAR - POPUP_MARGIN,
  ),
}));
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const popupStyle = computed(() => ({
  [locale.isRtl.value ? "right" : "left"]: `${popupStart.value}px`,
  width: `${clamp(popupSize.w, POPUP_MIN.w, popupMax.value.w)}px`,
  height: `${clamp(popupSize.h, POPUP_MIN.h, popupMax.value.h)}px`,
}));

let resizing: {
  edge: "top" | "side" | "corner";
  x: number;
  y: number;
  w: number;
  h: number;
} | null = null;

function startResize(event: PointerEvent, edge: "top" | "side" | "corner") {
  event.preventDefault();
  const box = (event.currentTarget as HTMLElement)
    .closest(".ticket-popup")
    ?.getBoundingClientRect();
  if (!box) {
    return;
  }
  resizing = { edge, x: event.clientX, y: event.clientY, w: box.width, h: box.height };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  document.body.classList.add("ticket-popup-resizing");
}

function onResizeMove(event: PointerEvent) {
  if (!resizing) {
    return;
  }
  // The popup is anchored at the bottom and its start side, so it grows
  // toward the pointer on the free (end) side and upward from the top edge.
  const dx = (event.clientX - resizing.x) * (locale.isRtl.value ? -1 : 1);
  const dy = resizing.y - event.clientY;
  if (resizing.edge !== "top") {
    popupSize.w = clamp(resizing.w + dx, POPUP_MIN.w, popupMax.value.w);
  }
  if (resizing.edge !== "side") {
    popupSize.h = clamp(resizing.h + dy, POPUP_MIN.h, popupMax.value.h);
  }
}

function endResize() {
  if (!resizing) {
    return;
  }
  resizing = null;
  document.body.classList.remove("ticket-popup-resizing");
  try {
    localStorage.setItem(
      SIZE_KEY,
      JSON.stringify({ w: Math.round(popupSize.w), h: Math.round(popupSize.h) }),
    );
  } catch {
    // the size lasts for this session only
  }
}

onMounted(() => {
  window.addEventListener("resize", onWindowResize);
  measureDrawer();
});
// The drawer can change while the popup is shut (window size, language).
watch(
  () => tickets.popupOpen,
  (open) => open && measureDrawer(),
);
onUnmounted(() => window.removeEventListener("resize", onWindowResize));

const typeItems = computed(() => [
  { title: t("$vuetify.tickets.typeSupport"), value: "support" },
  { title: t("$vuetify.tickets.typeRequest"), value: "request" },
  { title: t("$vuetify.tickets.typeBug"), value: "bug" },
  { title: t("$vuetify.tickets.typeFeedback"), value: "feedback" },
]);

/** The filtered list, pinned tickets first, then the latest activity. */
const sortedTickets = computed(() => {
  const shown = tickets.tickets.filter(
    (ticket) =>
      listFilter.value === "all" ||
      (listFilter.value === "closed") === isClosedStatus(ticket.status),
  );
  return shown.sort((a, b) => {
    const aFav = isFavorite(a.id) ? 1 : 0;
    const bFav = isFavorite(b.id) ? 1 : 0;
    if (aFav !== bFav) {
      return bFav - aFav;
    }
    const aAt = a.updated_at || a.created_at || "";
    const bAt = b.updated_at || b.created_at || "";
    return bAt.localeCompare(aAt);
  });
});

/** Replies typed here and not stored yet, oldest first. */
const pending = ref<PendingReply[]>([]);
let pendingSeq = 0;
let sendQueue: Promise<void> = Promise.resolve();

const threadMessages = computed((): ThreadMessage[] => {
  const ticket = tickets.activeTicket;
  if (!ticket) {
    return [];
  }
  const items: ThreadMessage[] = [];
  const messages = (ticket.messages || []).filter(Boolean);
  if (ticket.body?.trim() && !messages.length) {
    items.push({
      id: `${ticket.id}-opener`,
      displayName: t("$vuetify.tickets.you"),
      body: ticket.body.trim(),
      createdAt: ticket.created_at,
      isStaff: false,
      seen: false,
      replyTo: null,
      reactions: [],
    });
  }
  for (const message of messages) {
    const displayName =
      message.display_name ||
      (message.is_staff
        ? t("$vuetify.tickets.staff")
        : t("$vuetify.tickets.you"));
    items.push({
      id: message.id || `${ticket.id}-${items.length}`,
      displayName,
      body: message.body || "",
      createdAt: message.created_at,
      isStaff: !!message.is_staff,
      seen: !message.is_staff && messageSeen(message),
      replyTo: quoteOf(message),
      reactions: reactionsOf(message),
    });
  }
  for (const reply of pending.value) {
    if (reply.ticketId !== ticket.id) {
      continue;
    }
    items.push({
      id: reply.id,
      displayName: t("$vuetify.tickets.you"),
      body: reply.body,
      createdAt: reply.createdAt,
      isStaff: false,
      seen: false,
      replyTo: reply.replyTo,
      reactions: [],
      state: reply.state,
    });
  }
  return items;
});

/** More than a minute after the message before it in the run: it gets the
 * wider gap that separates two senders, as on the website. */
const PAUSE_MS = 60_000;
function afterPause(items: { message: { createdAt?: string | null } }[], i: number) {
  if (i === 0) {
    return false;
  }
  const prev = parseTicketTimestamp(items[i - 1].message.createdAt)?.getTime();
  const cur = parseTicketTimestamp(items[i].message.createdAt)?.getTime();
  return prev !== undefined && cur !== undefined && cur - prev > PAUSE_MS;
}

const threadDays = computed((): ThreadDay[] => {
  const days: ThreadDay[] = [];
  let lastDay: string | null = null;
  let lastStaff: boolean | null = null;
  let lastName = "";

  for (const message of threadMessages.value) {
    const day = ticketDayKey(message.createdAt) || "unknown";
    if (day !== lastDay) {
      days.push({
        id: `day-${day}`,
        label: formatDaySeparator(message.createdAt),
        runs: [],
      });
      lastDay = day;
      lastStaff = null;
      lastName = "";
    }

    const showSender =
      message.isStaff &&
      (lastStaff !== true || lastName !== message.displayName);
    const clustered =
      lastStaff === message.isStaff &&
      (!message.isStaff || lastName === message.displayName);

    const runs = days[days.length - 1].runs;
    const run = runs[runs.length - 1];
    const sameSender =
      run &&
      run.staff === message.isStaff &&
      (!message.isStaff || run.name === message.displayName);
    if (!sameSender) {
      runs.push({
        id: `run-${message.id}`,
        staff: message.isStaff,
        name: message.isStaff ? message.displayName : myName.value,
        items: [],
      });
    }
    runs[runs.length - 1].items.push({
      id: message.id,
      message,
      showSender,
      clustered,
    });

    lastStaff = message.isStaff;
    lastName = message.displayName;
  }

  return days;
});

watch(
  () => tickets.popupOpen,
  async (open) => {
    if (!open) {
      return;
    }
    tickets.ensureListeners();
    try {
      await tickets.fetchTickets({ silent: tickets.loaded });
    } catch (error) {
      displayError(error, locale);
    }
  },
);

/* A press anywhere outside the open popup minimizes it. Its own menus and
 * dialogs (emoji grid, right-click menu, new ticket) render outside the card,
 * so presses inside any overlay don't count, nor does the button that opens it. */
const popupCard = ref<{ $el: HTMLElement } | null>(null);
function onPressOutside(event: PointerEvent) {
  if (!tickets.popupOpen) {
    return;
  }
  const target = event.target as Element | null;
  if (
    !target ||
    popupCard.value?.$el.contains(target) ||
    target.closest(".v-overlay, .nav-help")
  ) {
    return;
  }
  tickets.minimizeTicketPopup();
}
onMounted(() => {
  document.addEventListener("pointerdown", onPressOutside, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onPressOutside, true);
});

onMounted(() => {
  tickets.ensureListeners();
  if (!tickets.loaded) {
    void tickets.fetchTickets({ silent: true }).catch(() => undefined);
  }
});

watch(
  ticketId,
  async (id, prev) => {
    if (!id) {
      replyBody.value = "";
      loadError.value = false;
      return;
    }
    if (id === prev) {
      return;
    }
    stickToBottom.value = true;
    replyBody.value = "";
    loadError.value = false;
    const cached = tickets.cachedTicket(id);
    if (cached) {
      tickets.activeTicket = cached;
      await nextTick();
      scrollThreadToBottom(true);
    } else {
      tickets.activeTicket = null;
    }
    void visitTicket(id);
    await loadTicket();
  },
);

/* ----- Jump button (Telegram style): down to the first unseen message,
 * then to the end. Unseen = staff messages that arrived out of view. ----- */
const unseen = ref<string[]>([]);
const knownIds = new Set<string>();
/** Messages that just arrived or were just sent pop in (Telegram style). Not on
 * opening, not for older pages, and not when a sent reply is only swapped for
 * its stored copy (the thread doesn't grow then). */
const entering = ref(new Set<string>());
let lastCount = 0;
watch(ticketId, () => {
  knownIds.clear();
  unseen.value = [];
  lastCount = 0;
});

watch(
  () =>
    threadMessages.value
      .map((m) => `${m.id}:${m.body.length}`)
      .join("|"),
  async () => {
    const all = threadMessages.value;
    const fresh = all.filter((m) => !knownIds.has(m.id));
    const opening = knownIds.size === 0;
    for (const m of all) {
      knownIds.add(m.id);
    }
    const grew = all.length - lastCount;
    lastCount = all.length;
    const newest = all[all.length - 1];
    if (!opening && grew > 0 && newest && fresh.includes(newest)) {
      const ids = fresh.slice(-grew).map((m) => m.id);
      entering.value = new Set([...entering.value, ...ids]);
      setTimeout(() => {
        const next = new Set(entering.value);
        for (const id of ids) {
          next.delete(id);
        }
        entering.value = next;
      }, 400);
    }
    await nextTick();
    if (opening || stickToBottom.value) {
      scrollThreadToBottom();
      return;
    }
    // Older pages arrive above and don't count; only new staff messages below do.
    const last = all[all.length - 1];
    if (!last || !fresh.includes(last)) {
      return;
    }
    const added = fresh.filter((m) => m.isStaff).map((m) => m.id);
    unseen.value = [...unseen.value, ...added];
  },
);

function messageEl(id: string) {
  return (
    threadEl.value?.querySelector<HTMLElement>(
      `[data-mid="${CSS.escape(id)}"]`,
    ) ?? null
  );
}

/** A message counts as seen once all of it has been on screen. */
function markSeen(el: HTMLElement) {
  if (!unseen.value.length) {
    return;
  }
  if (stickToBottom.value) {
    unseen.value = [];
    return;
  }
  const view = el.getBoundingClientRect();
  unseen.value = unseen.value.filter((id) => {
    const r = messageEl(id)?.getBoundingClientRect();
    return !r || r.bottom > view.bottom || r.top < view.top;
  });
}

function jumpTo(id: string) {
  const el = threadEl.value;
  const target = messageEl(id);
  if (!el || !target) {
    return;
  }
  const offset =
    target.getBoundingClientRect().top - el.getBoundingClientRect().top;
  el.scrollTo({ top: el.scrollTop + offset - 48, behavior: "smooth" });
}

function jumpDown() {
  const first = unseen.value[0];
  if (first) {
    jumpTo(first);
    return;
  }
  const el = threadEl.value;
  el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

onUnmounted(() => {
  clearTimeout(threadScrollIdle);
  clearTimeout(flashTimer);
});

function unreadMessages(ticket: Ticket) {
  const n = Number(
    (ticket as Ticket & { unread_messages?: number; unreadMessages?: number })
      .unread_messages ??
      (ticket as Ticket & { unreadMessages?: number }).unreadMessages ??
      0,
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isUnread(ticket: Ticket) {
  const v = ticket.unread as unknown;
  if (v === true || v === 1 || v === "1" || v === "true") {
    return true;
  }
  return unreadMessages(ticket) > 0;
}

/** The open ticket's status, worded and coloured as on the website: resolved
 * green, other closed statuses neutral, the rest gold. */
const activeStatus = computed(() => tickets.activeTicket?.status?.toLowerCase() || "");
const statusLabel = computed(() => {
  const key = `$vuetify.tickets.status.${activeStatus.value}`;
  const text = t(key);
  return text === key ? tickets.activeTicket?.status || "" : text;
});
const statusColor = computed(() =>
  activeStatus.value === "resolved"
    ? "success"
    : TERMINAL.has(activeStatus.value)
      ? undefined
      : "primary",
);

function typeLabel(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "bug":
      return t("$vuetify.tickets.typeBug");
    case "feedback":
      return t("$vuetify.tickets.typeFeedback");
    case "request":
      return t("$vuetify.tickets.typeRequest");
    case "support":
      return t("$vuetify.tickets.typeSupport");
    default:
      return type || t("$vuetify.tickets.typeSupport");
  }
}

/** "this minute", "12 minutes ago", as on the website. */
function formatWhen(value?: string) {
  const at = parseTicketTimestamp(value)?.getTime();
  if (at === undefined) {
    return "";
  }
  const seconds = (at - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale.isRtl.value ? "fa-IR" : "en-US", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(0, "minute");
}
/** Relative times move on by themselves. */
const clock = ref(Date.now());
const clockTimer = setInterval(() => (clock.value = Date.now()), 30_000);
onUnmounted(() => clearInterval(clockTimer));

/* ----- Filter and status, as on the website ----- */
const listFilter = ref<"all" | "open" | "closed">("all");
const isClosedStatus = (status?: string) => TERMINAL.has((status || "").toLowerCase());
function statusText(status?: string) {
  const key = `$vuetify.tickets.status.${(status || "").toLowerCase()}`;
  const text = t(key);
  return text === key ? status || "" : text;
}
const statusColorOf = (status?: string) =>
  (status || "").toLowerCase() === "resolved"
    ? "success"
    : isClosedStatus(status)
      ? undefined
      : "primary";
function listIcon(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "bug":
      return "mdi-bug-outline";
    case "feedback":
      return "mdi-message-star-outline";
    case "request":
      return "mdi-lightbulb-outline";
    default:
      return "mdi-lifebuoy";
  }
}

function lastMessage(ticket: Ticket) {
  const messages = (ticket.messages ?? []).filter(Boolean);
  if (messages.length) {
    return messages[messages.length - 1];
  }
  return null;
}

/** The last thing said in a ticket, as on the website. */
function previewText(ticket: Ticket) {
  return (lastMessage(ticket)?.body || ticket.body || "").replace(/\s+/g, " ").trim();
}

function openTicket(ticket: Ticket) {
  if (!ticket?.id) {
    return;
  }
  void visitTicket(ticket.id);
  tickets.openTicketPopup(ticket.id);
}

function goBackToList() {
  tickets.backToTicketList();
}

function openCreate() {
  createType.value = "support";
  createSubject.value = "";
  createBody.value = "";
  createOpen.value = true;
  tickets.minimizeTicketPopup();
}

async function submitCreate() {
  const { valid } = await createForm.value.validate();
  if (!valid || creating.value) {
    return;
  }
  creating.value = true;
  try {
    const ticket = await tickets.createTicket(
      createType.value,
      createSubject.value.trim(),
      createBody.value.trim(),
      null,
      null,
    );
    displayAlert(t("$vuetify.tickets.created"), "success");
    createOpen.value = false;
    if (ticket?.id) {
      void visitTicket(ticket.id);
      tickets.openTicketPopup(ticket.id);
    }
  } catch (error) {
    displayError(error, locale);
  } finally {
    creating.value = false;
  }
}

async function loadTicket() {
  if (!ticketId.value) {
    return;
  }
  loadError.value = false;
  stickToBottom.value = true;
  // Opening marks the ticket read, so take the unread count first.
  const row = sortedTickets.value.find((tk) => tk.id === ticketId.value);
  const unreadBefore = row ? unreadMessages(row) : 0;
  try {
    await tickets.openTicket(ticketId.value);
    await nextTick();
    const staff = threadMessages.value.filter((m) => m.isStaff);
    const n = Math.min(unreadBefore, staff.length);
    if (n > 0) {
      // Like Telegram: open at the first unread message, the rest wait below.
      unseen.value = staff.slice(-n).map((m) => m.id);
      stickToBottom.value = false;
      jumpTo(unseen.value[0]);
    } else {
      scrollThreadToBottom(true);
    }
    void maybeLoadOlder();
  } catch (error) {
    if (!tickets.activeTicket || tickets.activeTicket.id !== ticketId.value) {
      loadError.value = true;
    }
    displayError(error, locale);
  }
}

/** While scrolling, the date pill stuck at the top shows; a second after it
 * stops, a stuck pill fades away (as in Telegram). */
const threadScrolling = ref(false);
let threadScrollIdle: ReturnType<typeof setTimeout> | undefined;

/** A pill is stuck when its day began above the top of the thread. */
function markStuckDays(el: HTMLElement) {
  const top = el.getBoundingClientRect().top;
  for (const group of el.querySelectorAll<HTMLElement>(".ticket-day-group")) {
    group.classList.toggle(
      "ticket-day-group--stuck",
      group.getBoundingClientRect().top < top,
    );
  }
}

function onThreadScroll() {
  const el = threadEl.value;
  if (!el) {
    return;
  }
  markStuckDays(el);
  markSeen(el);
  threadScrolling.value = true;
  clearTimeout(threadScrollIdle);
  threadScrollIdle = setTimeout(() => {
    threadScrolling.value = false;
  }, 1000);
  const distanceFromBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  void maybeLoadOlder();
}

// A chat loads its newest page; older ones come in as the user scrolls up
// to them (or while the page does not fill the thread), keeping the view
// where it was.
const TOP_THRESHOLD_PX = 120;
async function maybeLoadOlder() {
  const el = threadEl.value;
  const id = ticketId.value;
  if (!el || !id || tickets.loadingOlder || !tickets.hasOlder[id] || el.scrollTop > TOP_THRESHOLD_PX) {
    return;
  }
  const fromBottom = el.scrollHeight - el.scrollTop;
  try {
    const loaded = await tickets.loadOlder(id);
    if (!loaded || ticketId.value !== id) {
      return;
    }
    await nextTick();
    el.scrollTop = el.scrollHeight - fromBottom;
    void maybeLoadOlder();
  } catch (error) {
    displayError(error, locale);
  }
}

function scrollThreadToBottom(force = false) {
  if (!force && !stickToBottom.value) {
    return;
  }
  const el = threadEl.value;
  if (!el) {
    return;
  }
  el.scrollTop = el.scrollHeight;
}

/* When the thread grows without new messages (a reaction or quote adds a
 * line to a bubble), a reader at the bottom stays at the bottom. */
let threadGrowth: ResizeObserver | null = null;
watch(threadEl, (el) => {
  threadGrowth?.disconnect();
  threadGrowth = null;
  const inner = el?.querySelector(".ticket-popup__thread-inner");
  if (!inner) {
    return;
  }
  threadGrowth = new ResizeObserver(() => scrollThreadToBottom());
  threadGrowth.observe(inner);
});
onUnmounted(() => threadGrowth?.disconnect());

function formatDaySeparator(value?: string) {
  const kind = ticketDayLabelKind(value);
  if (kind === "today") {
    return t("$vuetify.tickets.today");
  }
  if (kind === "yesterday") {
    return t("$vuetify.tickets.yesterday");
  }
  return formatTicketDayLabel(value) || t("$vuetify.tickets.today");
}

function formatClock(value?: string) {
  return formatTicketClockTime(value);
}

function messageSeen(message?: {
  seen_at?: string | null;
  seenAt?: string | null;
} | null) {
  if (!message) {
    return false;
  }
  const seen =
    message.seen_at ||
    (message as { seenAt?: string | null }).seenAt ||
    "";
  return !!seen;
}

function initialOf(name: string) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed.charAt(0).toLocaleUpperCase();
}

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/* ----- Replying to a message: hover button, drag to the right, or right-click ----- */
const replyTarget = ref<ThreadMessage | null>(null);
watch(ticketId, () => {
  replyTarget.value = null;
});
// A message staff deleted can't be replied to or counted as unseen any more.
watch(threadMessages, (list) => {
  const ids = new Set(list.map((m) => m.id));
  if (replyTarget.value && !ids.has(replyTarget.value.id)) {
    replyTarget.value = null;
  }
  if (unseen.value.some((id) => !ids.has(id))) {
    unseen.value = unseen.value.filter((id) => ids.has(id));
  }
});

/** The quote a stored message carries (reply_to from the server). */
function quoteOf(message: unknown): ThreadQuote | null {
  const q = (message as { reply_to?: Record<string, unknown> | null })
    .reply_to;
  if (!q || typeof q.id !== "string") {
    return null;
  }
  const name =
    (q.is_staff
      ? (q.display_name as string) || t("$vuetify.tickets.staff")
      : t("$vuetify.tickets.you")) || "";
  return {
    id: q.id,
    name,
    body: typeof q.body === "string" ? q.body : "",
    deleted: !!q.deleted,
  };
}

/** The reactions a stored message carries, in the server's order. */
function reactionsOf(message: unknown): ThreadReaction[] {
  const list = (message as { reactions?: Record<string, unknown>[] | null }).reactions;
  return (list ?? [])
    .filter((r) => r && typeof r.emoji === "string" && Number(r.count) > 0)
    .map((r) => ({
      emoji: r.emoji as string,
      count: Number(r.count),
      mine: !!r.mine,
      users: ((r.users as Record<string, unknown>[] | null) ?? []).map((u) => ({
        name: typeof u?.name === "string" ? u.name : "",
        me: !!u?.me,
      })),
    }));
}

/* ----- Reactions, Telegram style: a heart beside the bubble on hover reacts
 * with it; hovering the heart opens a column of every reaction, which
 * scrolls. Right-click has the same in a row; double-click hearts. */
const REACTIONS = ["👍", "❤️", "🔥", "🎉", "😂", "😮", "😢", "🙏", "👎", "👏", "💯", "🤝"];
const DEFAULT_REACTION = "❤️";
/** The default nearest the heart, then the rest. */
const stripReactions = [DEFAULT_REACTION, ...REACTIONS.filter((e) => e !== DEFAULT_REACTION)];
const canReact = (message: ThreadMessage) =>
  canReply.value && !message.state && !message.id.endsWith("-opener");
const mineHas = (message: ThreadMessage | null, emoji: string) =>
  !!message?.reactions.some((r) => r.mine && r.emoji === emoji);
/** Up to 3 avatars per reaction; without names, me for mine and a neutral
 * person for anyone else's. */
function reactors(r: ThreadReaction) {
  const named = r.users.slice(0, 3).map((u) => ({ name: u.me ? myName.value : u.name }));
  if (named.length) {
    return named;
  }
  const mine = r.mine ? [{ name: myName.value }] : [];
  return [...mine, ...Array.from({ length: Math.min(3, r.count) - mine.length }, () => ({ name: "" }))];
}
function pickReaction(message: ThreadMessage | null, emoji: string) {
  contextMenu.open = false;
  const ticketId = tickets.activeTicket?.id;
  if (!message || !ticketId || !canReact(message)) {
    return;
  }
  void tickets.reactTicketMessage(ticketId, message.id, emoji).catch((error) => {
    console.warn("ticket reaction failed", error);
    displayError(error, locale);
  });
}
function onBubbleDouble(event: MouseEvent, message: ThreadMessage) {
  if (!canReact(message) || (event.target as Element).closest("button")) {
    return;
  }
  window.getSelection()?.removeAllRanges();
  pickReaction(message, DEFAULT_REACTION);
}
/** Near the top of the thread the column opens downward, so it isn't cut off. */
const STRIP_HEIGHT = 230;
const stripDown = ref(false);
function onQuickEnter(event: MouseEvent) {
  const top = (event.currentTarget as HTMLElement).getBoundingClientRect().top;
  const view = threadEl.value?.getBoundingClientRect().top ?? 0;
  stripDown.value = top - view < STRIP_HEIGHT;
}

/* ----- Closing my ticket (asks first; it can't be reopened from here) ----- */
const confirmClose = ref(false);
const closing = ref(false);
async function doClose() {
  const id = tickets.activeTicket?.id;
  if (!id || closing.value) {
    return;
  }
  closing.value = true;
  try {
    await tickets.closeTicket(id);
    confirmClose.value = false;
  } catch (error) {
    displayError(error, locale);
  } finally {
    closing.value = false;
  }
}

/* ----- Typing: support's replaces the type under the subject; mine goes
 * out while the box has text, and stops when it empties, sends or closes. */
const staffTypingName = computed(() => {
  const id = tickets.activeTicket?.id;
  if (!id || !showingChat.value || !(id in tickets.staffTyping)) {
    return null;
  }
  return tickets.staffTyping[id] || t("$vuetify.tickets.staff");
});
let typingTicketId = "";
function stopMyTyping() {
  if (typingTicketId) {
    tickets.setMyTyping(typingTicketId, false);
    typingTicketId = "";
  }
}
watch(replyBody, (text) => {
  const id = tickets.activeTicket?.id;
  if (!id || !canReply.value || !text.trim()) {
    stopMyTyping();
    return;
  }
  if (typingTicketId && typingTicketId !== id) {
    stopMyTyping();
  }
  typingTicketId = id;
  tickets.setMyTyping(id, true);
});
watch(
  () => [tickets.activeTicket?.id, tickets.popupOpen] as const,
  ([id, open]) => {
    if (!open || id !== typingTicketId) {
      stopMyTyping();
    }
  },
);
onUnmounted(stopMyTyping);

function startReply(message: ThreadMessage) {
  if (!canReply.value || message.state) {
    return;
  }
  replyTarget.value = message;
  void nextTick(() => {
    (
      document.querySelector(
        ".ticket-popup__input textarea",
      ) as HTMLTextAreaElement | null
    )?.focus();
  });
}

/** Drag a bubble sideways to reply: it follows the pointer up to 72px and a
 * reply icon shows in the gap; letting go past 56px replies. */
const SWIPE_MAX = 72;
const SWIPE_REPLY = 56;
/** dir: 1 drags right, -1 drags left, toward the open side of the message. */
const swipe = reactive({ id: "", dx: 0, dir: 1 });
let swipeStart: {
  x: number;
  y: number;
  id: string;
  pointer: number;
  el: HTMLElement;
} | null = null;
let swipeLocked = false;

/** A message on the right half of the chat drags left, one on the left drags
 * right, so the drag always goes toward the open side (phones, desktop, RTL). */
function dragDirection(bubble: HTMLElement) {
  const box = bubble.getBoundingClientRect();
  const view = threadEl.value?.getBoundingClientRect();
  if (!view) {
    return 1;
  }
  return box.left + box.width / 2 > view.left + view.width / 2 ? -1 : 1;
}

function onBubbleDown(event: PointerEvent, message: ThreadMessage) {
  if (!canReply.value || event.button !== 0) {
    return;
  }
  swipeStart = {
    x: event.clientX,
    y: event.clientY,
    id: message.id,
    pointer: event.pointerId,
    el: event.currentTarget as HTMLElement,
  };
  swipeLocked = false;
  swipe.dir = dragDirection(event.currentTarget as HTMLElement);
}

function onBubbleMove(event: PointerEvent) {
  if (!swipeStart || event.pointerId !== swipeStart.pointer) {
    return;
  }
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  if (!swipeLocked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      return;
    }
    // Mostly vertical, or to the left: a scroll or a text selection.
    if (Math.abs(dy) > Math.abs(dx) || dx * swipe.dir < 0) {
      swipeStart = null;
      return;
    }
    swipeLocked = true;
    swipeStart.el.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
  }
  swipe.id = swipeStart.id;
  swipe.dx = Math.max(0, Math.min(SWIPE_MAX, dx * swipe.dir));
}

function onBubbleUp(message: ThreadMessage) {
  if (swipeLocked && swipe.id === message.id && swipe.dx >= SWIPE_REPLY) {
    startReply(message);
  }
  swipeStart = null;
  swipeLocked = false;
  swipe.id = "";
  swipe.dx = 0;
}

/** Right-click: a small menu at the pointer, a row of reactions on top that
 * scrolls sideways, and its arrow shows them all (Telegram style). */
const contextMenu = reactive({
  open: false,
  x: 0,
  y: 0,
  message: null as ThreadMessage | null,
  expanded: false,
});

function onBubbleContext(event: MouseEvent, message: ThreadMessage) {
  event.preventDefault();
  Object.assign(contextMenu, {
    open: true,
    x: event.clientX,
    y: event.clientY,
    message,
    expanded: false,
  });
}

function copyMessage(message: ThreadMessage | null) {
  if (message) {
    void navigator.clipboard?.writeText(message.body);
  }
}

/** Clicking a quote goes to the message it quotes and flashes it. */
const flashId = ref("");
let flashTimer: ReturnType<typeof setTimeout> | undefined;
function goToQuote(id: string) {
  if (!messageEl(id)) {
    return;
  }
  jumpTo(id);
  flashId.value = id;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashId.value = "";
  }, 1200);
}

/** Sends one stored-or-failed reply; one at a time, so replies keep the
 * order they were typed in. The stored message arrives with the ticket. */
function postReply(reply: PendingReply) {
  sendQueue = sendQueue.then(async () => {
    try {
      await tickets.replyTicket(
        reply.ticketId,
        reply.body,
        reply.replyTo?.id ?? "",
        reply.clientId,
      );
      pending.value = pending.value.filter((p) => p.id !== reply.id);
    } catch (error) {
      console.warn("ticket reply failed", error);
      displayError(error, locale);
      pending.value = pending.value.map((p) =>
        p.id === reply.id ? { ...p, state: "failed" } : p,
      );
    }
  });
}

/** The reply shows in the chat at once and the box stays free to type in. */
/** The time sits beside the last line, except under right-to-left text and a
 * failed reply, where it takes its own line (as in Telegram). */
const floatsTime = (message: ThreadMessage) =>
  message.state !== "failed" && !startsRtl(message.body);

/** Over 3,000 characters the text goes out as up to 5 messages, in order; a
 * reply quote goes on the first. Over 15,000 it can't be sent. */
const draftParts = computed(() => splitMessage(replyBody.value));
const draftLength = computed(() => replyBody.value.trim().length);
const showCounter = computed(() => draftLength.value > MESSAGE_MAX * 0.9);
const numberFormat = computed(
  () => new Intl.NumberFormat(locale.isRtl.value ? "fa-IR" : "en-US"),
);

async function sendReply() {
  const parts = draftParts.value;
  const ticket = tickets.activeTicket;
  if (!parts?.length || !ticket?.id) {
    return;
  }
  const target = replyTarget.value;
  const replies: PendingReply[] = parts.map((body, i) => ({
    id: `local-${++pendingSeq}`,
    ticketId: ticket.id,
    body,
    createdAt: new Date().toISOString(),
    clientId: crypto.randomUUID(),
    replyTo:
      i === 0 && target
        ? {
            id: target.id,
            name: target.isStaff
              ? target.displayName
              : t("$vuetify.tickets.you"),
            body: target.body.replace(/\s+/g, " ").slice(0, 200),
            deleted: false,
          }
        : null,
    state: "sending",
  }));
  pending.value = [...pending.value, ...replies];
  stopMyTyping();
  replyBody.value = "";
  replyTarget.value = null;
  stickToBottom.value = true;
  await nextTick();
  scrollThreadToBottom(true);
  for (const reply of replies) {
    postReply(reply);
  }
}

function retryReply(id: string) {
  const reply = pending.value.find((p) => p.id === id);
  if (!reply || reply.state !== "failed") {
    return;
  }
  const again = { ...reply, state: "sending" as const };
  pending.value = pending.value.map((p) => (p.id === id ? again : p));
  postReply(again);
}

function discardReply(id: string) {
  pending.value = pending.value.filter((p) => p.id !== id);
}

function onReplyKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendReply();
    return;
  }
  if (event.key === "Escape" && replyTarget.value) {
    event.stopPropagation();
    replyTarget.value = null;
  }
}

async function openEmojiPicker() {
  try {
    replyInput.value?.focus?.();
  } catch {
    // ignore
  }
  const el = document.querySelector(
    ".ticket-popup__input textarea",
  ) as HTMLTextAreaElement | null;
  el?.focus();
  await nextTick();
  try {
    await Call.ByName("main.Service.OpenEmojiPanel");
  } catch {
    // Binding may not be regenerated yet; Win+. still works manually.
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- Opens and closes scaling from its bottom edge. -->
    <Transition name="ticket-popup-scale">
    <v-card
      v-if="tickets.popupOpen"
      ref="popupCard"
      class="ticket-popup"
      :style="popupStyle"
      :class="{
        'ticket-popup--rtl': locale.isRtl.value,
        'ticket-popup--offset': offsetForOptimize,
        'ticket-popup--chat': showingChat,
      }"
      color="surface"
      variant="elevated"
      elevation="16"
      border
    >
      <!-- Resize from the top edge, the free side, or their corner -->
      <div
        v-for="edge in (['top', 'side', 'corner'] as const)"
        :key="edge"
        :class="['ticket-popup__resize', `ticket-popup__resize--${edge}`]"
        aria-hidden="true"
        @pointerdown="startResize($event, edge)"
        @pointermove="onResizeMove"
        @pointerup="endResize"
        @pointercancel="endResize"
      />
      <div class="ticket-popup__header">
        <!-- In a chat the back arrow takes this place -->
        <v-btn
          v-if="!showingChat"
          icon="mdi-close"
          size="small"
          variant="text"
          color="on-background"
          :aria-label="t('$vuetify.tickets.close')"
          @click="tickets.closeTicketPopup()"
        />
        <v-btn
          v-if="showingChat"
          :icon="locale.isRtl.value ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          variant="text"
          color="on-background"
          :aria-label="t('$vuetify.tickets.backToList')"
          @click="goBackToList"
        />
        <div class="ticket-popup__title">
          <div class="text-truncate" dir="auto">{{ headerTitle }}</div>
          <div
            v-if="showingChat && tickets.activeTicket"
            class="ticket-popup__subtitle text-truncate"
            :class="{ 'ticket-popup__subtitle--typing': staffTypingName }"
          >
            {{
              staffTypingName
                ? t("$vuetify.tickets.typing", [staffTypingName])
                : typeLabel(tickets.activeTicket.type)
            }}
          </div>
        </div>
        <div class="ticket-popup__actions">
          <v-btn
            v-if="!showingChat"
            color="primary"
            variant="tonal"
            size="small"
            rounded="lg"
            prepend-icon="mdi-plus"
            class="ticket-popup__new"
            @click="openCreate"
          >
            {{ t("$vuetify.tickets.newTicket") }}
          </v-btn>
          <v-chip
            v-if="showingChat && tickets.activeTicket && statusLabel"
            size="small"
            variant="tonal"
            :color="statusColor"
          >
            {{ statusLabel }}
          </v-chip>
          <TicketFavoriteButton
            v-if="showingChat && ticketId"
            :ticket-id="ticketId"
            size="small"
          />
          <v-tooltip
            v-if="showingChat && canReply"
            :text="t('$vuetify.tickets.closeTicket')"
            location="bottom"
          >
            <template #activator="{ props: tip }">
              <v-btn
                v-bind="tip"
                icon="mdi-check-circle-outline"
                size="small"
                variant="text"
                color="on-background"
                :aria-label="t('$vuetify.tickets.closeTicket')"
                @click="confirmClose = true"
              />
            </template>
          </v-tooltip>
        </div>
      </div>

      <div v-if="!showingChat" class="ticket-popup__filters" role="radiogroup">
        <button
          v-for="f in (['all', 'open', 'closed'] as const)"
          :key="f"
          type="button"
          role="radio"
          class="ticket-tab"
          :class="{ 'ticket-tab--active': listFilter === f }"
          :aria-checked="listFilter === f"
          @click="listFilter = f"
        >
          {{ t(`$vuetify.tickets.filters.${f}`) }}
        </button>
      </div>

      <v-divider />

      <div class="ticket-popup__viewport">
        <div
          class="ticket-popup__slider"
          :class="{ 'ticket-popup__slider--chat': showingChat }"
        >
          <!-- List panel -->
          <div class="ticket-popup__panel ticket-popup__panel--list">
            <div
              v-if="tickets.loading && !sortedTickets.length"
              class="pa-8 text-center"
            >
              <v-progress-circular indeterminate size="28" width="2" />
            </div>

            <div
              v-else
              class="ticket-popup__list"
              :class="{ 'ticket-popup__list--refreshing': tickets.refreshing }"
            >
              <button
                v-for="ticket in sortedTickets"
                :key="ticket.id"
                type="button"
                class="ticket-row"
                @click="openTicket(ticket)"
              >
                <v-avatar
                  :color="isClosedStatus(ticket.status) ? 'grey' : 'primary'"
                  variant="tonal"
                  size="40"
                  rounded="lg"
                >
                  <v-icon :icon="listIcon(ticket.type)" size="20" />
                </v-avatar>
                <div class="ticket-row__main">
                  <div class="ticket-row__top">
                    <span class="ticket-row__subject" dir="auto">{{ ticket.subject }}</span>
                    <v-icon
                      v-if="isFavorite(ticket.id)"
                      icon="mdi-pin"
                      size="14"
                      color="primary"
                      :aria-label="t('$vuetify.tickets.unpinFavorite')"
                    />
                    <span :key="clock" class="ticket-row__time">
                      {{ formatWhen(ticket.updated_at || ticket.created_at) }}
                    </span>
                  </div>
                  <div class="ticket-row__bottom">
                    <span class="ticket-row__preview" dir="auto">{{ previewText(ticket) }}</span>
                    <span v-if="isUnread(ticket)" class="ticket-row__dot" />
                    <v-chip size="x-small" variant="tonal" :color="statusColorOf(ticket.status)">
                      {{ statusText(ticket.status) }}
                    </v-chip>
                  </div>
                </div>
              </button>

              <div
                v-if="!sortedTickets.length"
                class="ticket-popup__empty text-medium-emphasis"
              >
                {{ t("$vuetify.tickets.empty") }}
              </div>
            </div>

          </div>

          <!-- Chat panel -->
          <div class="ticket-popup__panel ticket-popup__panel--chat">
            <div
              v-if="tickets.activeLoading && !tickets.activeTicket"
              class="pa-8 text-center"
            >
              <v-progress-circular indeterminate size="28" width="2" />
            </div>

            <div
              v-else-if="loadError && !tickets.activeTicket"
              class="pa-6 text-center text-medium-emphasis"
            >
              {{ t("$vuetify.tickets.loadFailed") }}
              <div class="mt-3">
                <v-btn variant="tonal" size="small" @click="loadTicket">
                  {{ t("$vuetify.tickets.backToList") }}
                </v-btn>
              </div>
            </div>

            <template v-else-if="tickets.activeTicket">
              <div class="ticket-popup__thread-wrap">
              <div
                ref="threadEl"
                class="ticket-popup__thread"
                :class="{ 'ticket-popup__thread--scrolling': threadScrolling }"
                @scroll.passive="onThreadScroll"
              >
                <div class="ticket-popup__thread-inner">
                  <div v-if="tickets.loadingOlder" class="d-flex justify-center py-2">
                    <v-progress-circular indeterminate size="16" width="2" />
                  </div>
                  <p
                    v-if="tickets.activeTicket.close_reason"
                    class="ticket-popup__notice text-caption text-medium-emphasis"
                  >
                    {{ tickets.activeTicket.close_reason }}
                  </p>

                  <section
                    v-for="day in threadDays"
                    :key="day.id"
                    class="ticket-day-group"
                  >
                    <div class="ticket-day" role="separator">
                      <span class="ticket-day__label">{{ day.label }}</span>
                    </div>

                    <div
                      v-for="run in day.runs"
                      :key="run.id"
                      class="ticket-run"
                      :class="run.staff ? 'ticket-run--staff' : 'ticket-run--own'"
                    >
                      <!-- Sticks to the bottom of the view while its run is on screen -->
                      <div
                        class="ticket-run__avatar"
                        :style="{ background: avatarColor(run.name || '?') }"
                        aria-hidden="true"
                      >
                        <template v-if="initialOf(run.name)">{{ initialOf(run.name) }}</template>
                        <v-icon v-else icon="mdi-account" size="18" />
                      </div>
                      <div class="ticket-run__msgs">
                    <div
                      v-for="(item, i) in run.items"
                      :key="item.id"
                      :data-mid="item.id"
                      class="ticket-msg"
                      :class="{
                        'ticket-msg--own': !item.message.isStaff,
                        'ticket-msg--staff': item.message.isStaff,
                        'ticket-msg--sending': item.message.state === 'sending',
                        'ticket-msg--failed': item.message.state === 'failed',
                        'ticket-msg--flash': flashId === item.message.id,
                        'ticket-msg--enter': entering.has(item.message.id),
                        'ticket-msg--pause': afterPause(run.items, i),
                      }"
                    >
                      <!-- The sender's name sits above the bubble -->
                      <div
                        v-if="item.message.isStaff && i === 0"
                        class="ticket-msg__name"
                      >
                        {{ item.message.displayName }}
                      </div>
                      <div
                        class="ticket-msg__bubble"
                        :class="{
                          'ticket-msg__bubble--dragging':
                            swipe.id === item.message.id,
                        }"
                        :style="
                          swipe.id === item.message.id
                            ? {
                                transform: `translateX(${swipe.dx * swipe.dir}px)`,
                              }
                            : undefined
                        "
                        @pointerdown="onBubbleDown($event, item.message)"
                        @pointermove="onBubbleMove"
                        @pointerup="onBubbleUp(item.message)"
                        @pointercancel="onBubbleUp(item.message)"
                        @contextmenu="onBubbleContext($event, item.message)"
                        @dblclick="onBubbleDouble($event, item.message)"
                      >
                        <!-- In the gap the dragged bubble leaves behind it -->
                        <v-icon
                          v-if="swipe.id === item.message.id"
                          icon="mdi-reply"
                          class="ticket-swipe-icon"
                          :style="{
                            [swipe.dir > 0 ? 'left' : 'right']: `${Math.max(4, swipe.dx - 24) - swipe.dx}px`,
                            opacity: swipe.dx / SWIPE_REPLY,
                          }"
                          size="20"
                        />
                        <button
                          v-if="canReply && !item.message.state"
                          type="button"
                          class="ticket-reply-btn"
                          :aria-label="t('$vuetify.tickets.reply')"
                          @pointerdown.stop
                          @click="startReply(item.message)"
                        >
                          <v-icon icon="mdi-reply" size="16" />
                        </button>
                        <!-- Beside the bubble: the heart reacts; hovering it shows all reactions -->
                        <div
                          v-if="canReact(item.message)"
                          class="ticket-quick"
                          :class="{ 'ticket-quick--down': stripDown }"
                          @pointerdown.stop
                          @mouseenter="onQuickEnter"
                        >
                          <button
                            type="button"
                            class="ticket-quick__heart"
                            :class="{ 'ticket-quick__heart--mine': mineHas(item.message, DEFAULT_REACTION) }"
                            :aria-label="t('$vuetify.tickets.react')"
                            @click="pickReaction(item.message, DEFAULT_REACTION)"
                          >
                            {{ DEFAULT_REACTION }}
                          </button>
                          <div class="ticket-quick__strip" role="menu" :aria-label="t('$vuetify.tickets.react')">
                            <button
                              v-for="e in stripReactions"
                              :key="e"
                              type="button"
                              role="menuitem"
                              class="ticket-quick__item"
                              :class="{ 'ticket-quick__item--mine': mineHas(item.message, e) }"
                              @click="pickReaction(item.message, e)"
                            >
                              {{ e }}
                            </button>
                          </div>
                        </div>
                        <button
                          v-if="item.message.replyTo"
                          type="button"
                          class="ticket-quote"
                          @pointerdown.stop
                          @click="goToQuote(item.message.replyTo.id)"
                        >
                          <span
                            class="ticket-quote__name"
                            :class="{
                              'ticket-quote__name--deleted':
                                item.message.replyTo.deleted,
                            }"
                          >
                            {{
                              item.message.replyTo.deleted
                                ? t("$vuetify.tickets.deletedMessage")
                                : item.message.replyTo.name
                            }}
                          </span>
                          <span
                            v-if="!item.message.replyTo.deleted"
                            class="ticket-quote__body"
                          >
                            {{ item.message.replyTo.body }}
                          </span>
                        </button>
                        <!-- An invisible copy of the time ends the last line, so a
                             short message keeps its time beside it (Telegram style) -->
                        <div class="ticket-msg__body">{{ item.message.body }}<span
                            v-if="floatsTime(item.message) && !item.message.reactions.length"
                            class="ticket-time-gap"
                            :class="{ 'ticket-time-gap--tick': !item.message.isStaff }"
                            aria-hidden="true"
                          >{{ formatClock(item.message.createdAt) }}</span></div>
                        <!-- Reactions in the bubble, each with who reacted as small avatars -->
                        <div v-if="item.message.reactions.length" class="ticket-reactions">
                          <button
                            v-for="r in item.message.reactions"
                            :key="r.emoji"
                            type="button"
                            class="ticket-reaction"
                            :class="{ 'ticket-reaction--mine': r.mine }"
                            :disabled="!canReact(item.message)"
                            :aria-pressed="r.mine"
                            @pointerdown.stop
                            @click="pickReaction(item.message, r.emoji)"
                          >
                            <span class="ticket-reaction__emoji">{{ r.emoji }}</span>
                            <span class="ticket-reaction__users">
                              <span
                                v-for="(u, k) in reactors(r)"
                                :key="k"
                                class="ticket-reaction__user"
                                :style="{ background: u.name ? avatarColor(u.name) : 'rgba(var(--v-theme-on-surface), 0.28)' }"
                                :title="u.name"
                              >
                                <template v-if="initialOf(u.name)">{{ initialOf(u.name) }}</template>
                                <v-icon v-else icon="mdi-account" size="11" />
                              </span>
                            </span>
                          </button>
                          <span
                            v-if="floatsTime(item.message)"
                            class="ticket-time-gap"
                            :class="{ 'ticket-time-gap--tick': !item.message.isStaff }"
                            aria-hidden="true"
                          >{{ formatClock(item.message.createdAt) }}</span>
                        </div>
                        <!-- Time and ticks inside the bubble, as on the website -->
                        <div
                          class="ticket-msg__time"
                          :class="{
                            'ticket-msg__time--float':
                              floatsTime(item.message),
                          }"
                        >
                          <template v-if="item.message.state === 'failed'">
                            <span class="text-error">
                              {{ t("$vuetify.tickets.notSent") }}
                            </span>
                            <button
                              type="button"
                              class="ticket-msg__action"
                              @pointerdown.stop
                              @click="retryReply(item.message.id)"
                            >
                              {{ t("$vuetify.tickets.retry") }}
                            </button>
                            <button
                              type="button"
                              class="ticket-msg__action"
                              @pointerdown.stop
                              @click="discardReply(item.message.id)"
                            >
                              {{ t("$vuetify.tickets.discard") }}
                            </button>
                          </template>
                          <template v-else>
                            {{ formatClock(item.message.createdAt) }}
                            <v-icon
                              v-if="!item.message.isStaff"
                              :icon="
                                item.message.state === 'sending'
                                  ? 'mdi-clock-outline'
                                  : item.message.seen
                                    ? 'mdi-check-all'
                                    : 'mdi-check'
                              "
                              :color="item.message.seen ? 'info' : undefined"
                              size="13"
                              :aria-label="
                                item.message.state === 'sending'
                                  ? t('$vuetify.tickets.sending')
                                  : item.message.seen
                                    ? t('$vuetify.tickets.seenByStaff')
                                    : undefined
                              "
                            />
                          </template>
                        </div>
                      </div>
                    </div>
                      </div>
                    </div>
                  </section>

                  <div
                    v-if="!threadMessages.length"
                    class="ticket-popup__empty text-medium-emphasis"
                  >
                    {{ t("$vuetify.tickets.noMessages") }}
                  </div>
                </div>
              </div>
                <v-fade-transition>
                  <button
                    v-if="!stickToBottom"
                    type="button"
                    class="ticket-jump"
                    :aria-label="
                      unseen.length
                        ? t('$vuetify.tickets.jumpUnread', [unseen.length])
                        : t('$vuetify.tickets.jumpEnd')
                    "
                    @click="jumpDown"
                  >
                    <v-icon icon="mdi-chevron-down" size="26" />
                    <span v-if="unseen.length" class="ticket-jump__badge">
                      {{ unseen.length > 999 ? "999+" : unseen.length }}
                    </span>
                  </button>
                </v-fade-transition>
                <v-menu
                  v-model="contextMenu.open"
                  :target="[contextMenu.x, contextMenu.y]"
                  location="bottom start"
                  :close-on-content-click="false"
                >
                  <v-list density="compact" min-width="160">
                    <div
                      v-if="contextMenu.message && canReact(contextMenu.message)"
                      class="ticket-react-row"
                      :class="{ 'ticket-react-row--all': contextMenu.expanded }"
                    >
                      <div class="ticket-react-row__list">
                        <button
                          v-for="e in stripReactions"
                          :key="e"
                          type="button"
                          class="ticket-react-row__item"
                          :class="{ 'ticket-react-row__item--mine': mineHas(contextMenu.message, e) }"
                          @click="pickReaction(contextMenu.message, e)"
                        >
                          {{ e }}
                        </button>
                      </div>
                      <button
                        type="button"
                        class="ticket-react-row__more"
                        :aria-label="t('$vuetify.tickets.react')"
                        :aria-expanded="contextMenu.expanded"
                        @click="contextMenu.expanded = !contextMenu.expanded"
                      >
                        <v-icon :icon="contextMenu.expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="20" />
                      </button>
                    </div>
                    <v-list-item
                      v-if="canReply"
                      prepend-icon="mdi-reply"
                      :title="t('$vuetify.tickets.reply')"
                      @click="contextMenu.open = false; contextMenu.message && startReply(contextMenu.message)"
                    />
                    <v-list-item
                      prepend-icon="mdi-content-copy"
                      :title="t('$vuetify.tickets.copyText')"
                      @click="contextMenu.open = false; copyMessage(contextMenu.message)"
                    />
                  </v-list>
                </v-menu>
              </div>

              <div class="ticket-popup__composer">
                <div
                  v-if="showCounter && canReply"
                  class="ticket-counter"
                  :class="{ 'ticket-counter--over': !draftParts }"
                >
                  {{
                    !draftParts
                      ? t("$vuetify.tickets.tooLong")
                      : draftParts.length === 1
                        ? t("$vuetify.tickets.sendsAsOne")
                        : t("$vuetify.tickets.sendsAsMany", [
                            numberFormat.format(draftParts.length),
                          ])
                  }}
                  · {{ numberFormat.format(draftLength) }} /
                  {{ numberFormat.format(MESSAGE_TOTAL_MAX) }}
                </div>
                <div v-if="replyTarget && canReply" class="ticket-replybar">
                  <v-icon icon="mdi-reply" size="20" color="primary" />
                  <button
                    type="button"
                    class="ticket-replybar__text"
                    @click="goToQuote(replyTarget.id)"
                  >
                    <span class="ticket-replybar__name">
                      {{
                        t("$vuetify.tickets.replyTo", [
                          replyTarget.isStaff
                            ? replyTarget.displayName
                            : t("$vuetify.tickets.you"),
                        ])
                      }}
                    </span>
                    <span class="ticket-replybar__body">{{ replyTarget.body }}</span>
                  </button>
                  <v-btn
                    icon="mdi-close"
                    variant="text"
                    size="small"
                    :aria-label="t('$vuetify.tickets.cancelReply')"
                    @click="replyTarget = null"
                  />
                </div>
                <v-textarea
                  v-if="canReply"
                  ref="replyInput"
                  v-model="replyBody"
                  :placeholder="t('$vuetify.tickets.typeMessage')"
                  variant="plain"
                  density="comfortable"
                  rows="1"
                  :max-rows="4"
                  auto-grow
                  hide-details
                  :error="false"
                  class="ticket-popup__input"
                  @keydown="onReplyKeydown"
                >
                  <template #append-inner>
                    <v-btn
                      icon="mdi-emoticon-outline"
                      size="small"
                      variant="text"
                      color="on-background"
                      :aria-label="t('$vuetify.tickets.emoji')"
                      @mousedown.prevent
                      @click="openEmojiPicker"
                    />
                    <v-btn
                      icon="mdi-send"
                      size="small"
                      variant="text"
                      color="primary"
                      :disabled="!replyBody.trim() || !draftParts"
                      :aria-label="t('$vuetify.tickets.sendReply')"
                      @click="sendReply"
                    />
                  </template>
                </v-textarea>
                <p
                  v-else
                  class="ticket-popup__closed text-body-2 text-medium-emphasis mb-0"
                >
                  {{ t("$vuetify.tickets.closedHint") }}
                </p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </v-card>
    </Transition>

    <v-dialog v-model="confirmClose" max-width="420">
      <v-card rounded="xl" class="pa-2">
        <v-card-title>{{ t("$vuetify.tickets.closeTitle") }}</v-card-title>
        <v-card-text class="text-body-2 text-medium-emphasis">
          {{ t("$vuetify.tickets.closeBody") }}
        </v-card-text>
        <v-card-actions class="px-4 pb-3">
          <v-spacer />
          <v-btn variant="text" :disabled="closing" @click="confirmClose = false">
            {{ t("$vuetify.tickets.cancel") }}
          </v-btn>
          <v-btn variant="tonal" color="primary" rounded="lg" :loading="closing" @click="doClose">
            {{ t("$vuetify.tickets.closeTicket") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="createOpen"
      max-width="520"
      :persistent="!!createSubject.trim() || !!createBody.trim() || creating"
    >
      <v-card :title="t('$vuetify.tickets.newTicketTitle')">
        <v-card-text>
          <v-form ref="createForm" @submit.prevent="submitCreate">
            <v-select
              v-model="createType"
              :items="typeItems"
              :label="t('$vuetify.tickets.type')"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              class="mb-3"
            />
            <v-text-field
              v-model="createSubject"
              :label="t('$vuetify.tickets.subject')"
              :rules="[
                (v: string) => !!v?.trim() || t('$vuetify.tickets.required'),
              ]"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              class="mb-3"
              maxlength="120"
              counter
            />
            <v-textarea
              v-model="createBody"
              :label="t('$vuetify.tickets.body')"
              :rules="[
                (v: string) => !!v?.trim() || t('$vuetify.tickets.required'),
              ]"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              rows="5"
              auto-grow
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="creating"
            @click="createOpen = false"
          >
            {{ t("$vuetify.tickets.cancel") }}
          </v-btn>
          <v-btn color="primary" :loading="creating" @click="submitCreate">
            {{ t("$vuetify.tickets.submit") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </Teleport>
</template>

<style scoped>
.ticket-popup-scale-enter-active,
.ticket-popup-scale-leave-active {
  transition:
    transform 0.22s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease;
}

.ticket-popup-scale-enter-from,
.ticket-popup-scale-leave-to {
  transform: scale(0.6);
  opacity: 0;
}

/* The chat's colours. Dark: the website's. Light: the same roles on white. */
.ticket-popup {
  --tk-surface: #1a1a1a;
  --tk-float: rgba(56, 56, 56, 0.95);
  --tk-float-hover: rgba(70, 70, 70, 0.95);
  --tk-pill: rgba(56, 56, 56, 0.9);
  --tk-strip: rgba(40, 40, 40, 0.97);
  --tk-mine: rgba(0, 0, 0, 0.42);
}

.ticket-popup.v-theme--light {
  --tk-surface: #ffffff;
  --tk-float: rgba(255, 255, 255, 0.97);
  --tk-float-hover: #f0f1f3;
  --tk-pill: rgba(240, 241, 243, 0.95);
  --tk-strip: #ffffff;
  /* Mine: a warm amber tint, as Telegram's light theme tints the sender's */
  --tk-mine: rgba(var(--v-theme-secondary), 0.14);
}

/* It grows out of its bottom-left corner, by the drawer's Help Center item */
.ticket-popup {
  transform-origin: bottom left;
  position: fixed !important;
  bottom: 24px;
  z-index: 20010 !important;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* The website's chat colour: neutral, not the app's warm surface */
  background-color: var(--tk-surface) !important;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(var(--v-theme-on-surface), 0.1) !important;
}

.ticket-popup--rtl {
  transform-origin: bottom right;
}

/* Resize handles: the top edge, the free side (right, or left in RTL) and
 * their corner, a few pixels wide, above the content */
.ticket-popup__resize {
  position: absolute;
  z-index: 5;
  touch-action: none;
}

.ticket-popup__resize--top {
  top: 0;
  left: 12px;
  right: 12px;
  height: 6px;
  cursor: ns-resize;
}

.ticket-popup__resize--side {
  top: 12px;
  bottom: 0;
  right: 0;
  width: 6px;
  cursor: ew-resize;
}

.ticket-popup__resize--corner {
  top: 0;
  right: 0;
  width: 14px;
  height: 14px;
  cursor: nesw-resize;
}

.ticket-popup--rtl .ticket-popup__resize--side {
  right: auto;
  left: 0;
}

.ticket-popup--rtl .ticket-popup__resize--corner {
  right: auto;
  left: 0;
  cursor: nwse-resize;
}

:global(body.ticket-popup-resizing) {
  user-select: none;
}

.ticket-popup--offset {
  bottom: 120px;
}

.ticket-popup__header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  min-height: 60px;
  padding: 10px 14px;
}

.ticket-popup__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.5;
}

.ticket-popup__subtitle--typing {
  color: rgb(var(--v-theme-primary)) !important;
}

.ticket-popup__subtitle {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ticket-popup__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 10px;
}

.ticket-popup__viewport {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.ticket-popup__slider {
  display: flex;
  width: 200%;
  height: 100%;
  direction: ltr;
  transform: translateX(0);
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.ticket-popup__slider--chat {
  transform: translateX(-50%);
}

.ticket-popup--rtl .ticket-popup__slider--chat {
  transform: translateX(-50%);
}

.ticket-popup__panel {
  display: flex;
  flex-direction: column;
  width: 50%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.ticket-popup__panel--list {
  position: relative;
}

.ticket-popup__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}

/* The website's All / Open / Closed pills */
.ticket-popup__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 10px;
}

.ticket-tab {
  cursor: pointer;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-radius: 999px;
  background: transparent;
  padding: 4px 14px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.2;
  white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.ticket-tab:hover {
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.ticket-tab--active {
  border-color: rgba(var(--v-theme-on-surface), 0.38);
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-weight: 600;
}

.ticket-popup__list--refreshing {
  opacity: 0.85;
}

/* Icon buttons as on the website: full-size icons and its 8px corners
 * (this app's Material 3 defaults draw small buttons round, icons smaller) */
.ticket-popup__header :deep(.v-btn--icon),
.ticket-popup__composer :deep(.v-btn--icon) {
  font-size: 1rem;
  border-radius: 8px !important;
}

/* The website's button lettering */
.ticket-popup__new {
  text-transform: uppercase;
  letter-spacing: 0.0892857143em;
}

.ticket-popup--rtl .ticket-popup__new {
  letter-spacing: 0;
}

/* A ticket in the list, as on the website */
.ticket-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: start;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.ticket-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.ticket-row__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ticket-row__top,
.ticket-row__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ticket-row__subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.ticket-row__time {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.ticket-row__preview {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ticket-row__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
}

/* The thread and the jump button that floats over its bottom corner */
.ticket-popup__thread-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* The chat's own width decides its layout, not the window's */
  container: ticket-chat / inline-size;
}

.ticket-jump {
  position: absolute;
  inset-inline-end: 16px;
  bottom: 12px;
  z-index: 3;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--tk-float);
  color: rgba(var(--v-theme-on-surface), 0.85);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  cursor: pointer;
}

.ticket-jump:hover {
  background: var(--tk-float-hover);
}

.ticket-jump__badge {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 11px;
  background: #3e88d6;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
}

.ticket-popup__thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ticket-popup__thread-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  width: 100%;
  padding: 16px;
}

.ticket-popup__notice {
  margin: 0 0.85rem 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.ticket-popup__empty {
  padding: 1.5rem 1rem;
  text-align: center;
}

/* Telegram-style days: each day's pill sticks to the top while its messages
 * scroll under it, the next day's pushes it away, and a stuck pill fades a
 * second after scrolling stops. */
.ticket-day {
  position: sticky;
  top: 4px;
  z-index: 2;
  display: flex;
  justify-content: center;
  padding: 4px 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.ticket-day-group--stuck .ticket-day {
  opacity: 0;
}

.ticket-popup__thread--scrolling .ticket-day-group--stuck .ticket-day {
  opacity: 1;
}

.ticket-day__label {
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--tk-pill);
  backdrop-filter: blur(6px);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font-size: 0.8rem;
  font-weight: 500;
  line-height: 1.4;
  user-select: none;
}

/* A run of one sender's messages. Its avatar is sticky at the bottom, so it
 * rides along with the view but never leaves its run (Telegram style). */
.ticket-run {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

/* The website's spacing: 4px within a run, 8px between runs and days */
.ticket-run__msgs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ticket-day-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ticket-run__avatar {
  position: sticky;
  bottom: 6px;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  color: #fff;
  user-select: none;
}

/* Replying: hover button, drag-to-reply, the quote in a bubble, the bar above the box */
.ticket-msg__bubble {
  position: relative;
  touch-action: pan-y;
  transition: transform 0.18s ease, background-color 0.3s ease;
}

.ticket-msg__bubble--dragging {
  transition: none;
  user-select: none;
}

.ticket-swipe-icon {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.ticket-reply-btn {
  position: absolute;
  top: -6px;
  inset-inline-end: -6px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: var(--tk-float);
  color: rgba(var(--v-theme-on-surface), 0.85);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.ticket-msg__bubble:hover .ticket-reply-btn,
.ticket-reply-btn:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.ticket-quote {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 2px 0 4px;
  padding: 4px 8px;
  border: 0;
  border-inline-start: 2px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.ticket-quote__name,
.ticket-replybar__name {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}

.ticket-quote__name--deleted {
  font-style: italic;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ticket-quote__body,
.ticket-replybar__body {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  unicode-bidi: plaintext;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.75);
}

/* Long text: how many messages it becomes, and the 15,000 limit */
.ticket-counter {
  padding: 0 2px 4px;
  text-align: end;
  font-size: 0.72rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.ticket-counter--over {
  color: rgb(var(--v-theme-error));
}

.ticket-replybar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 6px;
}

.ticket-replybar__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  padding-inline-start: 10px;
  border: 0;
  border-inline-start: 2px solid rgb(var(--v-theme-primary));
  background: none;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.ticket-msg__action {
  border: 0;
  padding: 0 2px;
  background: none;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

/* A message, built like the website's: name above, then the bubble with the
 * time and ticks inside it. Own messages dark at the end, the other side at
 * the start with the bubble corner on its side. */
.ticket-msg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
}

/* A narrow chat (phone size), as on the website: mine at the end without an
 * avatar, the other side's at the start with theirs. */
.ticket-msg--own {
  align-items: flex-end;
}

/* Over a minute after the one before: the gap between two senders (8px) */
.ticket-msg--pause {
  margin-top: 4px;
}

.ticket-run--own .ticket-run__avatar {
  display: none;
}

/* A new message pops in from its bottom corner, as in Telegram */
@keyframes ticket-msg-in {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.92);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.ticket-msg--enter {
  animation: ticket-msg-in 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transform-origin: bottom left;
}

.ticket-msg--own.ticket-msg--enter {
  transform-origin: bottom right;
}

@media (prefers-reduced-motion: reduce) {
  .ticket-msg--enter {
    animation: none;
  }
}

.ticket-msg__name {
  margin: 0 0.1rem 0.28rem;
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1.2;
  color: rgb(var(--v-theme-primary));
}

.ticket-msg__bubble {
  max-width: min(560px, 80%);
  padding: 8px 12px 6px;
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.07);
}

.ticket-msg--staff .ticket-msg__bubble {
  border-end-start-radius: 4px;
}

.ticket-msg--own .ticket-msg__bubble {
  background: var(--tk-mine);
  border-end-end-radius: 4px;
}

/* A wide chat: every message lines up at the start, read top to bottom; mine
 * keep their tint and get my avatar. */
@container ticket-chat (min-width: 600px) {
  .ticket-msg--own {
    align-items: flex-start;
  }

  .ticket-run--own .ticket-run__avatar {
    display: flex;
  }

  .ticket-msg--own .ticket-msg__bubble {
    border-end-end-radius: 14px;
    border-end-start-radius: 4px;
  }

  .ticket-msg--own.ticket-msg--enter {
    transform-origin: bottom left;
  }
}

.ticket-msg--sending .ticket-msg__bubble {
  opacity: 0.7;
}

.ticket-msg--failed .ticket-msg__bubble {
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-error), 0.6);
}

.ticket-msg--flash .ticket-msg__bubble {
  background-color: rgba(var(--v-theme-primary), 0.32) !important;
}

.ticket-msg__body {
  white-space: pre-wrap;
  word-break: break-word;
  unicode-bidi: plaintext;
  line-height: 1.55;
}

/* Time beside a short message (Telegram): the real time sits in the bubble's
 * bottom corner; an invisible copy of it ends the text, so the last line
 * leaves room for it, or wraps when there is none. */
.ticket-msg__time--float {
  position: absolute;
  inset-inline-end: 12px;
  bottom: 6px;
  margin: 0 !important;
}

.ticket-time-gap {
  display: inline-block;
  visibility: hidden;
  margin-inline-start: 10px;
  font-size: 0.68rem;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

.ticket-time-gap--tick {
  padding-inline-end: 17px;
}

.ticket-msg__time {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Reactions: pills inside the bubble, mine gold, who reacted as avatars */
.ticket-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.ticket-reactions .ticket-time-gap {
  align-self: flex-end;
}

.ticket-reaction {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 3px 0 7px;
  border: 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.85);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.15s ease;
}

.ticket-reaction:active {
  transform: scale(0.94);
}

.ticket-reaction:disabled {
  cursor: default;
}

.ticket-reaction--mine {
  background: rgba(var(--v-theme-primary), 0.22);
}

.ticket-reaction__emoji {
  display: block;
  font-size: 0.95rem;
  line-height: 1;
}

.ticket-reaction__users {
  display: inline-flex;
  align-items: center;
}

.ticket-reaction__user {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--tk-surface);
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
}

.ticket-reaction__user + .ticket-reaction__user {
  margin-inline-start: -6px;
}

/* Hover: a small heart beside the bubble on its open side reacts with it.
 * Hovering the heart opens a column of every reaction above it (below near
 * the top of the thread), which scrolls. The padding bridges the gap to the
 * bubble so the hover isn't lost on the way. */
.ticket-msg:hover {
  z-index: 3;
}

.ticket-quick {
  position: absolute;
  bottom: 0;
  inset-inline-end: -40px;
  z-index: 2;
  width: 40px;
  padding-inline-start: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.ticket-msg__bubble:hover .ticket-quick,
.ticket-quick:focus-within {
  opacity: 1;
  pointer-events: auto;
}

/* Narrow chat: mine sit at the end, so their open side is the start */
.ticket-msg--own .ticket-quick {
  inset-inline-end: auto;
  inset-inline-start: -40px;
  padding-inline-start: 0;
  padding-inline-end: 6px;
}

@container ticket-chat (min-width: 600px) {
  .ticket-msg--own .ticket-quick {
    inset-inline-start: auto;
    inset-inline-end: -40px;
    padding-inline-start: 6px;
    padding-inline-end: 0;
  }
}

.ticket-quick__heart {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: var(--tk-float);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.ticket-quick__heart:hover {
  transform: scale(1.1);
}

.ticket-quick__heart--mine {
  background: rgba(var(--v-theme-primary), 0.3);
}

.ticket-quick__strip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  display: flex;
  flex-direction: column-reverse;
  gap: 2px;
  max-height: 230px;
  margin-bottom: 4px;
  padding: 4px;
  border-radius: 20px;
  background: var(--tk-strip);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  overflow-y: auto;
  scrollbar-width: none;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px) scale(0.92);
  transform-origin: bottom center;
  transition: opacity 0.15s ease 0.12s, transform 0.15s ease 0.12s;
}

.ticket-quick__strip::-webkit-scrollbar {
  display: none;
}

.ticket-quick--down .ticket-quick__strip {
  top: 100%;
  bottom: auto;
  flex-direction: column;
  margin: 4px 0 0;
  transform-origin: top center;
}

.ticket-quick:hover .ticket-quick__strip {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0) scale(1);
}

/* Joins the heart to the column, so the hover isn't lost between them */
.ticket-quick:hover::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 8px;
}

.ticket-quick--down:hover::before {
  top: 100%;
  bottom: auto;
}

.ticket-quick__item {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.ticket-quick__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  transform: scale(1.18);
}

.ticket-quick__item--mine {
  background: rgba(var(--v-theme-primary), 0.2);
}

/* Right-click: one row of reactions that scrolls sideways, and an arrow that
 * shows them all */
.ticket-react-row {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding: 4px 6px 6px;
}

.ticket-react-row__list {
  display: flex;
  gap: 2px;
  width: 250px;
  overflow-x: auto;
  scrollbar-width: none;
}

.ticket-react-row__list::-webkit-scrollbar {
  display: none;
}

.ticket-react-row--all .ticket-react-row__list {
  flex-wrap: wrap;
  max-height: 180px;
  overflow-x: hidden;
  overflow-y: auto;
}

.ticket-react-row__item {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.12s ease, background-color 0.12s ease;
}

.ticket-react-row__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  transform: scale(1.18);
}

.ticket-react-row__item--mine {
  background: rgba(var(--v-theme-primary), 0.2);
}

.ticket-react-row__more {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.8);
  cursor: pointer;
}

.ticket-react-row__more:hover {
  background: rgba(var(--v-theme-on-surface), 0.14);
}

.ticket-popup__composer {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.ticket-popup__input {
  width: 100%;
  margin: 0;
}

.ticket-popup__input :deep(.v-input__details),
.ticket-popup__input :deep(.v-messages) {
  display: none !important;
}

/* No label, so none of the room Vuetify keeps above the text for one */
.ticket-popup__input :deep(.v-field) {
  --v-field-padding-top: 0px;
  --v-input-padding-top: 0px;
  border-radius: 0;
  align-items: flex-end;
  background: transparent !important;
  box-shadow: none !important;
  padding-inline: 0.1rem;
}

.ticket-popup__input :deep(.v-field__overlay),
.ticket-popup__input :deep(.v-field__outline) {
  display: none !important;
}

.ticket-popup__input :deep(.v-field__field) {
  padding-top: 0;
}

.ticket-popup__input :deep(.v-field__append-inner) {
  align-self: flex-end;
  padding-top: 0;
  padding-bottom: 0;
  margin: 0;
  gap: 0.05rem;
}

.ticket-popup__input :deep(textarea) {
  max-height: calc(1.5em * 4 + 8px);
  overflow-y: auto !important;
  /* 8 + 24px line + 8 = the 40px box, so the text sits in the middle */
  padding-block: 8px !important;
}

.ticket-popup__closed {
  margin: 0;
  padding: 0.45rem 0.15rem;
}

</style>
