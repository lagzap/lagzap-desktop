type AuthBy = "phone" | "email" | undefined;

interface EntryForm {
  entry: string;
}

interface RegisterForm {
  otp: number;
  password?: string;
  passwordConfirm?: string;
}
interface RegisterResponse {
  message: string;
}

interface OtpResponse {
  message: string;
  otpID: number;
}

interface LoginCredentials {
  type: AuthBy;
  phone: number | undefined;
  email: string | undefined;
  password: string | undefined;
}
interface LoginOtpCredentials {
  type: AuthBy;
  phone: number | undefined;
  email: string | undefined;
  otp: string | undefined;
  otpID: number | undefined;
}
interface LoginForm {
  password: string;
}
interface LoginOtpForm {
  otp: string;
}

interface OtpForm {
  phone: number;
  otp: number;
}

interface CheckResponse {
  exists: boolean;
  type: "email" | "phone";
}
