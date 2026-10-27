<script setup lang="ts">
import { useLocale } from "vuetify";
import { Call } from "@wailsio/runtime";
import type { Ticket } from "~/bindings/github.com/lagzap/zap/data";
import TicketFavoriteButton from "~/components/tickets/TicketFavoriteButton.vue";
import { displayAlert, displayError } from "~/composables/alert";
import { useTicketQuickAccess } from "~/composables/useTicketQuickAccess";
import {
  formatTicketClockTime,
  formatTicketDayLabel,
  formatTicketTimeShort,
  ticketDayKey,
  ticketDayLabelKind,
} from "~/utils/ticketTime";

const locale = useLocale();
const { t } = locale;
const tickets = useTicketsStore();
const store = useStore();
const { visitTicket, isFavorite, ticketIcon } = useTicketQuickAccess();

const replyBody = ref("");
const replying = ref(false);
const loadError = ref(false);
const threadEl = ref<HTMLElement | null>(null);
const replyInput = ref<{ focus?: () => void } | null>(null);
/** Follow new messages unless the user scrolls up. */
const stickToBottom = ref(true);
const BOTTOM_THRESHOLD_PX = 96;
/** Message ids whose seen receipt should stay visible briefly after flipping. */
const flashReceiptIds = ref<Record<string, true>>({});
const prevSeenById = new Map<string, boolean>();
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RECEIPT_FLASH_MS = 2200;

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

type ThreadMessage = {
  id: string;
  displayName: string;
  body: string;
  createdAt?: string;
  isStaff: boolean;
  seen: boolean;
};

type ThreadItem =
  | { kind: "date"; id: string; label: string }
  | {
      kind: "message";
      id: string;
      message: ThreadMessage;
      showSender: boolean;
      clustered: boolean;
    };

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

const fabLabel = computed(() => headerTitle.value);

const canReply = computed(() => {
  const status = tickets.activeTicket?.status?.toLowerCase() || "";
  return !!tickets.activeTicket && !TERMINAL.has(status);
});

const offsetForOptimize = computed(
  () => store.optimizing && !store.optimizeMinimized,
);

const typeItems = computed(() => [
  { title: t("$vuetify.tickets.typeSupport"), value: "support" },
  { title: t("$vuetify.tickets.typeRequest"), value: "request" },
  { title: t("$vuetify.tickets.typeBug"), value: "bug" },
  { title: t("$vuetify.tickets.typeFeedback"), value: "feedback" },
]);

const sortedTickets = computed(() => {
  return [...tickets.tickets].sort((a, b) => {
    const aFav = isFavorite(a.id) ? 1 : 0;
    const bFav = isFavorite(b.id) ? 1 : 0;
    if (aFav !== bFav) {
      return bFav - aFav;
    }
    const aUnread = isUnread(a);
    const bUnread = isUnread(b);
    if (aUnread !== bUnread) {
      return aUnread ? -1 : 1;
    }
    const aAt = a.updated_at || a.created_at || "";
    const bAt = b.updated_at || b.created_at || "";
    return bAt.localeCompare(aAt);
  });
});

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
    });
  }
  return items;
});

const threadItems = computed((): ThreadItem[] => {
  const items: ThreadItem[] = [];
  let lastDay: string | null = null;
  let lastStaff: boolean | null = null;
  let lastName = "";

  for (const message of threadMessages.value) {
    const day = ticketDayKey(message.createdAt) || "unknown";
    if (day !== lastDay) {
      items.push({
        kind: "date",
        id: `day-${day}`,
        label: formatDaySeparator(message.createdAt),
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

    items.push({
      kind: "message",
      id: message.id,
      message,
      showSender,
      clustered,
    });

    lastStaff = message.isStaff;
    lastName = message.displayName;
  }

  return items;
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

watch(
  () =>
    threadMessages.value
      .map((m) => `${m.id}:${m.body.length}`)
      .join("|"),
  async () => {
    await nextTick();
    scrollThreadToBottom();
  },
);

watch(
  () => threadMessages.value.map((m) => ({ id: m.id, seen: m.seen })),
  (messages) => {
    for (const message of messages) {
      const wasSeen = prevSeenById.get(message.id);
      if (message.seen && wasSeen === false) {
        flashReceipt(message.id);
      }
      prevSeenById.set(message.id, message.seen);
    }
  },
  { deep: true },
);

function flashReceipt(id: string) {
  const existing = flashTimers.get(id);
  if (existing) {
    clearTimeout(existing);
  }
  flashReceiptIds.value = { ...flashReceiptIds.value, [id]: true };
  flashTimers.set(
    id,
    setTimeout(() => {
      flashTimers.delete(id);
      const next = { ...flashReceiptIds.value };
      delete next[id];
      flashReceiptIds.value = next;
    }, RECEIPT_FLASH_MS),
  );
}

onUnmounted(() => {
  for (const timer of flashTimers.values()) {
    clearTimeout(timer);
  }
  flashTimers.clear();
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

function formatWhen(value?: string) {
  return formatTicketTimeShort(value);
}

function lastMessage(ticket: Ticket) {
  const messages = (ticket.messages ?? []).filter(Boolean);
  if (messages.length) {
    return messages[messages.length - 1];
  }
  return null;
}

function previewText(ticket: Ticket) {
  const last = lastMessage(ticket);
  if (last?.body?.trim()) {
    const who = last.is_staff
      ? t("$vuetify.tickets.staff")
      : t("$vuetify.tickets.you");
    return `${who}: ${last.body.trim()}`;
  }
  if (ticket.body?.trim()) {
    return ticket.body.trim();
  }
  return t("$vuetify.tickets.noMessages");
}

function unreadBubble(ticket: Ticket) {
  const count = unreadMessages(ticket);
  if (count > 0) {
    return count;
  }
  return isUnread(ticket) ? 1 : 0;
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
  try {
    await tickets.openTicket(ticketId.value);
    await nextTick();
    scrollThreadToBottom(true);
  } catch (error) {
    if (!tickets.activeTicket || tickets.activeTicket.id !== ticketId.value) {
      loadError.value = true;
    }
    displayError(error, locale);
  }
}

function onThreadScroll() {
  const el = threadEl.value;
  if (!el) {
    return;
  }
  const distanceFromBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
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

async function sendReply() {
  if (!replyBody.value.trim() || !tickets.activeTicket?.id || replying.value) {
    return;
  }
  replying.value = true;
  try {
    await tickets.replyTicket(
      tickets.activeTicket.id,
      replyBody.value.trim(),
    );
    replyBody.value = "";
    stickToBottom.value = true;
    await nextTick();
    scrollThreadToBottom(true);
  } catch (error) {
    displayError(error, locale);
  } finally {
    replying.value = false;
  }
}

function onReplyKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendReply();
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
    <v-btn
      v-if="tickets.popupVisible && tickets.popupMinimized"
      class="ticket-popup-fab"
      :class="{
        'ticket-popup-fab--rtl': locale.isRtl.value,
        'ticket-popup-fab--offset': offsetForOptimize,
      }"
      color="primary"
      rounded="lg"
      elevation="10"
      @click="tickets.expandTicketPopup()"
    >
      <v-icon start icon="mdi-lifebuoy" />
      <span class="ticket-popup-fab__label text-truncate">{{ fabLabel }}</span>
      <v-badge
        v-if="tickets.navBadgeCount > 0"
        :content="tickets.navBadgeCount"
        color="info"
        inline
        class="ms-1"
      />
    </v-btn>

    <v-card
      v-if="tickets.popupOpen"
      class="ticket-popup"
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
      <div class="ticket-popup__header">
        <v-btn
          v-if="showingChat"
          :icon="locale.isRtl.value ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          size="x-small"
          variant="text"
          :aria-label="t('$vuetify.tickets.backToList')"
          @click="goBackToList"
        />
        <div class="ticket-popup__title text-truncate">{{ headerTitle }}</div>
        <div class="ticket-popup__actions">
          <TicketFavoriteButton
            v-if="showingChat && ticketId"
            :ticket-id="ticketId"
            size="x-small"
          />
          <v-btn
            icon="mdi-window-minimize"
            size="x-small"
            variant="text"
            :aria-label="t('$vuetify.routeAnalysis.minimize')"
            @click="tickets.minimizeTicketPopup()"
          />
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            :aria-label="t('$vuetify.tickets.close')"
            @click="tickets.closeTicketPopup()"
          />
        </div>
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
                :class="{ 'ticket-row--unread': isUnread(ticket) }"
                @click="openTicket(ticket)"
              >
                <v-avatar
                  color="surface-variant"
                  size="36"
                  rounded="circle"
                  class="ticket-row__avatar"
                >
                  <v-icon :icon="ticketIcon(ticket)" size="18" />
                </v-avatar>
                <div class="ticket-row__main">
                  <div class="ticket-row__top">
                    <span
                      class="ticket-row__title text-truncate"
                      :class="{ 'font-weight-bold': isUnread(ticket) }"
                    >
                      <span class="ticket-row__type text-medium-emphasis">
                        {{ typeLabel(ticket.type) }}
                      </span>
                      <span class="ticket-row__sep text-medium-emphasis">
                        —
                      </span>
                      <span>{{ ticket.subject }}</span>
                    </span>
                    <span class="ticket-row__time text-caption text-medium-emphasis">
                      {{ formatWhen(ticket.updated_at || ticket.created_at) }}
                    </span>
                  </div>
                  <div class="ticket-row__bottom">
                    <span class="ticket-row__preview text-truncate text-medium-emphasis">
                      {{ previewText(ticket) }}
                    </span>
                    <span
                      v-if="unreadBubble(ticket) > 0"
                      class="ticket-row__unread"
                    >
                      {{ unreadBubble(ticket) }}
                    </span>
                    <span
                      class="ticket-row__fav"
                      @click.stop.prevent
                    >
                      <TicketFavoriteButton
                        :ticket-id="ticket.id"
                        size="x-small"
                      />
                    </span>
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

            <v-btn
              class="ticket-popup__new-fab"
              color="primary"
              size="small"
              icon="mdi-plus"
              elevation="6"
              :aria-label="t('$vuetify.tickets.newTicket')"
              @click="openCreate"
            />
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
              <div
                ref="threadEl"
                class="ticket-popup__thread"
                @scroll.passive="onThreadScroll"
              >
                <div class="ticket-popup__thread-inner">
                  <p
                    v-if="tickets.activeTicket.close_reason"
                    class="ticket-popup__notice text-caption text-medium-emphasis"
                  >
                    {{ tickets.activeTicket.close_reason }}
                  </p>

                  <template v-for="item in threadItems" :key="item.id">
                    <div
                      v-if="item.kind === 'date'"
                      class="ticket-day"
                      role="separator"
                    >
                      <span class="ticket-day__line" aria-hidden="true" />
                      <span class="ticket-day__label">{{ item.label }}</span>
                      <span class="ticket-day__line" aria-hidden="true" />
                    </div>

                    <div
                      v-else
                      class="ticket-msg"
                      :class="{
                        'ticket-msg--own': !item.message.isStaff,
                        'ticket-msg--staff': item.message.isStaff,
                        'ticket-msg--clustered': item.clustered,
                      }"
                    >
                      <div
                        v-if="item.message.isStaff"
                        class="ticket-msg__aside"
                        aria-hidden="true"
                      >
                        <div
                          v-if="item.showSender"
                          class="ticket-msg__avatar"
                          :style="{
                            background: avatarColor(item.message.displayName),
                          }"
                        >
                          {{ initialOf(item.message.displayName) }}
                        </div>
                      </div>

                      <div class="ticket-msg__stack">
                        <div
                          v-if="item.message.isStaff && item.showSender"
                          class="ticket-msg__meta ticket-msg__meta--staff"
                        >
                          <span class="ticket-msg__name">
                            {{ item.message.displayName }}
                          </span>
                          <span
                            v-if="item.message.createdAt"
                            class="ticket-msg__time"
                          >
                            {{ formatClock(item.message.createdAt) }}
                          </span>
                        </div>
                        <div
                          v-else-if="!item.message.isStaff && !item.clustered"
                          class="ticket-msg__meta ticket-msg__meta--own"
                        >
                          <span
                            v-if="item.message.createdAt"
                            class="ticket-msg__time"
                          >
                            {{ formatClock(item.message.createdAt) }}
                          </span>
                        </div>

                        <div class="ticket-msg__row">
                          <div class="ticket-msg__bubble">
                            <div class="ticket-msg__body">
                              {{ item.message.body }}
                            </div>
                          </div>
                          <div
                            v-if="item.message.seen"
                            class="ticket-msg__receipt"
                            :class="{
                              'ticket-msg__receipt--flash':
                                !!flashReceiptIds[item.message.id],
                            }"
                            :title="t('$vuetify.tickets.seenByStaff')"
                          >
                            <v-icon
                              icon="mdi-check-all"
                              size="14"
                              color="info"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>

                  <div
                    v-if="!threadMessages.length"
                    class="ticket-popup__empty text-medium-emphasis"
                  >
                    {{ t("$vuetify.tickets.noMessages") }}
                  </div>
                </div>
              </div>

              <div class="ticket-popup__composer">
                <v-textarea
                  v-if="canReply"
                  ref="replyInput"
                  v-model="replyBody"
                  :placeholder="t('$vuetify.tickets.enterMessage')"
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
                      :aria-label="t('$vuetify.tickets.emoji')"
                      @mousedown.prevent
                      @click="openEmojiPicker"
                    />
                    <v-btn
                      icon="mdi-send"
                      size="small"
                      variant="text"
                      color="primary"
                      :loading="replying"
                      :disabled="!replyBody.trim()"
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
.ticket-popup {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20010 !important;
  display: flex;
  flex-direction: column;
  width: 380px;
  max-width: calc(100vw - 32px);
  height: min(560px, calc(100vh - 48px));
  overflow: hidden;
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.06) !important;
}

.ticket-popup--rtl {
  right: auto;
  left: 24px;
}

.ticket-popup--offset {
  bottom: 120px;
}

.ticket-popup__header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
  min-height: 48px;
  padding: 0.35rem 0.45rem 0.35rem 0.55rem;
}

.ticket-popup__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.3;
  padding-inline-start: 0.25rem;
}

.ticket-popup__actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0.05rem;
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
  padding: 0.35rem 0 3rem;
}

.ticket-popup__list--refreshing {
  opacity: 0.85;
}

.ticket-popup__new-fab {
  position: absolute !important;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  width: 36px !important;
  height: 36px !important;
}

.ticket-popup--rtl .ticket-popup__new-fab {
  right: auto;
  left: 12px;
}

.ticket-row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  width: 100%;
  margin: 0;
  padding: 0.65rem 0.85rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: start;
  cursor: pointer;
}

.ticket-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.ticket-row__avatar {
  flex-shrink: 0;
  margin-top: 0.1rem;
}

.ticket-row__main {
  min-width: 0;
  flex: 1;
}

.ticket-row__top,
.ticket-row__bottom {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

.ticket-row__title {
  flex: 1;
  min-width: 0;
  font-size: 0.84rem;
  line-height: 1.3;
}

.ticket-row__type {
  font-weight: 500;
}

.ticket-row__sep {
  margin: 0 0.15rem;
}

.ticket-row__time {
  flex-shrink: 0;
}

.ticket-row__preview {
  flex: 1;
  min-width: 0;
  margin-top: 0.15rem;
  font-size: 0.75rem;
  line-height: 1.3;
}

.ticket-row__unread {
  flex-shrink: 0;
  min-width: 1.15rem;
  height: 1.15rem;
  margin-top: 0.15rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: #42a5f5;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1.15rem;
  text-align: center;
}

.ticket-row__fav {
  flex-shrink: 0;
  margin-top: 0.05rem;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.ticket-row:hover .ticket-row__fav,
.ticket-row:focus-within .ticket-row__fav {
  opacity: 1;
}

.ticket-row--unread .ticket-row__title {
  color: rgb(var(--v-theme-on-surface));
}

.ticket-popup__thread {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ticket-popup__thread-inner {
  margin-top: auto;
  width: 100%;
  padding: 0.65rem 0 0.5rem;
}

.ticket-popup__notice {
  margin: 0 0.85rem 0.75rem;
  padding: 0.55rem 0.7rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.ticket-popup__empty {
  padding: 1.5rem 1rem;
  text-align: center;
}

.ticket-day {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin: 0.85rem 0.9rem 0.65rem;
}

.ticket-day__line {
  flex: 1 1 auto;
  height: 1px;
  background: rgba(255, 255, 255, 0.12);
}

.ticket-day__label {
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.48);
  user-select: none;
}

.ticket-msg {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  margin: 0;
  padding: 0.4rem 0.85rem 0.08rem;
  max-width: 100%;
}

.ticket-msg--clustered {
  padding-top: 0.14rem;
}

.ticket-msg--own {
  justify-content: flex-end;
}

.ticket-msg--staff {
  justify-content: flex-start;
}

.ticket-msg__aside {
  flex: 0 0 32px;
  width: 32px;
  align-self: flex-start;
}

.ticket-msg__avatar {
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

.ticket-msg__stack {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 78%;
}

.ticket-msg--own .ticket-msg__stack {
  align-items: flex-end;
}

.ticket-msg--staff .ticket-msg__stack {
  align-items: flex-start;
}

.ticket-msg__meta {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0 0.1rem 0.28rem;
  line-height: 1.2;
}

.ticket-msg__meta--own {
  justify-content: flex-end;
}

.ticket-msg__name {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.ticket-msg__time {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.ticket-msg__bubble {
  padding: 0.55rem 0.8rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
}

.ticket-msg--own .ticket-msg__bubble {
  background: rgba(0, 0, 0, 0.42);
  border-end-end-radius: 4px;
}

.ticket-msg--staff .ticket-msg__bubble {
  background: rgba(255, 255, 255, 0.12);
  border-end-start-radius: 4px;
}

.ticket-msg__body {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.ticket-msg__row {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
  max-width: 100%;
}

.ticket-msg--own .ticket-msg__row {
  flex-direction: row-reverse;
}

.ticket-msg__receipt {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  align-self: flex-end;
  margin-bottom: 0.2rem;
  opacity: 0;
  transform: translateY(1px);
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.ticket-msg:hover .ticket-msg__receipt,
.ticket-msg__receipt--flash {
  opacity: 0.9;
  pointer-events: auto;
}

.ticket-popup__composer {
  flex: 0 0 auto;
  padding: 0.2rem 0.75rem 0.65rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.ticket-popup__input {
  width: 100%;
  margin: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.45);
}

.ticket-popup__input :deep(.v-input__details),
.ticket-popup__input :deep(.v-messages) {
  display: none !important;
}

.ticket-popup__input :deep(.v-field) {
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

.ticket-popup__input :deep(.v-field__append-inner) {
  align-self: flex-end;
  padding-bottom: 2px;
  margin: 0;
  gap: 0.05rem;
}

.ticket-popup__input :deep(textarea) {
  max-height: calc(1.5em * 4 + 8px);
  overflow-y: auto !important;
  padding-block: 0.45rem !important;
}

.ticket-popup__closed {
  margin: 0;
  padding: 0.45rem 0.15rem;
}

.ticket-popup-fab {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20010 !important;
  max-width: min(280px, calc(100vw - 48px));
  text-transform: none;
}

.ticket-popup-fab--rtl {
  right: auto;
  left: 24px;
}

.ticket-popup-fab--offset {
  bottom: 120px;
}

.ticket-popup-fab__label {
  max-width: 180px;
}
</style>
