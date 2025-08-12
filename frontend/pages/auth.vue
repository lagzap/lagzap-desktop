<script lang="ts" setup>
import { ref } from "vue";

definePageMeta({
  layout: "guest",
  sanctum: {
    excluded: true,
  },
});

const router = useRouter();

const { isAuthenticated } = useSanctumAuth();
if (isAuthenticated.value) {
  router.push({ name: "start-service" });
}

const registerConfirmDialog = ref(false);

const step = ref("check");
const authType = ref<AuthBy>();
const authEntry = ref<string>("");

function onLogin(type: AuthBy, entry: string, otp: boolean = false) {
  authEntry.value = entry;

  if (type == "phone") {
    authType.value = "phone";
  } else if (type == "email") {
    authType.value = "email";
  }

  step.value = otp ? "otp" : "login";
}

function onRegister(type: AuthBy, entry: string) {
  registerConfirmDialog.value = true;
  authEntry.value = entry;

  if (type == "phone") {
    authType.value = "phone";
  } else if (type == "email") {
    authType.value = "email";
  }
}
</script>

<template>
  <v-scale-transition leave-absolute>
    <AuthCheck v-if="step == 'check'" @login="onLogin" @register="onRegister" />
    <AuthLogin
      v-else-if="step == 'login'"
      :type="authType"
      :entry="authEntry"
      @back="step = 'check'"
      @otp="onLogin"
    />
    <AuthOtp
      v-else-if="step == 'otp'"
      :type="authType"
      :entry="authEntry"
      @back="step = 'check'"
    />
    <AuthRegister
      v-else-if="step == 'register'"
      :type="authType"
      :entry="authEntry"
      @back="step = 'check'"
    />
  </v-scale-transition>

  <DialogRegister
    v-model="registerConfirmDialog"
    @register="
      registerConfirmDialog = false;
      step = 'register';
    "
  />
</template>
